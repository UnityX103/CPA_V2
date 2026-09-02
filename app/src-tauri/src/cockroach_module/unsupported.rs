use std::path::Path;
use std::process::Command;

pub fn runtime_target() -> &'static str {
    "unsupported"
}

pub fn restore_archive_permissions(_path: &Path, _mode: Option<u32>) -> Result<(), String> {
    Ok(())
}

pub fn restore_archive_symlink(_target: &Path, _output: &Path) -> Result<(), String> {
    Err("当前平台不允许蟑螂组件符号链接".to_string())
}

pub fn ensure_entry_executable(_path: &Path) -> Result<(), String> {
    Ok(())
}

pub fn configure_child_command(_command: &mut Command) {}
