use std::collections::hash_map::DefaultHasher;
use std::fs;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::Manager;

const ALPHA_CACHE_VERSION: u8 = 2;

pub(super) fn prepare_playable_path(
    app: &tauri::AppHandle,
    source: &Path,
) -> Result<PathBuf, String> {
    let cache_dir = app
        .path()
        .app_cache_dir()
        .map_err(|error| format!("无法打开视频缓存目录：{error}"))?
        .join("alpha-videos");
    fs::create_dir_all(&cache_dir).map_err(|error| format!("无法创建视频缓存目录：{error}"))?;

    let target = cache_dir.join(alpha_cache_filename(source));
    if cached_alpha_video_is_fresh(source, &target) {
        return Ok(target);
    }

    let temporary_target = alpha_tmp_path(&target);
    let _ = fs::remove_file(&temporary_target);
    if let Err(error) = run_ffmpeg_alpha_transcode(source, &temporary_target) {
        let _ = fs::remove_file(&temporary_target);
        return Err(error);
    }
    fs::rename(&temporary_target, &target)
        .map_err(|error| format!("无法保存转换后的视频：{error}"))?;
    Ok(target)
}

fn run_ffmpeg_alpha_transcode(source: &Path, target: &Path) -> Result<(), String> {
    let mut candidates = Vec::new();
    if let Some(configured) = std::env::var_os("CPA_FFMPEG") {
        candidates.push(PathBuf::from(configured));
    }
    candidates.extend([
        PathBuf::from("ffmpeg"),
        PathBuf::from("/opt/homebrew/bin/ffmpeg"),
        PathBuf::from("/usr/local/bin/ffmpeg"),
    ]);

    let mut last_error = None;
    for ffmpeg in candidates {
        match Command::new(&ffmpeg)
            .args(ffmpeg_alpha_transcode_arguments(source, target))
            .output()
        {
            Ok(output) if output.status.success() => return Ok(()),
            Ok(output) => {
                let detail = String::from_utf8_lossy(&output.stderr).trim().to_string();
                last_error = Some(if detail.is_empty() {
                    format!("退出状态：{}", output.status)
                } else {
                    detail
                });
            }
            Err(error) => last_error = Some(error.to_string()),
        }
    }

    Err(format!(
        "无法转换透明 WebM：需要可用的 ffmpeg（{}）",
        last_error.unwrap_or_else(|| "未找到 ffmpeg".to_string())
    ))
}

fn ffmpeg_alpha_transcode_arguments(source: &Path, target: &Path) -> Vec<std::ffi::OsString> {
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

fn alpha_cache_filename(source: &Path) -> String {
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

fn alpha_tmp_path(target: &Path) -> PathBuf {
    let filename = target
        .file_stem()
        .and_then(|stem| stem.to_str())
        .filter(|stem| !stem.is_empty())
        .unwrap_or("custom-video");
    target.with_file_name(format!(".{filename}.tmp.mov"))
}

fn sanitize_cache_stem(stem: &str) -> String {
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
