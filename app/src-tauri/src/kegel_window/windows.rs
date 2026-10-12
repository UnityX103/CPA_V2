use tauri::WebviewWindow;
use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, POINT, RECT, WPARAM};
use windows::Win32::Graphics::Gdi::ScreenToClient;
use windows::Win32::UI::Shell::{DefSubclassProc, SetWindowSubclass};
use windows::Win32::UI::WindowsAndMessaging::{GetClientRect, HTTRANSPARENT, MA_ACTIVATE, WM_MOUSEACTIVATE, WM_NCHITTEST};

unsafe extern "system" fn hit_test(hwnd: HWND, msg: u32, w: WPARAM, l: LPARAM, _id: usize, _data: usize) -> LRESULT {
    if msg == WM_MOUSEACTIVATE { return LRESULT(MA_ACTIVATE as isize); }
    if msg == WM_NCHITTEST {
        let mut rect = RECT::default();
        let mut point = POINT { x: (l.0 as u16 as i16) as i32, y: ((l.0 >> 16) as u16 as i16) as i32 };
        if unsafe { GetClientRect(hwnd, &mut rect) }.is_ok() && unsafe { ScreenToClient(hwnd, &mut point) }.as_bool()
            && !super::contains(point.x as f64, point.y as f64, (rect.right - rect.left) as f64, (rect.bottom - rect.top) as f64) {
            return LRESULT(HTTRANSPARENT as isize);
        }
    }
    unsafe { DefSubclassProc(hwnd, msg, w, l) }
}
pub fn install(window: &WebviewWindow) -> Result<(), String> {
    let hwnd = window.hwnd().map_err(|e| e.to_string())?;
    if unsafe { SetWindowSubclass(HWND(hwnd.0 as *mut _), Some(hit_test), 0xCA0_0E6_u32 as usize, 0) }.as_bool() { Ok(()) }
    else { Err("could not install kegel hit testing".into()) }
}
