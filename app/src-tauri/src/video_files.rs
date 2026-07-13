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

pub(crate) fn allow_video_asset_file<R: Runtime>(
    app: &tauri::AppHandle<R>,
    path: &Path,
) -> Result<(), String> {
    if !path.is_absolute() {
        return Err("视频资源路径必须是绝对路径".to_string());
    }
    app.asset_protocol_scope()
        .allow_file(path)
        .map_err(|error| format!("无法授权视频文件用于应用内预览：{error}"))
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
        prepare_custom_alpha_video_path_blocking(app, path)
    })
    .await
    .map_err(|error| format!("透明视频预览任务异常结束：{error}"))?
}

fn prepare_custom_alpha_video_path_blocking(
    app: tauri::AppHandle,
    path: String,
) -> Result<String, String> {
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
}

#[cfg(test)]
mod tests {
    #[cfg(target_os = "macos")]
    use super::platform::{
        alpha_cache_filename, alpha_tmp_path, ffmpeg_alpha_transcode_arguments,
        run_ffmpeg_alpha_transcode_with_program, sanitize_cache_stem,
    };
    use super::{allow_video_asset_file, validate_webm_path, CustomVideoValidation};
    use std::fs;
    use std::path::Path;
    use tauri::Manager;

    #[test]
    fn video_asset_scope_allows_only_the_requested_file() {
        let dir =
            std::env::temp_dir().join(format!("cpa-video-asset-scope-test-{}", std::process::id()));
        fs::create_dir_all(&dir).expect("create temp dir");
        let requested = dir.join("requested.webm");
        let sibling = dir.join("sibling.webm");
        fs::write(&sibling, b"sibling").expect("write sibling video");

        let app = tauri::test::mock_app();
        allow_video_asset_file(app.handle(), &requested).expect("allow requested video");
        fs::write(&requested, b"requested").expect("write requested video");
        let scope = app.asset_protocol_scope();

        assert!(scope.is_allowed(&requested));
        assert!(!scope.is_allowed(&sibling));

        let _ = fs::remove_file(requested);
        let _ = fs::remove_file(sibling);
        let _ = fs::remove_dir(dir);
    }

    #[test]
    fn accepts_existing_absolute_lowercase_webm_path() {
        let dir = std::env::temp_dir().join(format!(
            "cpa-video-files-lowercase-test-{}",
            std::process::id()
        ));
        fs::create_dir_all(&dir).expect("create temp dir");
        let path = dir.join("completion.webm");
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
    fn accepts_existing_absolute_uppercase_webm_path() {
        let dir = std::env::temp_dir().join(format!(
            "cpa-video-files-uppercase-test-{}",
            std::process::id()
        ));
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

    #[cfg(unix)]
    #[test]
    fn rejects_an_unreadable_webm_path() {
        use std::os::unix::fs::PermissionsExt;

        let dir = std::env::temp_dir().join(format!(
            "cpa-video-files-unreadable-test-{}",
            std::process::id()
        ));
        fs::create_dir_all(&dir).expect("create temp dir");
        let path = dir.join("completion.webm");
        fs::write(&path, b"webm").expect("write temp webm");
        let mut permissions = fs::metadata(&path).unwrap().permissions();
        permissions.set_mode(0o000);
        fs::set_permissions(&path, permissions).unwrap();

        assert_eq!(
            validate_webm_path(&path),
            CustomVideoValidation {
                ok: false,
                message: Some("视频文件无法读取，请重新选择".to_string())
            }
        );

        let mut permissions = fs::metadata(&path).unwrap().permissions();
        permissions.set_mode(0o600);
        let _ = fs::set_permissions(&path, permissions);
        let _ = fs::remove_file(path);
        let _ = fs::remove_dir(dir);
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

    #[cfg(target_os = "macos")]
    #[test]
    fn alpha_cache_filename_keeps_extension_and_hashes_absolute_path() {
        let a = alpha_cache_filename(Path::new("/Users/xpy/Videos/focus end.webm"));
        let b = alpha_cache_filename(Path::new("/Users/xpy/Other/focus end.webm"));

        assert!(a.starts_with("focus-end-"));
        assert!(a.contains("-v2-"));
        assert!(a.ends_with(".mov"));
        assert_ne!(a, b);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn sanitize_cache_stem_replaces_path_unfriendly_characters() {
        assert_eq!(sanitize_cache_stem("focus end 千千"), "focus-end---");
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn alpha_transcode_temp_path_keeps_a_mov_extension_for_ffmpeg_muxer_detection() {
        let target = Path::new("/tmp/cpa-alpha/focus-end.mov");
        let temp = alpha_tmp_path(target);

        assert_eq!(temp, Path::new("/tmp/cpa-alpha/.focus-end.tmp.mov"));
        assert_eq!(
            temp.extension().and_then(|value| value.to_str()),
            Some("mov")
        );
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn alpha_transcode_explicitly_selects_the_mov_muxer() {
        let arguments = ffmpeg_alpha_transcode_arguments(
            Path::new("/tmp/source.webm"),
            Path::new("/tmp/output.partial.mov"),
        );
        let arguments: Vec<String> = arguments
            .into_iter()
            .map(|argument| argument.to_string_lossy().into_owned())
            .collect();

        assert!(arguments.windows(2).any(|pair| pair == ["-f", "mov"]));
        assert!(arguments
            .windows(2)
            .any(|pair| pair == ["-movflags", "+faststart"]));
        assert_eq!(
            arguments.last().map(String::as_str),
            Some("/tmp/output.partial.mov")
        );
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn alpha_transcode_rejects_a_nonzero_ffmpeg_exit_status() {
        let error = run_ffmpeg_alpha_transcode_with_program(
            Path::new("/usr/bin/false"),
            Path::new("/tmp/source.webm"),
            Path::new("/tmp/output.partial.mov"),
        )
        .unwrap_err();

        assert!(error.starts_with("透明 WebM 转换失败"));
    }
}
