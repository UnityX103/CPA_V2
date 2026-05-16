//! 透传命中区域：前端注册 UI rect → 平台原生层在每次 OS 命中测试时查询。
//! 详细设计见 docs/superpowers/specs/2026-05-15-overlay-hit-passthrough-design.md。

use std::collections::HashMap;
use std::sync::Mutex;
use serde::{Deserialize, Serialize};
use tauri::{State, WebviewWindow};

#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "windows")]
mod windows;
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
mod stub;

/// Window-local CSS-pixel 矩形，左上原点（与 DOMRect 一致）。平台层负责把 OS
/// 事件坐标转到此坐标系。
#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

impl Rect {
    pub fn contains(&self, x: f64, y: f64) -> bool {
        x >= self.x && x < self.x + self.w && y >= self.y && y < self.y + self.h
    }
}

/// 注册表：id → window-local rect。clone 出来一个 Arc 句柄交给原生层；前端
/// 通过 Tauri command 增删改 rect。
pub struct HitRegionStore {
    inner: Mutex<HashMap<String, Rect>>,
}

impl HitRegionStore {
    pub fn new() -> Self {
        Self { inner: Mutex::new(HashMap::new()) }
    }

    pub fn upsert(&self, id: String, rect: Rect) {
        self.inner.lock().unwrap().insert(id, rect);
    }

    pub fn remove(&self, id: &str) {
        self.inner.lock().unwrap().remove(id);
    }

    pub fn clear(&self) {
        self.inner.lock().unwrap().clear();
    }

    /// O(n) 全表线性扫描；命中即返回 true。n 通常 ≤ 5，不需要空间索引。
    pub fn hit_test(&self, x: f64, y: f64) -> bool {
        self.inner.lock().unwrap().values().any(|r| r.contains(x, y))
    }
}

#[tauri::command]
pub fn register_hit_region(state: State<'_, std::sync::Arc<HitRegionStore>>, id: String, rect: Rect) {
    state.upsert(id, rect);
}

#[tauri::command]
pub fn unregister_hit_region(state: State<'_, std::sync::Arc<HitRegionStore>>, id: String) {
    state.remove(&id);
}

#[tauri::command]
pub fn clear_hit_regions(state: State<'_, std::sync::Arc<HitRegionStore>>) {
    state.clear();
}

/// 计算 window 在 monitor 上水平 + 垂直居中时的左上角原点（logical pixel）。
/// 不对结果做 clamp —— 若 window 比 monitor 大，结果可能小于 monitor 起点，
/// OS 自行处理（多数情况下会自动移到可见区）。
pub fn compute_centered_origin(
    monitor_pos: (i32, i32),
    monitor_size: (u32, u32),
    window_size: (u32, u32),
) -> (i32, i32) {
    let x = monitor_pos.0 + (monitor_size.0 as i32 - window_size.0 as i32) / 2;
    let y = monitor_pos.1 + (monitor_size.1 as i32 - window_size.1 as i32) / 2;
    (x, y)
}

/// 在主窗口上安装平台原生 hit-test 钩子。在 setup() 内调用一次；失败仅打日志。
pub fn install(window: &WebviewWindow, store: std::sync::Arc<HitRegionStore>) {
    #[cfg(target_os = "macos")]
    macos::install_impl(window, store);
    #[cfg(target_os = "windows")]
    windows::install_impl(window, store);
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    stub::install_impl(window, store);
}

/// 在窗口/进程关闭时摘掉钩子；幂等。
pub fn uninstall(window: &WebviewWindow) {
    #[cfg(target_os = "macos")]
    macos::uninstall_impl(window);
    #[cfg(target_os = "windows")]
    windows::uninstall_impl(window);
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    stub::uninstall_impl(window);
}

