use std::collections::hash_map::DefaultHasher;
use std::fs;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::Manager;

const ALPHA_CACHE_VERSION: u8 = 2;

pub(super) fn atomic_replace_file(source: &Path, destination: &Path) -> std::io::Result<()> {
    fs::rename(source, destination)
}

pub(super) fn cleanup_generated_preview_cache(app: &tauri::AppHandle) -> Result<(), String> {
    let app_cache = app
        .path()
        .app_cache_dir()
        .map_err(|error| format!("无法打开视频缓存目录：{error}"))?;
    let cache_dir = app_cache
        .join("alpha-videos")
        .join("video-editor-generated");
    cleanup_generated_preview_cache_at(&cache_dir)
}

pub(super) fn cleanup_generated_preview_cache_at(cache_dir: &Path) -> Result<(), String> {
    match fs::symlink_metadata(cache_dir) {
        Ok(metadata) if metadata.file_type().is_symlink() => {
            return Err("透明视频缓存目录不能是符号链接".to_string());
        }
        Ok(metadata) if metadata.is_dir() => {
            fs::remove_dir_all(cache_dir)
                .map_err(|error| format!("无法清理旧的生成视频预览：{error}"))?;
        }
        Ok(_) => return Err("透明视频缓存目录不是文件夹".to_string()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(format!("无法读取透明视频缓存目录：{error}")),
    }
    Ok(())
}

pub(super) fn alpha_cache_dir(app_cache: &Path, source: &Path) -> PathBuf {
    let alpha_root = app_cache.join("alpha-videos");
    let generated_root = app_cache.join("video-editor").join("generated");
    let is_generated_source = source
        .canonicalize()
        .ok()
        .zip(generated_root.canonicalize().ok())
        .is_some_and(|(source, root)| {
            source.parent().and_then(Path::parent) == Some(root.as_path())
        });
    if is_generated_source {
        alpha_root.join("video-editor-generated")
    } else {
        alpha_root
    }
}

pub(super) fn prepare_playable_path(
    app: &tauri::AppHandle,
    source: &Path,
) -> Result<PathBuf, String> {
    let app_cache = app
        .path()
        .app_cache_dir()
        .map_err(|error| format!("无法打开视频缓存目录：{error}"))?;
    let cache_dir = alpha_cache_dir(&app_cache, source);
    fs::create_dir_all(&cache_dir).map_err(|error| format!("无法创建视频缓存目录：{error}"))?;

    let target = cache_dir.join(alpha_cache_filename(source));
    if !cached_alpha_video_is_fresh(source, &target) {
        let temporary_target = alpha_tmp_path(&target);
        let _ = fs::remove_file(&temporary_target);
        if let Err(error) = run_ffmpeg_alpha_transcode(source, &temporary_target) {
            let _ = fs::remove_file(&temporary_target);
            return Err(error);
        }

        fs::rename(&temporary_target, &target)
            .map_err(|error| format!("无法保存转换后的视频：{error}"))?;
    }

    Ok(target)
}

fn run_ffmpeg_alpha_transcode(source: &Path, target: &Path) -> Result<(), String> {
    let ffmpeg = crate::video_editor::resolve_ffmpeg_executable()
        .ok_or_else(|| "无法转换透明 WebM：未找到 ffmpeg，请设置 CPA_FFMPEG".to_string())?;
    run_ffmpeg_alpha_transcode_with_program(&ffmpeg, source, target)
}

pub(super) fn run_ffmpeg_alpha_transcode_with_program(
    ffmpeg: &Path,
    source: &Path,
    target: &Path,
) -> Result<(), String> {
    let output = Command::new(ffmpeg)
        .args(ffmpeg_alpha_transcode_arguments(source, target))
        .output()
        .map_err(|error| format!("无法启动透明 WebM 转换：{error}"))?;
    if output.status.success() {
        return Ok(());
    }
    let detail = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if detail.is_empty() {
        Err(format!("透明 WebM 转换失败，退出状态：{}", output.status))
    } else {
        Err(format!("透明 WebM 转换失败：{detail}"))
    }
}

pub(super) fn ffmpeg_alpha_transcode_arguments(
    source: &Path,
    target: &Path,
) -> Vec<std::ffi::OsString> {
    vec![
        "-hide_banner".into(),
        "-loglevel".into(),
        "error".into(),
        "-y".into(),
        "-c:v".into(),
        "libvpx".into(),
        "-i".into(),
        source.as_os_str().to_owned(),
        "-an".into(),
        "-vf".into(),
        "format=bgra".into(),
        "-c:v".into(),
        "hevc_videotoolbox".into(),
        "-allow_sw".into(),
        "1".into(),
        "-alpha_quality".into(),
        "1".into(),
        "-tag:v".into(),
        "hvc1".into(),
        "-movflags".into(),
        "+faststart".into(),
        "-f".into(),
        "mov".into(),
        target.as_os_str().to_owned(),
    ]
}

pub(super) fn alpha_cache_filename(source: &Path) -> String {
    let mut hasher = DefaultHasher::new();
    ALPHA_CACHE_VERSION.hash(&mut hasher);
    source.to_string_lossy().hash(&mut hasher);
    let hash = hasher.finish();
    let stem = source
        .file_stem()
        .and_then(|stem| stem.to_str())
        .map(sanitize_cache_stem)
        .filter(|stem| !stem.is_empty())
        .unwrap_or_else(|| "custom-video".to_string());
    format!("{stem}-v{ALPHA_CACHE_VERSION}-{hash:016x}.mov")
}

pub(super) fn alpha_tmp_path(target: &Path) -> PathBuf {
    let filename = target
        .file_stem()
        .and_then(|stem| stem.to_str())
        .filter(|stem| !stem.is_empty())
        .unwrap_or("custom-video");
    target.with_file_name(format!(".{filename}.tmp.mov"))
}

pub(super) fn sanitize_cache_stem(stem: &str) -> String {
    stem.chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || character == '-' || character == '_' {
                character
            } else {
                '-'
            }
        })
        .collect()
}

fn cached_alpha_video_is_fresh(source: &Path, target: &Path) -> bool {
    let Ok(target_metadata) = fs::metadata(target) else {
        return false;
    };
    if !target_metadata.is_file() || target_metadata.len() == 0 {
        return false;
    }
    let Ok(source_modified) = fs::metadata(source).and_then(|metadata| metadata.modified()) else {
        return false;
    };
    let Ok(target_modified) = target_metadata.modified() else {
        return false;
    };
    target_modified >= source_modified
}
