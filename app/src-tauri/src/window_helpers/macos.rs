//! macOS window helpers for first-mouse and settings focus restoration.

use objc2::{define_class, msg_send, rc::Retained, runtime::AnyObject, MainThreadOnly};
use objc2_app_kit::{NSAutoresizingMaskOptions, NSView, NSWindow};
use objc2_foundation::MainThreadMarker;
use tauri::{Manager, WebviewWindow};

define_class!(
    // SAFETY: NSView access is restricted to the main thread. `ivars = ()` is
    // required by objc2 0.6 so `set_ivars(())` can drive the super init path.
    #[unsafe(super = NSView)]
    #[thread_kind = MainThreadOnly]
    #[name = "CPAFirstMouseView"]
    #[ivars = ()]
    struct FirstMouseView;

    impl FirstMouseView {
        /// Let an inactive window receive the first mouseDown instead of using
        /// that click only to activate the window.
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
            eprintln!("[window_helpers/macos] ns_window() returned Err on first-mouse-only install: {e}; skipping");
            return;
        }
    };
    let mtm =
        MainThreadMarker::new().expect("window_helpers macos install_* must run on main thread");
    let ns_window: &NSWindow = unsafe { &*ns_window_ptr };

    let old_content: Retained<NSView> = match ns_window.contentView() {
        Some(v) => v,
        None => {
            eprintln!("[window_helpers/macos] window has no contentView on first-mouse-only install; skipping");
            return;
        }
    };
    let frame = old_content.frame();

    let this = FirstMouseView::alloc(mtm).set_ivars(());
    let view: Retained<FirstMouseView> = unsafe { msg_send![super(this), initWithFrame: frame] };

    old_content.removeFromSuperview();
    view.addSubview(&old_content);
    old_content.setAutoresizingMask(
        NSAutoresizingMaskOptions::ViewWidthSizable | NSAutoresizingMaskOptions::ViewHeightSizable,
    );
    ns_window.setContentView(Some(&*view));
}

/// Testing helper: post NSWindowDidMoveNotification on the main queue so Tao's
/// window event path stays on the correct thread.
pub fn post_did_move_notification_for_testing_impl(window: &WebviewWindow) {
    use dispatch2::DispatchQueue;
    use objc2_app_kit::NSWindowDidMoveNotification;
    use objc2_foundation::NSNotificationCenter;

    let ns_window_ptr = match window.ns_window() {
        Ok(ptr) => ptr as *mut NSWindow,
        Err(e) => {
            eprintln!("[focus_restorer/macos] post_did_move: ns_window() err: {e}");
            return;
        }
    };

    let ns_window_addr = ns_window_ptr as usize;

    DispatchQueue::main().exec_async(move || {
        let center = NSNotificationCenter::defaultCenter();
        let ns_window_raw = ns_window_addr as *mut objc2::runtime::AnyObject;
        unsafe {
            center.postNotificationName_object(NSWindowDidMoveNotification, Some(&*ns_window_raw));
        }
    });
}

/// Listen for main-window move/resize notifications and restore focus to the
/// settings window when it is visible.
pub fn install_focus_restorer_impl(main_window: &WebviewWindow, app: tauri::AppHandle) {
    use block2::RcBlock;
    use objc2_app_kit::{NSWindowDidEndLiveResizeNotification, NSWindowDidMoveNotification};
    use objc2_foundation::{NSNotification, NSNotificationCenter, NSOperationQueue};
    use std::ptr::NonNull;

    let ns_window_ptr = match main_window.ns_window() {
        Ok(ptr) => ptr as *mut NSWindow,
        Err(e) => {
            eprintln!("[focus_restorer/macos] ns_window() returned Err: {e}; skipping install");
            return;
        }
    };

    let ns_window_obj: *mut objc2::runtime::AnyObject =
        ns_window_ptr as *mut objc2::runtime::AnyObject;

    let app_for_block = app;
    let block = RcBlock::new(move |_notif: NonNull<NSNotification>| {
        if let Some(settings) = app_for_block.get_webview_window("settings") {
            if settings.is_visible().unwrap_or(false) {
                match settings.set_focus() {
                    Ok(()) => eprintln!("[focus_restorer] focus restored to settings"),
                    Err(e) => eprintln!("[focus_restorer] set_focus failed: {e}"),
                }
            }
        }
    });

    unsafe {
        let center = NSNotificationCenter::defaultCenter();
        let move_token = center.addObserverForName_object_queue_usingBlock(
            Some(NSWindowDidMoveNotification),
            Some(&*ns_window_obj),
            None::<&NSOperationQueue>,
            &*block,
        );
        std::mem::forget(move_token);

        let resize_token = center.addObserverForName_object_queue_usingBlock(
            Some(NSWindowDidEndLiveResizeNotification),
            Some(&*ns_window_obj),
            None::<&NSOperationQueue>,
            &*block,
        );
        std::mem::forget(resize_token);
    }
}
