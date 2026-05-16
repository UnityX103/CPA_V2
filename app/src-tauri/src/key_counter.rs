//! 全局键盘事件监听（macOS）
//!
//! 用 `CGEventTap` 在 HID 层监听 KeyDown 事件，通过 channel 把 keyCode 推到主线程，
//! 再由 Tauri emit 给前端。CGEventTap 必须运行在自己的 CFRunLoop 上才能持续接收事件，
//! 因此我们把它整体放在专属线程：线程内 setup tap → 注册到当前 RunLoop → run 直到
//! 停止信号。
//!
//! 安全前提：用户必须在「系统设置 → 隐私与安全 → 辅助功能」里授予此 App。
//! 没有权限时 `CGEventTap::new` 直接返回 Err；本模块不主动检测权限，
//! 由 `accessibility` 模块在权限翻转时调用 `spawn_listener`。

#[cfg(target_os = "macos")]
use std::sync::atomic::{AtomicBool, Ordering};
#[cfg(target_os = "macos")]
use std::sync::Arc;

#[cfg(target_os = "macos")]
pub fn spawn_listener<F>(stop: Arc<AtomicBool>, on_key: F)
where
    F: Fn(i64) + Send + Sync + 'static,
{
    use core_foundation::runloop::{
        kCFRunLoopCommonModes, kCFRunLoopDefaultMode, CFRunLoop, CFRunLoopRunInMode,
    };
    use core_graphics::event::{
        CGEvent, CGEventTap, CGEventTapLocation, CGEventTapOptions,
        CGEventTapPlacement, CGEventType, CallbackResult, EventField,
    };

    std::thread::spawn(move || {
        // listen-only：不修改事件，CallbackResult::Keep 透传
        let tap = match CGEventTap::new(
            CGEventTapLocation::HID,
            CGEventTapPlacement::HeadInsertEventTap,
            CGEventTapOptions::ListenOnly,
            vec![CGEventType::KeyDown],
            move |_proxy, _event_type, event: &CGEvent| -> CallbackResult {
                let keycode = event.get_integer_value_field(EventField::KEYBOARD_EVENT_KEYCODE);
                on_key(keycode);
                CallbackResult::Keep
            },
        ) {
            Ok(tap) => tap,
            Err(_) => {
                eprintln!("[key_counter] CGEventTap 创建失败：可能未授予辅助功能权限");
                return;
            }
        };

        let loop_source = match tap.mach_port().create_runloop_source(0) {
            Ok(src) => src,
            Err(_) => {
                eprintln!("[key_counter] 创建 RunLoop source 失败");
                return;
            }
        };

        unsafe {
            let run_loop = CFRunLoop::get_current();
            // source 加到 commonModes 让 default/event-tracking 模式都能收到
            run_loop.add_source(&loop_source, kCFRunLoopCommonModes);
            tap.enable();
        }

        // 100ms 唤醒一次轮询 stop 信号；CFRunLoopRunInMode 必须传具体模式（非 commonModes 这种 meta-mode），
        // 否则会抛 _CFRunLoopError_RunCalledWithInvalidMode
        while !stop.load(Ordering::Relaxed) {
            unsafe {
                let _ = CFRunLoopRunInMode(
                    kCFRunLoopDefaultMode,
                    0.1,
                    0,
                );
            }
        }

        // tap 在 drop 时自动从 runloop 移除；let _ 保持作用域到此处
        let _ = loop_source;
        let _ = tap;
    });
}

#[cfg(not(target_os = "macos"))]
pub fn spawn_listener<F>(_stop: std::sync::Arc<std::sync::atomic::AtomicBool>, _on_key: F)
where
    F: Fn(i64) + Send + Sync + 'static,
{
    // 其他平台暂不支持
}
