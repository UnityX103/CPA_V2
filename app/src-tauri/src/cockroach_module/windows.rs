use std::path::Path;
use std::process::Command;

pub fn runtime_target() -> &'static str {
    #[cfg(target_arch = "x86_64")]
    {
        "windows-x86_64"
    }
    #[cfg(not(target_arch = "x86_64"))]
    {
        "unsupported"
    }
}

pub fn restore_archive_permissions(_path: &Path, _mode: Option<u32>) -> Result<(), String> {
    Ok(())
}

pub fn restore_archive_symlink(_target: &Path, _output: &Path) -> Result<(), String> {
    Err("Windows 蟑螂组件不允许符号链接".to_string())
}

pub fn ensure_entry_executable(_path: &Path) -> Result<(), String> {
    Ok(())
}

pub fn configure_child_command(command: &mut Command) {
    use std::os::windows::process::CommandExt;
    command.creation_flags(0x08000000);
}
