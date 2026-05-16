use serde::Serialize;
use std::path::Path;

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

pub(crate) fn validate_webm_path(path: &Path) -> CustomVideoValidation {
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

    CustomVideoValidation {
        ok: true,
        message: None,
    }
}

#[tauri::command]
pub fn validate_custom_video_path(path: String) -> CustomVideoValidation {
    validate_webm_path(Path::new(&path))
}

#[cfg(test)]
mod tests {
    use super::{validate_webm_path, CustomVideoValidation};
    use std::fs;
    use std::path::Path;

    #[test]
    fn accepts_existing_absolute_webm_path() {
        let dir = std::env::temp_dir().join(format!("cpa-video-files-test-{}", std::process::id()));
        fs::create_dir_all(&dir).expect("create temp dir");
        let path = dir.join("completion.WEBM");
        fs::write(&path, b"webm").expect("write temp webm");

        assert_eq!(
            validate_webm_path(&path),
            CustomVideoValidation {
                ok: true,
                message: None
            }
        );

        let _ = fs::remove_file(path);
        let _ = fs::remove_dir(dir);
    }

    #[test]
    fn rejects_missing_webm_path() {
        let path =
            std::env::temp_dir().join(format!("missing-cpa-video-{}.webm", std::process::id()));

        assert_eq!(
            validate_webm_path(&path),
            CustomVideoValidation {
                ok: false,
                message: Some("视频文件不存在，请重新选择".to_string())
            }
        );
    }

    #[test]
    fn rejects_non_webm_extension() {
        let path =
            std::env::temp_dir().join(format!("missing-cpa-video-{}.mp4", std::process::id()));

        assert_eq!(
            validate_webm_path(&path),
            CustomVideoValidation {
                ok: false,
                message: Some("请选择 .webm 视频文件".to_string())
            }
        );
    }

    #[test]
    fn rejects_relative_path() {
        assert_eq!(
            validate_webm_path(Path::new("videos/completion.webm")),
            CustomVideoValidation {
                ok: false,
                message: Some("视频路径必须是绝对路径".to_string())
            }
        );
    }
}
