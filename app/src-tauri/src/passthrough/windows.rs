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
use windows::Win32::UI::WindowsAndMessaging::{
    HTCLIENT, HTTRANSPARENT, MA_ACTIVATE, WM_MOUSEACTIVATE, WM_NCHITTEST,
};

const SUBCLASS_ID: usize = 0xCA0_FA11; // arbitrary, just must be stable & unique

unsafe extern "system" fn subclass_proc(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
    _id_subclass: usize,
    ref_data: usize,
) -> LRESULT {
    // WM_MOUSEACTIVATE：未激活窗口收到鼠标按下时由 OS 询问该不该激活、是否吞掉首事件。
    // 返回 MA_ACTIVATE = 激活窗口并将事件正常派发；避免首次点击只被用来激活而拖动失效。
    // 默认 DefWindowProc 多数情况下也返回 MA_ACTIVATE，这里显式声明做防御性。
    if msg == WM_MOUSEACTIVATE {
        return LRESULT(MA_ACTIVATE as isize);
    }

    // ref_data == 0 表示「first-mouse-only」安装路径，没有 store，跳过 hit-test 分支。
    if msg == WM_NCHITTEST && ref_data != 0 {
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

/// 给一个 webview 窗口装上仅处理 WM_MOUSEACTIVATE 的 subclass。复用 `subclass_proc`，
/// 通过 `ref_data = 0` 让 WM_NCHITTEST 分支降级到 DefSubclassProc。用于设置窗口等
/// 不需要 hit-test 穿透的子窗。
pub fn install_first_mouse_only_impl(window: &WebviewWindow) {
    let hwnd = match window.hwnd() {
        Ok(h) => HWND(h.0 as *mut _),
        Err(_) => {
            eprintln!("[passthrough/windows] hwnd() returned Err on first-mouse-only install; skipping");
            return;
        }
    };
    let ok = unsafe {
        SetWindowSubclass(hwnd, Some(subclass_proc), SUBCLASS_ID, 0)
    }
    .as_bool();
    if !ok {
        eprintln!("[passthrough/windows] SetWindowSubclass failed on first-mouse-only install");
    }
}
