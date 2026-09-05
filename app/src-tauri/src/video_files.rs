use serde::Serialize;
use std::fs::{self, File, OpenOptions};
use std::io;
use std::path::Path;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{Manager, Runtime};

// Imports and conversion use the same slot; never transcode a file while replacing it.
static CUSTOM_VIDEO_LOCK: Mutex<()> = Mutex::new(());
const OWNED_VIDEO_NAME: &str = "提示视频.webm";

#[cfg(target_os = "macos")]
#[path = "video_files/macos.rs"]
mod platform;

#[cfg(target_os = "windows")]
#[path = "video_files/windows.rs"]
mod platform;

#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct CustomVideoValidation {
    pub ok: bool,
    pub message: Option<String>,
}

fn invalid(message: &str) -> CustomVideoValidation {
    CustomVideoValidation {
        ok: false,
        message: Some(message.to_string()),
    }
}

fn allow_video_asset_file<R: Runtime>(
    app: &tauri::AppHandle<R>,
    path: &Path,
) -> Result<(), String> {
    if !path.is_absolute() {
        return Err("视频资源路径必须是绝对路径".to_string());
    }
    app.asset_protocol_scope()
        .allow_file(path)
        .map_err(|error| format!("无法授权视频文件用于应用内播放：{error}"))
}

fn validate_webm_path(path: &Path) -> CustomVideoValidation {
    if path.is_relative() {
        return invalid("视频路径必须是绝对路径");
    }

    let is_webm = path
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("webm"));
    if !is_webm {
        return invalid("请选择 .webm 视频文件");
    }
    if !path.is_file() {
        return invalid("视频文件不存在，请重新选择");
    }
    if File::open(path).is_err() {
        return invalid("视频文件无法读取，请重新选择");
    }

    CustomVideoValidation {
        ok: true,
        message: None,
    }
}

fn import_owned_webm(source: &Path, directory: &Path) -> Result<PathBuf, String> {
    let validation = validate_webm_path(source);
    if !validation.ok {
        return Err(validation
            .message
            .unwrap_or_else(|| "自定义视频不可用".into()));
    }
    fs::create_dir_all(directory).map_err(|error| format!("无法创建提示视频目录：{error}"))?;
    let destination = directory.join(OWNED_VIDEO_NAME);
    if let (Ok(source_path), Ok(destination_path)) =
        (fs::canonicalize(source), fs::canonicalize(&destination))
    {
        if source_path == destination_path {
            return Ok(destination);
        }
    }
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_nanos();
    let temporary = directory.join(format!(".import-{}-{stamp}.webm", std::process::id()));
    let mut output = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temporary)
        .map_err(|error| format!("无法创建提示视频副本：{error}"))?;
    let result = (|| {
        let mut input = File::open(source).map_err(|error| format!("无法读取视频文件：{error}"))?;
        let expected = input.metadata().map_err(|error| error.to_string())?.len();
        let copied = io::copy(&mut input, &mut output)
            .map_err(|error| format!("无法复制提示视频：{error}"))?;
        if copied == 0 || copied != expected {
            return Err("视频文件为空或复制过程中发生变化，请重新选择".into());
        }
        output
            .sync_all()
            .map_err(|error| format!("无法保存提示视频副本：{error}"))?;
        // Release the handles before replacement, including on Windows.
        drop(output);
        drop(input);
        crate::extension_packs::replace_file_atomically(&temporary, &destination, "替换提示视频")?;
        Ok(destination)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

#[tauri::command]
pub async fn import_custom_video(app: tauri::AppHandle, path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = CUSTOM_VIDEO_LOCK
            .lock()
            .map_err(|_| "提示视频导入状态不可用".to_string())?;
        let directory = app
            .path()
            .app_data_dir()
            .map_err(|error| error.to_string())?
            .join("media")
            .join("pomodoro-end");
        let validation = validate_webm_path(Path::new(&path));
        if !validation.ok {
            return Err(validation
                .message
                .unwrap_or_else(|| "自定义视频不可用".into()));
        }
        // Scope only the single app-owned slot, before changing its content.
        allow_video_asset_file(&app, &directory.join(OWNED_VIDEO_NAME))?;
        // Cached playback is regenerable; abort before replacing the source if it cannot be cleared.
        platform::clear_playable_cache(&app, &directory.join(OWNED_VIDEO_NAME))?;
        let destination = import_owned_webm(Path::new(&path), &directory)?;
        Ok(destination.to_string_lossy().into_owned())
    })
    .await
    .map_err(|error| format!("提示视频导入任务异常结束：{error}"))?
}

#[tauri::command]
pub fn validate_custom_video_path(path: String) -> CustomVideoValidation {
    validate_webm_path(Path::new(&path))
}

