//! Global keyboard and mouse-button listener for the input counter.

use serde::Serialize;

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InputPressedPayload {
    pub kind: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub button: Option<&'static str>,
}

impl InputPressedPayload {
    pub fn keyboard(code: i64) -> Self {
        Self { kind: "keyboard", code: Some(code), button: None }
    }

    pub fn mouse(button: &'static str) -> Self {
        Self { kind: "mouse", code: None, button: Some(button) }
    }
}

#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
fn windows_mouse_message_to_button(message: u32) -> Option<&'static str> {
    match message {
        0x0201 => Some("left"),
        0x0207 => Some("middle"),
        0x0204 => Some("right"),
        _ => None,
    }
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
use std::sync::atomic::{AtomicBool, Ordering};
#[cfg(any(target_os = "macos", target_os = "windows"))]
use std::sync::Arc;

#[cfg(target_os = "macos")]
pub fn spawn_listener<F>(stop: Arc<AtomicBool>, on_input: F) -> Result<(), String>
where
    F: Fn(InputPressedPayload) + Send + Sync + 'static,
{
    use core_foundation::runloop::{
        kCFRunLoopCommonModes, kCFRunLoopDefaultMode, CFRunLoop, CFRunLoopRunInMode,
    };
    use core_graphics::event::{
        CGEvent, CGEventTap, CGEventTapLocation, CGEventTapOptions, CGEventTapPlacement,
        CGEventType, CallbackResult, EventField,
    };
    use std::sync::mpsc;

    let (install_tx, install_rx) = mpsc::channel::<Result<(), String>>();
    std::thread::spawn(move || {
        let tap = match CGEventTap::new(
            CGEventTapLocation::HID,
            CGEventTapPlacement::HeadInsertEventTap,
            CGEventTapOptions::ListenOnly,
            vec![
                CGEventType::KeyDown,
                CGEventType::LeftMouseDown,
                CGEventType::RightMouseDown,
                CGEventType::OtherMouseDown,
            ],
            move |_proxy, event_type, event: &CGEvent| -> CallbackResult {
                match event_type {
                    CGEventType::KeyDown => {
                        let keycode = event.get_integer_value_field(EventField::KEYBOARD_EVENT_KEYCODE);
                        on_input(InputPressedPayload::keyboard(keycode));
                    }
                    CGEventType::LeftMouseDown => on_input(InputPressedPayload::mouse("left")),
                    CGEventType::RightMouseDown => on_input(InputPressedPayload::mouse("right")),
                    CGEventType::OtherMouseDown => {
                        let button = event.get_integer_value_field(EventField::MOUSE_EVENT_BUTTON_NUMBER);
                        if button == 2 {
                            on_input(InputPressedPayload::mouse("middle"));
                        }
                    }
                    _ => {}
                }
                CallbackResult::Keep
            },
        ) {
            Ok(tap) => tap,
            Err(_) => {
                let message =
                    "[key_counter] CGEventTap create failed; Accessibility permission may be missing"
                        .to_string();
                let _ = install_tx.send(Err(message.clone()));
                eprintln!("{message}");
                return;
            }
        };

        let loop_source = match tap.mach_port().create_runloop_source(0) {
            Ok(src) => src,
            Err(_) => {
                let message = "[key_counter] failed to create CFRunLoop source".to_string();
                let _ = install_tx.send(Err(message.clone()));
                eprintln!("{message}");
                return;
            }
        };

        unsafe {
            let run_loop = CFRunLoop::get_current();
            run_loop.add_source(&loop_source, kCFRunLoopCommonModes);
            tap.enable();
        }
        let _ = install_tx.send(Ok(()));

        while !stop.load(Ordering::Relaxed) {
            unsafe {
                let _ = CFRunLoopRunInMode(kCFRunLoopDefaultMode, 0.1, 0);
            }
        }

        let _ = loop_source;
        let _ = tap;
    });
    install_rx.recv().map_err(|err| {
        format!("[key_counter] macOS event tap install status channel closed: {err}")
    })?
}

