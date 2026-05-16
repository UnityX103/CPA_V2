//! macOS hit-test 透传：动态子类化 NSView，重写 `hitTest:` 让透明区域返回 nil。
//!
//! AppKit 命中测试时调用 contentView 的 `hitTest:`；返回 nil 表示「该点不属于
//! 这个窗口」，AppKit 自然把事件投递到 z-order 下一个窗口。

use super::HitRegionStore;
use objc2::{
    define_class, msg_send, rc::Retained, runtime::AnyObject, DefinedClass, MainThreadOnly,
};
use objc2_app_kit::{NSAutoresizingMaskOptions, NSView, NSWindow};
use objc2_foundation::{MainThreadMarker, NSPoint, NSRect};
use std::ptr::null_mut;
use std::sync::Arc;
use tauri::WebviewWindow;

/// Instance variable：指向共享 store 的 raw pointer（`Arc::into_raw` 转移所有权到 view）。
/// **此 Arc 故意泄漏**：进程退出时 OS 回收内存，无 `from_raw` 配对调用。
/// 如未来要支持运行时卸载/重装，需要在此结构上挂一个自定义 `dealloc` 实现，
/// 在那里执行 `Arc::from_raw(self.store)` 收回引用计数。见 spec §6。
struct PassthroughIvars {
    store: *const HitRegionStore,
}

// SAFETY: PassthroughIvars 只保存一个 Arc<HitRegionStore> 的裸指针；
// HitRegionStore 内部用 Mutex，是 Send+Sync 安全的。
unsafe impl Send for PassthroughIvars {}
unsafe impl Sync for PassthroughIvars {}

define_class!(
    // SAFETY: NSView 不需要 Rust-side Drop（我们也没有实现）；
    // MainThreadOnly 继承自 NSView，保证只在主线程访问。
    #[unsafe(super = NSView)]
    #[thread_kind = MainThreadOnly]
    #[name = "CPAPassthroughView"]
    #[ivars = PassthroughIvars]
    struct PassthroughView;

    impl PassthroughView {
        /// 重写 acceptsFirstMouse: 返回 YES，让窗口非活动时第一次 mouseDown 也直接
        /// 送入 contentView，避免首次点击只被用来激活窗口、用户感觉「需要先点一下
        /// 再才能拖」。NSEvent 参数允许为 nil（系统判定时不带事件上下文）。
        #[unsafe(method(acceptsFirstMouse:))]
        fn accepts_first_mouse(&self, _event: *mut AnyObject) -> bool {
            true
        }

        /// 重写 hitTest:
        /// - 若点命中 store 中的某个区域 → 把命中委派给第一个子视图（WKWebView 容器），
        ///   让事件正常流入 React。
        /// - 否则返回 nil → AppKit 将事件投递到下层窗口（实现点击穿透）。
        #[unsafe(method(hitTest:))]
        fn hit_test(&self, point: NSPoint) -> *mut AnyObject {
            let store = unsafe { &*self.ivars().store };
            // `point` 在 super-view 坐标系（NSWindow.frameView）。
            // AppKit 使用左下原点；我们的 store 使用左上原点（CSS/DOM）。
            // 用 self.bounds().size.height 翻转 Y 轴。
            //
            // 隐含假设：作为 contentView，self.frame.origin 在 frameView 中为 (0,0)。
            // 这是 NSWindow.contentView 的实际行为；若未来 macOS 版本改成非零原点
            // （例如新的 titlebar 布局），此处需要先做 convertPoint:fromView:nil。
            let bounds: NSRect = unsafe { msg_send![self, bounds] };
            let x = point.x;
            let y = bounds.size.height - point.y;

            if store.hit_test(x, y) {
                // 点命中 UI 区域：委派给第一个子视图（WKWebView 容器）。
                let subviews = self.subviews();
                match subviews.firstObject() {
                    Some(subview) => {
                        // 调用子视图的 hitTest: 并以 autorelease 形式返回结果。
                        match subview.hitTest(point) {
                            Some(result) => Retained::autorelease_return(result) as *mut AnyObject,
                            None => null_mut(),
                        }
                    }
                    None => null_mut(),
                }
            } else {
                // 点在透明区域：返回 nil，让事件穿透到下层窗口。
                null_mut()
            }
        }
    }
);

