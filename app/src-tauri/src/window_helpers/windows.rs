//! Windows window helpers for first-mouse and settings focus restoration.

use tauri::{Manager, WebviewWindow};
use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
use windows::Win32::UI::Shell::{DefSubclassProc, SetWindowSubclass};
use windows::Win32::UI::WindowsAndMessaging::{
    SetWindowPos, HWND_NOTOPMOST, HWND_TOPMOST, MA_ACTIVATE, SWP_NOACTIVATE, SWP_NOMOVE,
    SWP_NOSIZE, WM_MOUSEACTIVATE,
};

const FIRST_MOUSE_SUBCLASS_ID: usize = 0xCA0_FA11;

unsafe extern "system" fn first_mouse_subclass_proc(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
    _id_subclass: usize,
    _ref_data: usize,
) -> LRESULT {
    if msg == WM_MOUSEACTIVATE {
        return LRESULT(MA_ACTIVATE as isize);
    }

    unsafe { DefSubclassProc(hwnd, msg, wparam, lparam) }
}

/// Install a subclass that lets the settings window's first click activate and
/// deliver the mouse event, preserving drag behavior when the window is inactive.
pub fn install_first_mouse_only_impl(window: &WebviewWindow) {
    let hwnd = match window.hwnd() {
        Ok(h) => HWND(h.0 as *mut _),
        Err(_) => {
            eprintln!("[window_helpers/windows] hwnd() returned Err on first-mouse-only install; skipping");
            return;
        }
    };
    let ok = unsafe {
        SetWindowSubclass(
            hwnd,
            Some(first_mouse_subclass_proc),
            FIRST_MOUSE_SUBCLASS_ID,
            0,
        )
    }
    .as_bool();
    if !ok {
        eprintln!("[window_helpers/windows] SetWindowSubclass failed on first-mouse-only install");
    }
}

/// Restore focus to settings after main-window move/resize events. Tauri events
/// cover user drag and programmatic movement paths.
pub fn install_focus_restorer_impl(main_window: &WebviewWindow, app: tauri::AppHandle) {
    main_window.on_window_event(move |event| {
        let triggered = matches!(event, tauri::WindowEvent::Moved(_))
            || matches!(event, tauri::WindowEvent::Resized(_));
        if !triggered {
            return;
        }
        if let Some(settings) = app.get_webview_window("settings") {
            if settings.is_visible().unwrap_or(false) {
                match settings.set_focus() {
                    Ok(()) => eprintln!("[focus_restorer] focus restored to settings"),
                    Err(e) => eprintln!("[focus_restorer] set_focus failed: {e}"),
                }
            }
        }
    });
}

pub fn set_always_on_top_native_impl(window: &WebviewWindow, on_top: bool) -> Result<(), String> {
    let hwnd = window
        .hwnd()
        .map(|h| HWND(h.0 as *mut _))
        .map_err(|e| format!("hwnd() failed for set_always_on_top_native: {e}"))?;
    unsafe {
        SetWindowPos(
            hwnd,
            if on_top { HWND_TOPMOST } else { HWND_NOTOPMOST },
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
        )
    }
    .map_err(|e| format!("SetWindowPos({on_top}) failed: {e}"))
}
