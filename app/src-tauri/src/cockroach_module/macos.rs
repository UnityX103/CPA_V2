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

pub fn restore_archive_symlink(target: &Path, output: &Path) -> Result<(), String> {
    std::os::unix::fs::symlink(target, output)
        .map_err(|error| format!("无法恢复组件符号链接：{error}"))
}

pub fn ensure_entry_executable(path: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o755))
        .map_err(|error| format!("无法设置模块启动权限：{error}"))
}

pub fn configure_child_command(_command: &mut Command) {}
