//! Windows window helpers for first-mouse and settings focus restoration.

use tauri::{Manager, WebviewWindow};
use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, POINT, RECT, WPARAM};
use windows::Win32::Graphics::Gdi::ScreenToClient;
use windows::Win32::UI::Shell::{DefSubclassProc, SetWindowSubclass};
use windows::Win32::UI::WindowsAndMessaging::{
    GetClientRect, SetWindowPos, HTTRANSPARENT, HWND_NOTOPMOST, HWND_TOPMOST, MA_ACTIVATE,
    SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, WM_MOUSEACTIVATE, WM_NCHITTEST,
};

use super::{main_panel_corner_radius, point_in_rounded_rect};

const FIRST_MOUSE_SUBCLASS_ID: usize = 0xCA0_FA11;
const MAIN_PANEL_HIT_TEST_SUBCLASS_ID: usize = 0xCA0_117E;

fn get_x_lparam(lparam: LPARAM) -> i16 {
    ((lparam.0 as usize) & 0xFFFF) as u16 as i16
}

fn get_y_lparam(lparam: LPARAM) -> i16 {
    (((lparam.0 as usize) >> 16) & 0xFFFF) as u16 as i16
}

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

unsafe extern "system" fn main_panel_hit_test_subclass_proc(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
    _id_subclass: usize,
    _ref_data: usize,
) -> LRESULT {
    if msg == WM_NCHITTEST {
        let mut rect = RECT::default();
        if unsafe { GetClientRect(hwnd, &mut rect) }.is_ok() {
            let mut point = POINT {
                x: get_x_lparam(lparam) as i32,
                y: get_y_lparam(lparam) as i32,
            };
            if unsafe { ScreenToClient(hwnd, &mut point) }.as_bool() {
                let width = (rect.right - rect.left) as f64;
                let height = (rect.bottom - rect.top) as f64;
                let radius = main_panel_corner_radius(width, height);
                if !point_in_rounded_rect(width, height, radius, point.x as f64, point.y as f64) {
                    return LRESULT(HTTRANSPARENT as isize);
                }
            }
        }
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

pub fn install_main_panel_hit_test_impl(window: &WebviewWindow) {
    let hwnd = match window.hwnd() {
        Ok(handle) => HWND(handle.0 as *mut _),
        Err(e) => {
            eprintln!("[window_helpers/windows] hwnd() failed during main hit-test install: {e}");
            return;
        }
    };
    let installed = unsafe {
        SetWindowSubclass(
            hwnd,
            Some(main_panel_hit_test_subclass_proc),
            MAIN_PANEL_HIT_TEST_SUBCLASS_ID,
            0,
        )
    }
    .as_bool();
    if !installed {
        eprintln!("[window_helpers/windows] SetWindowSubclass failed during main hit-test install");
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
