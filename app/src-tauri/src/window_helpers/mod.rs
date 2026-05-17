use tauri::WebviewWindow;

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
