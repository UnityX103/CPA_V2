use std::fs;
use std::path::Path;

pub(super) fn replace_file_atomically(
    temporary: &Path,
    destination: &Path,
    action: &str,
) -> Result<(), String> {
    fs::rename(temporary, destination).map_err(|error| format!("无法{action}：{error}"))
}
