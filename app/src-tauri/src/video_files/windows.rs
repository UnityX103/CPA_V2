use std::path::{Path, PathBuf};

pub(super) fn prepare_playable_path(
    _app: &tauri::AppHandle,
    source: &Path,
) -> Result<PathBuf, String> {
    Ok(source.to_path_buf())
}
