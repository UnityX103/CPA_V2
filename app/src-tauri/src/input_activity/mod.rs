#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "windows")]
mod windows;

/// Read only elapsed idle time on demand. No event taps, hooks, keys, or coordinates.
#[tauri::command]
pub fn sample_input_activity() -> Result<u64, String> {
    #[cfg(target_os = "macos")]
    return macos::idle_milliseconds();
    #[cfg(target_os = "windows")]
    return windows::idle_milliseconds();
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    Err("当前平台不支持键鼠活动检测".into())
}