/// 给一个 webview 窗口装上「接受 first-mouse」原生 hook（只解决首次点击不送 mouseDown
/// 的问题，不带 hit-test 透传逻辑）。用于设置窗口等不参与穿透的子窗。
pub fn install_first_mouse_only(window: &WebviewWindow) {
    #[cfg(target_os = "macos")]
    macos::install_first_mouse_only_impl(window);
    #[cfg(target_os = "windows")]
    windows::install_first_mouse_only_impl(window);
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    stub::install_first_mouse_only_impl(window);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn r(x: f64, y: f64, w: f64, h: f64) -> Rect {
        Rect { x, y, w, h }
    }

    #[test]
    fn empty_store_misses_everything() {
        let s = HitRegionStore::new();
        assert!(!s.hit_test(0.0, 0.0));
        assert!(!s.hit_test(100.0, 100.0));
    }

    #[test]
    fn single_rect_inside_hits_outside_misses() {
        let s = HitRegionStore::new();
        s.upsert("a".into(), r(10.0, 20.0, 30.0, 40.0));
        assert!(s.hit_test(10.0, 20.0));     // left-top inclusive
        assert!(s.hit_test(25.0, 35.0));     // interior
        assert!(s.hit_test(40.0 - 0.001, 60.0 - 0.001)); // just inside far edge
        assert!(!s.hit_test(40.0, 60.0));    // right-bottom exclusive
        assert!(!s.hit_test(9.999, 35.0));
        assert!(!s.hit_test(25.0, 60.0));
    }

    #[test]
    fn multiple_rects_union() {
        let s = HitRegionStore::new();
        s.upsert("a".into(), r(0.0, 0.0, 10.0, 10.0));
        s.upsert("b".into(), r(100.0, 100.0, 10.0, 10.0));
        assert!(s.hit_test(5.0, 5.0));
        assert!(s.hit_test(105.0, 105.0));
        assert!(!s.hit_test(50.0, 50.0));
    }

    #[test]
    fn upsert_same_id_replaces() {
        let s = HitRegionStore::new();
        s.upsert("a".into(), r(0.0, 0.0, 10.0, 10.0));
        s.upsert("a".into(), r(100.0, 100.0, 10.0, 10.0));
        assert!(!s.hit_test(5.0, 5.0));
        assert!(s.hit_test(105.0, 105.0));
    }

    #[test]
    fn remove_clears_rect() {
        let s = HitRegionStore::new();
        s.upsert("a".into(), r(0.0, 0.0, 10.0, 10.0));
        s.remove("a");
        assert!(!s.hit_test(5.0, 5.0));
    }

    #[test]
    fn clear_drops_all_rects() {
        let s = HitRegionStore::new();
        s.upsert("a".into(), r(0.0, 0.0, 10.0, 10.0));
        s.upsert("b".into(), r(100.0, 100.0, 10.0, 10.0));
        s.clear();
        assert!(!s.hit_test(5.0, 5.0));
        assert!(!s.hit_test(105.0, 105.0));
    }

    #[test]
    fn centered_origin_on_primary_monitor() {
        // Primary monitor at (0, 0), size 1920×1080; window 460×440 → (730, 320)
        assert_eq!(
            compute_centered_origin((0, 0), (1920, 1080), (460, 440)),
            (730, 320),
        );
    }

    #[test]
    fn centered_origin_on_secondary_monitor() {
        // Secondary monitor at (1920, 0), size 2560×1440; window 460×440 → (2970, 500)
        assert_eq!(
            compute_centered_origin((1920, 0), (2560, 1440), (460, 440)),
            (2970, 500),
        );
    }

    #[test]
    fn centered_origin_negative_monitor() {
        // Mac multi-monitor: secondary above-left at (-1280, -800), size 1280×800
        assert_eq!(
            compute_centered_origin((-1280, -800), (1280, 800), (460, 440)),
            (-870, -620),
        );
    }

    #[test]
    fn centered_origin_window_bigger_than_monitor() {
        // Edge case: window taller than monitor → y < monitor_pos.y; acceptable, OS will clamp.
        assert_eq!(
            compute_centered_origin((0, 0), (400, 300), (460, 440)),
            (-30, -70),
        );
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn main_thread_marker_returns_none_off_thread() {
        use objc2_foundation::MainThreadMarker;
        // cargo test 的测试线程并非 AppKit 主线程；objc2 应返回 None,
        // 这是 install_*_impl 里 `.expect("…")` 防御能在真实多线程下触发的前提。
        let from_test_thread = MainThreadMarker::new();
        assert!(
            from_test_thread.is_none(),
            "cargo test thread should not register as AppKit main thread"
        );

        // 进一步：显式 spawn 一个线程，确认 spawn 出的线程亦非主线程。
        let handle = std::thread::spawn(|| MainThreadMarker::new().is_none());
        assert!(
            handle.join().expect("thread joined"),
            "spawned thread must not see itself as main thread"
        );
    }
}
