use tauri::WebviewWindow;

pub(crate) const MAIN_PANEL_BASE_WIDTH: f64 = 233.0;
pub(crate) const MAIN_PANEL_BASE_HEIGHT: f64 = 155.0;
pub(crate) const MAIN_PANEL_CORNER_RADIUS: f64 = 24.0;

#[cfg(target_os = "macos")]
mod macos;
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
mod stub;
#[cfg(target_os = "windows")]
mod windows;

/// Compute the top-left origin for centering a window inside a monitor.
///
/// Results are not clamped. If the window is larger than the monitor, the OS
/// may later move it into a visible region.
pub fn compute_centered_origin(
    monitor_pos: (i32, i32),
    monitor_size: (u32, u32),
    window_size: (u32, u32),
) -> (i32, i32) {
    let x = monitor_pos.0 + (monitor_size.0 as i32 - window_size.0 as i32) / 2;
    let y = monitor_pos.1 + (monitor_size.1 as i32 - window_size.1 as i32) / 2;
    (x, y)
}

/// Install the native hook that lets an inactive child window receive the
/// first mouse-down event. This does not install hit-test passthrough.
pub fn install_first_mouse_only(window: &WebviewWindow) {
    #[cfg(target_os = "macos")]
    macos::install_first_mouse_only_impl(window);
    #[cfg(target_os = "windows")]
    windows::install_first_mouse_only_impl(window);
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    stub::install_first_mouse_only_impl(window);
}

/// Restrict the main window's native mouse hit area to the visible rounded
/// Pomodoro panel. Transparent corner pixels pass through to windows below.
pub fn install_main_panel_hit_test(window: &WebviewWindow) {
    #[cfg(target_os = "macos")]
    macos::install_main_panel_hit_test_impl(window);
    #[cfg(target_os = "windows")]
    windows::install_main_panel_hit_test_impl(window);
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    stub::install_main_panel_hit_test_impl(window);
}

pub(crate) fn main_panel_corner_radius(width: f64, height: f64) -> f64 {
    let scale = (width / MAIN_PANEL_BASE_WIDTH)
        .min(height / MAIN_PANEL_BASE_HEIGHT)
        .max(0.0);
    MAIN_PANEL_CORNER_RADIUS * scale
}

pub(crate) fn point_in_rounded_rect(width: f64, height: f64, radius: f64, x: f64, y: f64) -> bool {
    if !width.is_finite()
        || !height.is_finite()
        || !radius.is_finite()
        || !x.is_finite()
        || !y.is_finite()
        || width <= 0.0
        || height <= 0.0
        || x < 0.0
        || x > width
        || y < 0.0
        || y > height
    {
        return false;
    }

    let radius = radius.max(0.0).min(width / 2.0).min(height / 2.0);
    if radius == 0.0
        || (x >= radius && x <= width - radius)
        || (y >= radius && y <= height - radius)
    {
        return true;
    }

    let center_x = if x < radius { radius } else { width - radius };
    let center_y = if y < radius { radius } else { height - radius };
    let dx = x - center_x;
    let dy = y - center_y;
    dx * dx + dy * dy <= radius * radius
}

/// Install native focus restoration so moving/resizing the main window returns
/// focus to the settings window when it is visible.
pub fn install_focus_restorer(main_window: &WebviewWindow, app: tauri::AppHandle) {
    #[cfg(target_os = "macos")]
    macos::install_focus_restorer_impl(main_window, app);
    #[cfg(target_os = "windows")]
    windows::install_focus_restorer_impl(main_window, app);
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    stub::install_focus_restorer_impl(main_window, app);
}

/// Re-assert always-on-top through the native backend when the platform needs
/// a stronger hint than Tauri's cross-platform window flag.
pub fn set_always_on_top_native(window: &WebviewWindow, on_top: bool) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    return windows::set_always_on_top_native_impl(window, on_top);
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (window, on_top);
        Ok(())
    }
}

/// Testing helper: manually post NSWindowDidMoveNotification so the macOS
/// focus-restorer observer can be triggered by the E2E test path.
#[cfg(target_os = "macos")]
pub fn post_did_move_notification_for_testing(window: &WebviewWindow) {
    macos::post_did_move_notification_for_testing_impl(window);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn centered_origin_on_primary_monitor() {
        assert_eq!(
            compute_centered_origin((0, 0), (1920, 1080), (460, 440)),
            (730, 320),
        );
    }

    #[test]
    fn centered_origin_on_secondary_monitor() {
        assert_eq!(
            compute_centered_origin((1920, 0), (2560, 1440), (460, 440)),
            (2970, 500),
        );
    }

    #[test]
    fn centered_origin_negative_monitor() {
        assert_eq!(
            compute_centered_origin((-1280, -800), (1280, 800), (460, 440)),
            (-870, -620),
        );
    }

    #[test]
    fn centered_origin_window_bigger_than_monitor() {
        assert_eq!(
            compute_centered_origin((0, 0), (400, 300), (460, 440)),
            (-30, -70),
        );
    }

    #[test]
    fn main_panel_hit_test_follows_rounded_panel_edges() {
        assert!(point_in_rounded_rect(233.0, 155.0, 24.0, 116.5, 77.5));
        assert!(point_in_rounded_rect(233.0, 155.0, 24.0, 0.0, 24.0));
        assert!(point_in_rounded_rect(233.0, 155.0, 24.0, 233.0, 131.0));
        assert!(!point_in_rounded_rect(233.0, 155.0, 24.0, 0.0, 0.0));
        assert!(!point_in_rounded_rect(233.0, 155.0, 24.0, 232.0, 1.0));
        assert!(!point_in_rounded_rect(233.0, 155.0, 24.0, -0.1, 77.5));
    }

    #[test]
    fn main_panel_hit_test_scales_with_the_window() {
        let radius = main_panel_corner_radius(466.0, 310.0);
        assert_eq!(radius, 48.0);
        assert!(point_in_rounded_rect(466.0, 310.0, radius, 0.0, 48.0));
        assert!(!point_in_rounded_rect(466.0, 310.0, radius, 0.0, 0.0));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn main_thread_marker_returns_none_off_thread() {
        use objc2_foundation::MainThreadMarker;

        let from_test_thread = MainThreadMarker::new();
        assert!(
            from_test_thread.is_none(),
            "cargo test thread should not register as AppKit main thread"
        );

        let handle = std::thread::spawn(|| MainThreadMarker::new().is_none());
        assert!(
            handle.join().expect("thread joined"),
            "spawned thread must not see itself as main thread"
        );
    }
}
