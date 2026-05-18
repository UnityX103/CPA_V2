//! Global keyboard listener.

#[cfg(any(target_os = "macos", target_os = "windows"))]
use std::sync::atomic::{AtomicBool, Ordering};
#[cfg(any(target_os = "macos", target_os = "windows"))]
use std::sync::Arc;

#[cfg(target_os = "macos")]
pub fn spawn_listener<F>(stop: Arc<AtomicBool>, on_key: F) -> Result<(), String>
where
    F: Fn(i64) + Send + Sync + 'static,
{
    use core_foundation::runloop::{
        kCFRunLoopCommonModes, kCFRunLoopDefaultMode, CFRunLoop, CFRunLoopRunInMode,
    };
    use core_graphics::event::{
        CGEvent, CGEventTap, CGEventTapLocation, CGEventTapOptions, CGEventTapPlacement,
        CGEventType, CallbackResult, EventField,
    };

    std::thread::spawn(move || {
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
                eprintln!("[key_counter] CGEventTap create failed; Accessibility permission may be missing");
                return;
            }
        };

        let loop_source = match tap.mach_port().create_runloop_source(0) {
            Ok(src) => src,
            Err(_) => {
                eprintln!("[key_counter] failed to create CFRunLoop source");
                return;
            }
        };

        unsafe {
            let run_loop = CFRunLoop::get_current();
            run_loop.add_source(&loop_source, kCFRunLoopCommonModes);
            tap.enable();
        }

        while !stop.load(Ordering::Relaxed) {
            unsafe {
                let _ = CFRunLoopRunInMode(kCFRunLoopDefaultMode, 0.1, 0);
            }
        }

        let _ = loop_source;
        let _ = tap;
    });
    Ok(())
}

#[cfg(target_os = "windows")]
pub fn spawn_listener<F>(stop: Arc<AtomicBool>, on_key: F) -> Result<(), String>
where
    F: Fn(i64) + Send + Sync + 'static,
{
    use std::sync::mpsc;
    use std::sync::Mutex;
    use std::sync::OnceLock;
    use std::time::Duration;
    use windows::Win32::Foundation::{LPARAM, LRESULT, WPARAM};
    use windows::Win32::UI::WindowsAndMessaging::{
        CallNextHookEx, DispatchMessageW, PeekMessageW, SetWindowsHookExW, TranslateMessage,
        UnhookWindowsHookEx, KBDLLHOOKSTRUCT, MSG, PM_NOREMOVE, PM_REMOVE, WH_KEYBOARD_LL,
        WM_KEYDOWN, WM_QUIT, WM_SYSKEYDOWN,
    };

    static KEY_SENDER: OnceLock<Mutex<Option<mpsc::Sender<i64>>>> = OnceLock::new();

    unsafe extern "system" fn keyboard_proc(
        code: i32,
        w_param: WPARAM,
        l_param: LPARAM,
    ) -> LRESULT {
        if code >= 0 {
            let message = w_param.0 as u32;
            if message == WM_KEYDOWN || message == WM_SYSKEYDOWN {
                let event = unsafe { *(l_param.0 as *const KBDLLHOOKSTRUCT) };
                if let Some(sender_slot) = KEY_SENDER.get() {
                    if let Ok(sender_guard) = sender_slot.lock() {
                        if let Some(sender) = sender_guard.as_ref() {
                            let _ = sender.send(i64::from(event.vkCode));
                        }
                    }
                }
            }
        }

        unsafe { CallNextHookEx(None, code, w_param, l_param) }
    }

    let (tx, rx) = mpsc::channel::<i64>();
    let sender_slot = KEY_SENDER.get_or_init(|| Mutex::new(None));
    {
        let Ok(mut sender_guard) = sender_slot.lock() else {
            return Err("[key_counter] Windows keyboard hook sender lock poisoned".to_string());
        };
        if sender_guard.is_some() {
            return Err("[key_counter] Windows keyboard hook already running".to_string());
        }
        *sender_guard = Some(tx);
    }

    let (install_tx, install_rx) = mpsc::channel::<Result<(), String>>();
    std::thread::spawn(move || {
        let hook = match unsafe { SetWindowsHookExW(WH_KEYBOARD_LL, Some(keyboard_proc), None, 0) }
        {
            Ok(hook) => hook,
            Err(err) => {
                let message = format!("[key_counter] SetWindowsHookExW failed: {err}");
                let _ = install_tx.send(Err(message.clone()));
                eprintln!("{message}");
                if let Some(sender_slot) = KEY_SENDER.get() {
                    if let Ok(mut sender_guard) = sender_slot.lock() {
                        *sender_guard = None;
                    }
                }
                return;
            }
        };
        let _ = install_tx.send(Ok(()));

        let mut msg = MSG::default();
        unsafe {
            let _ = PeekMessageW(&mut msg, None, 0, 0, PM_NOREMOVE);
        }

        let mut should_exit = false;
        while !stop.load(Ordering::Relaxed) && !should_exit {
            while unsafe { PeekMessageW(&mut msg, None, 0, 0, PM_REMOVE).as_bool() } {
                if msg.message == WM_QUIT || stop.load(Ordering::Relaxed) {
                    should_exit = true;
                    break;
                }

                unsafe {
                    let _ = TranslateMessage(&msg);
                    DispatchMessageW(&msg);
                }
            }

            while let Ok(keycode) = rx.try_recv() {
                on_key(keycode);
            }

            std::thread::sleep(Duration::from_millis(50));
        }

        unsafe {
            let _ = UnhookWindowsHookEx(hook);
        }

        if let Some(sender_slot) = KEY_SENDER.get() {
            if let Ok(mut sender_guard) = sender_slot.lock() {
                *sender_guard = None;
            }
        }

        while let Ok(keycode) = rx.try_recv() {
            on_key(keycode);
        }
    });

    match install_rx.recv() {
        Ok(result) => result,
        Err(err) => Err(format!(
            "[key_counter] Windows keyboard hook install status channel closed: {err}"
        )),
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
pub fn spawn_listener<F>(
    _stop: std::sync::Arc<std::sync::atomic::AtomicBool>,
    _on_key: F,
) -> Result<(), String>
where
    F: Fn(i64) + Send + Sync + 'static,
{
    Ok(())
}
