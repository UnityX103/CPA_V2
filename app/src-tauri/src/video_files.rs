use serde::Serialize;
use std::collections::hash_map::DefaultHasher;
use std::fs;
use std::hash::{Hash, Hasher};
use std::path::Path;
use std::process::Command;
use tauri::Manager;

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

#[tauri::command]
pub fn prepare_custom_alpha_video_path(
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

    let cache_dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| format!("无法打开视频缓存目录：{e}"))?
        .join("alpha-videos");
    fs::create_dir_all(&cache_dir).map_err(|e| format!("无法创建视频缓存目录：{e}"))?;

    let target = cache_dir.join(alpha_cache_filename(source));
    if cached_alpha_video_is_fresh(source, &target) {
        return Ok(target.to_string_lossy().into_owned());
    }

    let tmp = target.with_extension("mov.tmp");
    let _ = fs::remove_file(&tmp);
    let status = run_ffmpeg_alpha_transcode(source, &tmp)?;

    if !status.success() {
        let _ = fs::remove_file(&tmp);
        return Err("透明 WebM 转换失败，请确认视频包含可解码的 alpha 通道".to_string());
    }

    fs::rename(&tmp, &target).map_err(|e| format!("无法保存转换后的视频：{e}"))?;
    Ok(target.to_string_lossy().into_owned())
}

fn run_ffmpeg_alpha_transcode(
    source: &Path,
    target: &Path,
) -> Result<std::process::ExitStatus, String> {
    let mut last_error = None;
    for ffmpeg in [
        "ffmpeg",
        "/opt/homebrew/bin/ffmpeg",
        "/usr/local/bin/ffmpeg",
    ] {
        match Command::new(ffmpeg)
            .arg("-hide_banner")
            .arg("-loglevel")
            .arg("error")
            .arg("-y")
            .arg("-c:v")
            .arg("libvpx")
            .arg("-i")
            .arg(source)
            .arg("-an")
            .arg("-vf")
            .arg("format=bgra")
            .arg("-c:v")
            .arg("hevc_videotoolbox")
            .arg("-allow_sw")
            .arg("1")
            .arg("-alpha_quality")
            .arg("1")
            .arg("-tag:v")
            .arg("hvc1")
            .arg(target)
            .status()
        {
            Ok(status) => return Ok(status),
            Err(error) => last_error = Some(error.to_string()),
        }
    }

    Err(format!(
        "无法转换透明 WebM：需要可用的 ffmpeg（{}）",
        last_error.unwrap_or_else(|| "未找到 ffmpeg".to_string())
    ))
}

fn alpha_cache_filename(source: &Path) -> String {
    let mut hasher = DefaultHasher::new();
    source.to_string_lossy().hash(&mut hasher);
    let hash = hasher.finish();
    let stem = source
        .file_stem()
        .and_then(|stem| stem.to_str())
        .map(sanitize_cache_stem)
        .filter(|stem| !stem.is_empty())
        .unwrap_or_else(|| "custom-video".to_string());
    format!("{stem}-{hash:016x}.mov")
}

fn sanitize_cache_stem(stem: &str) -> String {
    stem.chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
                ch
            } else {
                '-'
            }
        })
        .collect()
}

fn cached_alpha_video_is_fresh(source: &Path, target: &Path) -> bool {
    let Ok(target_meta) = fs::metadata(target) else {
        return false;
    };
    if !target_meta.is_file() || target_meta.len() == 0 {
        return false;
    }
    let Ok(source_modified) = fs::metadata(source).and_then(|meta| meta.modified()) else {
        return false;
    };
    let Ok(target_modified) = target_meta.modified() else {
        return false;
    };
    target_modified >= source_modified
}

#[cfg(test)]
mod tests {
    use super::{
        alpha_cache_filename, sanitize_cache_stem, validate_webm_path, CustomVideoValidation,
    };
    use std::fs;
    use std::path::Path;

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

    #[test]
    fn alpha_cache_filename_keeps_extension_and_hashes_absolute_path() {
        let a = alpha_cache_filename(Path::new("/Users/xpy/Videos/focus end.webm"));
        let b = alpha_cache_filename(Path::new("/Users/xpy/Other/focus end.webm"));

        assert!(a.starts_with("focus-end-"));
        assert!(a.ends_with(".mov"));
        assert_ne!(a, b);
    }

    #[test]
    fn sanitize_cache_stem_replaces_path_unfriendly_characters() {
        assert_eq!(sanitize_cache_stem("focus end 千千"), "focus-end---");
    }
}