#[cfg(target_os = "windows")]
pub fn spawn_listener<F>(stop: Arc<AtomicBool>, on_input: F) -> Result<(), String>
where
    F: Fn(InputPressedPayload) + Send + Sync + 'static,
{
    use std::sync::mpsc;
    use std::sync::Mutex;
    use std::sync::OnceLock;
    use std::time::Duration;
    use windows::Win32::Foundation::{LPARAM, LRESULT, WPARAM};
    use windows::Win32::UI::WindowsAndMessaging::{
        CallNextHookEx, DispatchMessageW, PeekMessageW, SetWindowsHookExW, TranslateMessage,
        UnhookWindowsHookEx, KBDLLHOOKSTRUCT, MSG, MSLLHOOKSTRUCT, PM_NOREMOVE, PM_REMOVE,
        WH_KEYBOARD_LL, WH_MOUSE_LL, WM_KEYDOWN, WM_QUIT, WM_SYSKEYDOWN,
    };

    static INPUT_SENDER: OnceLock<Mutex<Option<mpsc::Sender<InputPressedPayload>>>> =
        OnceLock::new();

    unsafe extern "system" fn keyboard_proc(
        code: i32,
        w_param: WPARAM,
        l_param: LPARAM,
    ) -> LRESULT {
        if code >= 0 {
            let message = w_param.0 as u32;
            if message == WM_KEYDOWN || message == WM_SYSKEYDOWN {
                let event = unsafe { *(l_param.0 as *const KBDLLHOOKSTRUCT) };
                if let Some(sender_slot) = INPUT_SENDER.get() {
                    if let Ok(sender_guard) = sender_slot.lock() {
                        if let Some(sender) = sender_guard.as_ref() {
                            let _ = sender.send(InputPressedPayload::keyboard(i64::from(event.vkCode)));
                        }
                    }
                }
            }
        }

        unsafe { CallNextHookEx(None, code, w_param, l_param) }
    }

    unsafe extern "system" fn mouse_proc(
        code: i32,
        w_param: WPARAM,
        l_param: LPARAM,
    ) -> LRESULT {
        if code >= 0 {
            let message = w_param.0 as u32;
            if let Some(button) = windows_mouse_message_to_button(message) {
                let _event = unsafe { *(l_param.0 as *const MSLLHOOKSTRUCT) };
                if let Some(sender_slot) = INPUT_SENDER.get() {
                    if let Ok(sender_guard) = sender_slot.lock() {
                        if let Some(sender) = sender_guard.as_ref() {
                            let _ = sender.send(InputPressedPayload::mouse(button));
                        }
                    }
                }
            }
        }

        unsafe { CallNextHookEx(None, code, w_param, l_param) }
    }

    let (tx, rx) = mpsc::channel::<InputPressedPayload>();
    let sender_slot = INPUT_SENDER.get_or_init(|| Mutex::new(None));
    {
        let Ok(mut sender_guard) = sender_slot.lock() else {
            return Err("[key_counter] Windows input hook sender lock poisoned".to_string());
        };
        if sender_guard.is_some() {
            return Err("[key_counter] Windows input hook already running".to_string());
        }
        *sender_guard = Some(tx);
    }

    let (install_tx, install_rx) = mpsc::channel::<Result<(), String>>();
    std::thread::spawn(move || {
        let keyboard_hook = match unsafe { SetWindowsHookExW(WH_KEYBOARD_LL, Some(keyboard_proc), None, 0) }
        {
            Ok(hook) => hook,
            Err(err) => {
                let message = format!("[key_counter] SetWindowsHookExW failed: {err}");
                let _ = install_tx.send(Err(message.clone()));
                eprintln!("{message}");
                if let Some(sender_slot) = INPUT_SENDER.get() {
                    if let Ok(mut sender_guard) = sender_slot.lock() {
                        *sender_guard = None;
                    }
                }
                return;
            }
        };

        let mouse_hook = match unsafe { SetWindowsHookExW(WH_MOUSE_LL, Some(mouse_proc), None, 0) }
        {
            Ok(hook) => hook,
            Err(err) => {
                let message = format!("[key_counter] SetWindowsHookExW mouse failed: {err}");
                let _ = install_tx.send(Err(message.clone()));
                eprintln!("{message}");
                unsafe {
                    let _ = UnhookWindowsHookEx(keyboard_hook);
                }
                if let Some(sender_slot) = INPUT_SENDER.get() {
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

            while let Ok(payload) = rx.try_recv() {
                on_input(payload);
            }

            std::thread::sleep(Duration::from_millis(50));
        }

        unsafe {
            let _ = UnhookWindowsHookEx(keyboard_hook);
            let _ = UnhookWindowsHookEx(mouse_hook);
        }

        if let Some(sender_slot) = INPUT_SENDER.get() {
            if let Ok(mut sender_guard) = sender_slot.lock() {
                *sender_guard = None;
            }
        }

        while let Ok(payload) = rx.try_recv() {
            on_input(payload);
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
    _on_input: F,
) -> Result<(), String>
where
    F: Fn(InputPressedPayload) + Send + Sync + 'static,
{
    Ok(())
}

#[cfg(test)]
mod input_event_tests {
    use super::*;

    #[test]
    fn keyboard_payload_keeps_key_code() {
        assert_eq!(
            InputPressedPayload::keyboard(49),
            InputPressedPayload { kind: "keyboard", code: Some(49), button: None }
        );
    }

    #[test]
    fn mouse_payload_uses_button_names() {
        assert_eq!(
            InputPressedPayload::mouse("middle"),
            InputPressedPayload { kind: "mouse", code: None, button: Some("middle") }
        );
    }

    #[test]
    fn windows_mouse_messages_map_supported_buttons() {
        assert_eq!(windows_mouse_message_to_button(0x0201), Some("left"));
        assert_eq!(windows_mouse_message_to_button(0x0207), Some("middle"));
        assert_eq!(windows_mouse_message_to_button(0x0204), Some("right"));
        assert_eq!(windows_mouse_message_to_button(0x020B), None);
    }
}