#[tauri::command]
pub async fn prepare_custom_alpha_video_path(
    app: tauri::AppHandle,
    path: String,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = CUSTOM_VIDEO_LOCK
            .lock()
            .map_err(|_| "提示视频状态不可用".to_string())?;
        let source = Path::new(&path);
        let validation = validate_webm_path(source);
        if !validation.ok {
            return Err(validation
                .message
                .unwrap_or_else(|| "自定义视频不可用".to_string()));
        }

        let playable_path = platform::prepare_playable_path(&app, source)?;
        allow_video_asset_file(&app, &playable_path)?;
        Ok(playable_path.to_string_lossy().into_owned())
    })
    .await
    .map_err(|error| format!("透明视频准备任务异常结束：{error}"))?
}

#[cfg(test)]
mod tests {
    use super::{import_owned_webm, validate_webm_path, CustomVideoValidation, OWNED_VIDEO_NAME};
    use std::fs;
    use std::path::Path;

    fn test_directory() -> std::path::PathBuf {
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let directory =
            std::env::temp_dir().join(format!("cpa-owned-video-{}-{stamp}", std::process::id()));
        fs::create_dir_all(&directory).unwrap();
        directory
    }

    #[test]
    fn imported_video_survives_source_deletion_and_replacement_keeps_only_one_copy() {
        let root = test_directory();
        let source = root.join("source.webm");
        let owned = root.join("owned");
        fs::write(&source, b"first video").unwrap();
        let target = import_owned_webm(&source, &owned).unwrap();
        fs::remove_file(&source).unwrap();
        assert!(validate_webm_path(&target).ok);
        assert_eq!(fs::read(&target).unwrap(), b"first video");
        let replacement = root.join("replacement.webm");
        fs::write(&replacement, b"second video").unwrap();
        assert_eq!(import_owned_webm(&replacement, &owned).unwrap(), target);
        assert_eq!(fs::read(&target).unwrap(), b"second video");
        assert_eq!(fs::read(&replacement).unwrap(), b"second video");
        assert_eq!(fs::read_dir(&owned).unwrap().count(), 1);
        assert_eq!(import_owned_webm(&target, &owned).unwrap(), target);
        assert_eq!(fs::read(&target).unwrap(), b"second video");
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn failed_import_preserves_previous_copy_and_removes_partial_files() {
        let root = test_directory();
        let source = root.join("good.webm");
        let owned = root.join("owned");
        fs::write(&source, b"good video").unwrap();
        let target = import_owned_webm(&source, &owned).unwrap();
        let empty = root.join("empty.webm");
        fs::write(&empty, b"").unwrap();
        assert!(import_owned_webm(&empty, &owned).is_err());
        assert!(import_owned_webm(&root.join("missing.webm"), &owned).is_err());
        assert_eq!(fs::read(&target).unwrap(), b"good video");
        assert_eq!(fs::read_dir(&owned).unwrap().count(), 1);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn replacement_failure_cleans_up_staging_without_removing_the_destination() {
        let root = test_directory();
        let source = root.join("source.webm");
        fs::write(&source, b"video").unwrap();
        let owned = root.join("owned");
        fs::create_dir_all(owned.join(OWNED_VIDEO_NAME)).unwrap();
        fs::write(owned.join(OWNED_VIDEO_NAME).join("keep.txt"), b"keep").unwrap();
        assert!(import_owned_webm(&source, &owned).is_err());
        assert_eq!(fs::read_dir(&owned).unwrap().count(), 1);
        assert_eq!(
            fs::read(owned.join(OWNED_VIDEO_NAME).join("keep.txt")).unwrap(),
            b"keep"
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn accepts_an_existing_absolute_webm_path() {
        let dir = std::env::temp_dir().join(format!("cpa-video-files-test-{}", std::process::id()));
        fs::create_dir_all(&dir).expect("create temp dir");
        let path = dir.join("completion.WEBM");
        fs::write(&path, b"webm").expect("write temp webm");

        assert_eq!(
            validate_webm_path(&path),
            CustomVideoValidation {
                ok: true,
                message: None,
            }
        );

        let _ = fs::remove_file(path);
        let _ = fs::remove_dir(dir);
    }

    #[test]
    fn rejects_missing_and_relative_paths() {
        let missing =
            std::env::temp_dir().join(format!("missing-cpa-video-{}.webm", std::process::id()));
        assert_eq!(
            validate_webm_path(&missing).message.as_deref(),
            Some("视频文件不存在，请重新选择")
        );
        assert_eq!(
            validate_webm_path(Path::new("videos/completion.webm"))
                .message
                .as_deref(),
            Some("视频路径必须是绝对路径")
        );
    }
}