pub fn install_impl(window: &WebviewWindow, store: Arc<HitRegionStore>) {
    let ns_window_ptr = match window.ns_window() {
        Ok(ptr) => ptr as *mut NSWindow,
        Err(e) => {
            eprintln!("[passthrough/macos] ns_window() returned Err: {e}; skipping install");
            return;
        }
    };
    // Safety: NSWindow 必须在主线程访问；Tauri 的 setup() 在主线程运行。
    let mtm = MainThreadMarker::new()
        .expect("passthrough macos install_* must run on main thread");
    let ns_window: &NSWindow = unsafe { &*ns_window_ptr };

    let old_content: Retained<NSView> = match ns_window.contentView() {
        Some(v) => v,
        None => {
            eprintln!("[passthrough/macos] window has no contentView; skipping install");
            return;
        }
    };
    let frame = old_content.frame();

    // Arc → raw ptr：把 Arc 的所有权转移给 view 的 ivar。
    // 进程退出时 NSWindow 释放 view，ivar 随 view 析构（Arc 仍泄漏，OS 回收内存，
    // 见 spec §6；如需运行时卸载，补 dealloc 重写）。
    let store_raw: *const HitRegionStore = Arc::into_raw(store);

    let this = PassthroughView::alloc(mtm).set_ivars(PassthroughIvars { store: store_raw });
    // 调用 NSView 的 initWithFrame: 作为 super 方法。
    let view: Retained<PassthroughView> =
        unsafe { msg_send![super(this), initWithFrame: frame] };

    // 把原 contentView 取下，装进新 view 作子视图，再把新 view 设为 contentView。
    old_content.removeFromSuperview();
    view.addSubview(&old_content);
    old_content.setAutoresizingMask(
        NSAutoresizingMaskOptions::ViewWidthSizable
            | NSAutoresizingMaskOptions::ViewHeightSizable,
    );
    ns_window.setContentView(Some(&*view));
}

pub fn uninstall_impl(_window: &WebviewWindow) {
    // 进程退出时 NSWindow 释放 CPAPassthroughView → ivar 随之析构。
    // 运行时卸载支持留待 spec §6 后续补充（需重写 dealloc 回收 Arc）。
}

// ---------- first-mouse-only 子类（用于不参与穿透的子窗口，例如设置窗口）----------

define_class!(
    // SAFETY: 同 PassthroughView，主线程 only；ivars = () 是 objc2 0.6 要求
    // `set_ivars(())` 才能把 `Allocated<T>` 转成 `PartialInit<T>` 走 super init 路径。
    #[unsafe(super = NSView)]
    #[thread_kind = MainThreadOnly]
    #[name = "CPAFirstMouseView"]
    #[ivars = ()]
    struct FirstMouseView;

    impl FirstMouseView {
        /// 唯一职责：让窗口非活动时也直接接收第一次 mouseDown。
        /// `hitTest:` 不重写 → AppKit 默认实现 → 命中自身或子视图（WKWebView）。
        #[unsafe(method(acceptsFirstMouse:))]
        fn accepts_first_mouse(&self, _event: *mut AnyObject) -> bool {
            true
        }
    }
);

pub fn install_first_mouse_only_impl(window: &WebviewWindow) {
    let ns_window_ptr = match window.ns_window() {
        Ok(ptr) => ptr as *mut NSWindow,
        Err(e) => {
            eprintln!("[passthrough/macos] ns_window() returned Err on first-mouse-only install: {e}; skipping");
            return;
        }
    };
    let mtm = MainThreadMarker::new()
        .expect("passthrough macos install_* must run on main thread");
    let ns_window: &NSWindow = unsafe { &*ns_window_ptr };

    let old_content: Retained<NSView> = match ns_window.contentView() {
        Some(v) => v,
        None => {
            eprintln!("[passthrough/macos] window has no contentView on first-mouse-only install; skipping");
            return;
        }
    };
    let frame = old_content.frame();

    let this = FirstMouseView::alloc(mtm).set_ivars(());
    let view: Retained<FirstMouseView> =
        unsafe { msg_send![super(this), initWithFrame: frame] };

    old_content.removeFromSuperview();
    view.addSubview(&old_content);
    old_content.setAutoresizingMask(
        NSAutoresizingMaskOptions::ViewWidthSizable
            | NSAutoresizingMaskOptions::ViewHeightSizable,
    );
    ns_window.setContentView(Some(&*view));
}
