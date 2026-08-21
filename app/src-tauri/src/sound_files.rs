use serde::Serialize;
use std::fs::File;
use std::path::Path;
use tauri::{Manager, Runtime};

#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct CustomSoundValidation {
    pub ok: bool,
    pub message: Option<String>,
}

fn invalid(message: &str) -> CustomSoundValidation {
    CustomSoundValidation {
        ok: false,
        message: Some(message.to_string()),
    }
}

fn validate_mp3_path(path: &Path) -> CustomSoundValidation {
    if path.is_relative() {
        return invalid("铃声路径必须是绝对路径");
    }

    let is_mp3 = path
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("mp3"));
    if !is_mp3 {
        return invalid("请选择 .mp3 音频文件");
    }
    if !path.is_file() {
        return invalid("铃声文件不存在，请重新选择");
    }
    if File::open(path).is_err() {
        return invalid("铃声文件无法读取，请重新选择");
    }

    CustomSoundValidation {
        ok: true,
        message: None,
    }
}

fn allow_sound_asset_file<R: Runtime>(
    app: &tauri::AppHandle<R>,
    path: &Path,
) -> Result<(), String> {
    if !path.is_absolute() {
        return Err("铃声资源路径必须是绝对路径".to_string());
    }
    app.asset_protocol_scope()
        .allow_file(path)
        .map_err(|error| format!("无法授权铃声文件用于应用内播放：{error}"))
}

#[tauri::command]
pub fn validate_custom_sound_path(path: String) -> CustomSoundValidation {
    validate_mp3_path(Path::new(&path))
}

#[tauri::command]
pub fn prepare_custom_sound_path(app: tauri::AppHandle, path: String) -> Result<String, String> {
    let source = Path::new(&path);
    let validation = validate_mp3_path(source);
    if !validation.ok {
        return Err(validation
            .message
            .unwrap_or_else(|| "自定义铃声不可用".to_string()));
    }

    allow_sound_asset_file(&app, source)?;
    Ok(source.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::{validate_mp3_path, CustomSoundValidation};
    use std::fs;
    use std::path::Path;

    #[test]
    fn accepts_an_existing_absolute_mp3_path() {
        let dir = std::env::temp_dir().join(format!("cpa-sound-files-test-{}", std::process::id()));
        fs::create_dir_all(&dir).expect("create temp dir");
        let path = dir.join("focus-end.MP3");
        fs::write(&path, b"mp3").expect("write temp mp3");

        assert_eq!(
            validate_mp3_path(&path),
            CustomSoundValidation {
                ok: true,
                message: None,
            }
        );

        let _ = fs::remove_file(path);
        let _ = fs::remove_dir(dir);
    }

    #[test]
    fn rejects_non_mp3_missing_and_relative_paths() {
        let missing =
            std::env::temp_dir().join(format!("missing-cpa-sound-{}.mp3", std::process::id()));
        assert_eq!(
            validate_mp3_path(&missing).message.as_deref(),
            Some("铃声文件不存在，请重新选择")
        );
        assert_eq!(
            validate_mp3_path(Path::new("sounds/focus-end.mp3"))
                .message
                .as_deref(),
            Some("铃声路径必须是绝对路径")
        );
        assert_eq!(
            validate_mp3_path(Path::new("/tmp/focus-end.wav"))
                .message
                .as_deref(),
            Some("请选择 .mp3 音频文件")
        );
    }
}
