use serde::Serialize;
use std::fs::File;
use std::path::Path;
use tauri::{Manager, Runtime};

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
    use super::{validate_webm_path, CustomVideoValidation};
    use std::fs;
    use std::path::Path;

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
