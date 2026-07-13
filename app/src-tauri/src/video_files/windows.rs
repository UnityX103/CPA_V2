use std::path::{Path, PathBuf};
use windows::core::PCWSTR;
use windows::Win32::Storage::FileSystem::{
    MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH, MOVE_FILE_FLAGS,
};

pub(super) fn atomic_replace_file(source: &Path, destination: &Path) -> std::io::Result<()> {
    use std::os::windows::ffi::OsStrExt;

    let source = source
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect::<Vec<_>>();
    let destination = destination
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect::<Vec<_>>();
    let flags = MOVE_FILE_FLAGS(MOVEFILE_REPLACE_EXISTING.0 | MOVEFILE_WRITE_THROUGH.0);
    unsafe {
        MoveFileExW(PCWSTR(source.as_ptr()), PCWSTR(destination.as_ptr()), flags)
            .map_err(|error| std::io::Error::other(error.to_string()))
    }
}

pub(super) fn prepare_playable_path(
    _app: &tauri::AppHandle,
    source: &Path,
) -> Result<PathBuf, String> {
    Ok(source.to_path_buf())
}
