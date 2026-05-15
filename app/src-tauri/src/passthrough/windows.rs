//! Windows hit-test 透传：用 SetWindowSubclass 注入 WndProc，处理 WM_NCHITTEST。
//! 命中 UI region 时返回 HTCLIENT（让默认路由把事件投到 WebView2 子窗口），
//! 否则返回 HTTRANSPARENT（OS 视该窗口在此点不存在 → 事件去 z-order 下一个）。

use super::HitRegionStore;
use std::sync::Arc;
use tauri::WebviewWindow;
use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, POINT, WPARAM};
use windows::Win32::Graphics::Gdi::ScreenToClient;
use windows::Win32::UI::Controls::{
    DefSubclassProc, RemoveWindowSubclass, SetWindowSubclass,
};
use windows::Win32::UI::HiDpi::GetDpiForWindow;
use windows::Win32::UI::WindowsAndMessaging::{HTCLIENT, HTTRANSPARENT, WM_NCHITTEST};

const SUBCLASS_ID: usize = 0xCA0_FA11; // arbitrary, just must be stable & unique

unsafe extern "system" fn subclass_proc(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
    _id_subclass: usize,
    ref_data: usize,
) -> LRESULT {
    if msg == WM_NCHITTEST {
        let store = unsafe { &*(ref_data as *const HitRegionStore) };
        // LPARAM 低 16 位 = screen X，高 16 位 = screen Y；都是 i16。
        let raw = lparam.0 as isize;
        let screen_x = ((raw & 0xFFFF) as i16) as i32;
        let screen_y = (((raw >> 16) & 0xFFFF) as i16) as i32;
        let mut pt = POINT { x: screen_x, y: screen_y };
        if unsafe { ScreenToClient(hwnd, &mut pt) }.as_bool() {
            let dpi = unsafe { GetDpiForWindow(hwnd) };
            let scale = if dpi == 0 { 1.0 } else { dpi as f64 / 96.0 };
            let x = pt.x as f64 / scale;
            let y = pt.y as f64 / scale;
            if store.hit_test(x, y) {
                return LRESULT(HTCLIENT as isize);
            } else {
                return LRESULT(HTTRANSPARENT as isize);
            }
        }
    }
    unsafe { DefSubclassProc(hwnd, msg, wparam, lparam) }
}

pub fn install_impl(window: &WebviewWindow, store: Arc<HitRegionStore>) {
    let hwnd = match window.hwnd() {
        Ok(h) => HWND(h.0 as *mut _),
        Err(_) => {
            eprintln!("[passthrough/windows] hwnd() returned Err; skipping install");
            return;
        }
    };
    // Leak Arc → raw ptr; uninstall_impl 收回。
    let raw: *const HitRegionStore = Arc::into_raw(store);
    let ok = unsafe {
        SetWindowSubclass(hwnd, Some(subclass_proc), SUBCLASS_ID, raw as usize)
    }
    .as_bool();
    if !ok {
        eprintln!("[passthrough/windows] SetWindowSubclass failed");
        // 失败时把 Arc 收回防止泄漏
        unsafe { let _ = Arc::from_raw(raw); };
    }
}

pub fn uninstall_impl(window: &WebviewWindow) {
    let hwnd = match window.hwnd() {
        Ok(h) => HWND(h.0 as *mut _),
        Err(_) => return,
    };
    // ref_data 拿不回来；只能在 install 时另存一份指针。这里简化：直接 remove，
    // Arc 在 install 路径 leak 后由进程退出收回（与 macOS 当前同策略，文档化）。
    unsafe { let _ = RemoveWindowSubclass(hwnd, Some(subclass_proc), SUBCLASS_ID); };
}
