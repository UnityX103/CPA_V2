use std::path::{Path, PathBuf};

pub(super) fn prepare_playable_path(
    _app: &tauri::AppHandle,
    source: &Path,
) -> Result<PathBuf, String> {
    Ok(source.to_path_buf())
}

// Windows plays the owned WebM directly; the frontend gives each playback a fresh URL.
pub(super) fn clear_playable_cache(_app: &tauri::AppHandle, _source: &Path) -> Result<(), String> {
    Ok(())
}
