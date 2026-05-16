//! Windows: low-level keyboard hook 不需要 TCC 类权限；granted 永真。
//! open_settings 跳到 ms-settings:privacy 的 Accessibility 子页（最接近的入口）。

pub fn open_settings() -> Result<(), String> {
    std::process::Command::new("cmd")
        .args(["/c", "start", "ms-settings:privacy-accessibility"])
        .spawn()
        .map_err(|e| format!("start failed: {e}"))?;
    Ok(())
}
