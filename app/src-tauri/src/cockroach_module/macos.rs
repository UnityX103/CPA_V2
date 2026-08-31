use std::path::Path;
use std::process::Command;

pub fn runtime_target() -> &'static str {
    #[cfg(target_arch = "aarch64")]
    {
        "macos-arm64"
    }
    #[cfg(target_arch = "x86_64")]
    {
        "macos-x86_64"
    }
    #[cfg(not(any(target_arch = "aarch64", target_arch = "x86_64")))]
    {
        "unsupported"
    }
}

pub fn restore_archive_permissions(path: &Path, mode: Option<u32>) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    let Some(mode) = mode else {
        return Ok(());
    };
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(mode & 0o777))
        .map_err(|error| format!("无法恢复模块文件权限：{error}"))
}

pub fn ensure_entry_executable(path: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o755))
        .map_err(|error| format!("无法设置模块启动权限：{error}"))
}

pub fn configure_child_command(_command: &mut Command) {}

pub fn trigger_kill_all() -> Result<(), String> {
    use core_graphics::event::{CGEvent, CGEventFlags, CGEventTapLocation};
    use core_graphics::event_source::{CGEventSource, CGEventSourceStateID};

    const ANSI_K_KEY_CODE: u16 = 40;
    let source = CGEventSource::new(CGEventSourceStateID::HIDSystemState)
        .map_err(|_| "无法创建杀死所有快捷键事件源".to_string())?;
    let key_down = CGEvent::new_keyboard_event(source.clone(), ANSI_K_KEY_CODE, true)
        .map_err(|_| "无法创建杀死所有按键事件".to_string())?;
    key_down.set_flags(CGEventFlags::CGEventFlagCommand);
    key_down.post(CGEventTapLocation::HID);
    let key_up = CGEvent::new_keyboard_event(source, ANSI_K_KEY_CODE, false)
        .map_err(|_| "无法创建杀死所有按键事件".to_string())?;
    key_up.set_flags(CGEventFlags::CGEventFlagCommand);
    key_up.post(CGEventTapLocation::HID);
    Ok(())
}
