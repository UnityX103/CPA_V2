use std::path::Path;
use std::process::Command;

pub fn runtime_target() -> &'static str {
    "unsupported"
}

pub fn restore_archive_permissions(_path: &Path, _mode: Option<u32>) -> Result<(), String> {
    Ok(())
}

pub fn ensure_entry_executable(_path: &Path) -> Result<(), String> {
    Ok(())
}

pub fn configure_child_command(_command: &mut Command) {}

pub fn trigger_kill_all() -> Result<(), String> {
    Err("当前平台不支持杀死所有快捷键".to_string())
}
