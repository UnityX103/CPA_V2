use std::collections::hash_map::DefaultHasher;
use std::fs;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::Manager;

const ALPHA_CACHE_VERSION: u8 = 3;

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
    if let Err(error) = run_ffmpeg_alpha_transcode(app, source, &temporary_target) {
        let _ = fs::remove_file(&temporary_target);
        return Err(error);
    }
    fs::rename(&temporary_target, &target)
        .map_err(|error| format!("无法保存转换后的视频：{error}"))?;
    Ok(target)
}

pub(super) fn clear_playable_cache(app: &tauri::AppHandle, source: &Path) -> Result<(), String> {
    let cache_dir = app
        .path()
        .app_cache_dir()
        .map_err(|error| error.to_string())?
        .join("alpha-videos");
    clear_cached_paths(&cache_dir, source)
}

fn clear_cached_paths(cache_dir: &Path, source: &Path) -> Result<(), String> {
    let target = cache_dir.join(alpha_cache_filename(source));
    for path in [&target, &alpha_tmp_path(&target)] {
        match fs::remove_file(path) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(format!("无法清理旧提示视频缓存：{error}")),
        }
    }
    Ok(())
}

fn run_ffmpeg_alpha_transcode(
    app: &tauri::AppHandle,
    source: &Path,
    target: &Path,
) -> Result<(), String> {
    let mut candidates = Vec::new();
    if let Some(configured) = std::env::var_os("CPA_FFMPEG") {
        candidates.push(PathBuf::from(configured));
    }
    if let Some(downloaded) = crate::video_editor_module::bundled_tool_path(app, "ffmpeg") {
        candidates.push(downloaded);
    }
    candidates.extend([
        PathBuf::from("ffmpeg"),
        PathBuf::from("/opt/homebrew/bin/ffmpeg"),
        PathBuf::from("/usr/local/bin/ffmpeg"),
    ]);

    let mut last_error = None;
    for ffmpeg in candidates {
        for decoder in ["libvpx-vp9", "libvpx"] {
            match Command::new(&ffmpeg)
                .args(ffmpeg_alpha_transcode_arguments(source, target, decoder))
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
    }

    Err(format!(
        "无法转换透明 WebM：需要可用的 ffmpeg（{}）",
        last_error.unwrap_or_else(|| "未找到 ffmpeg".to_string())
    ))
}

fn ffmpeg_alpha_transcode_arguments(
    source: &Path,
    target: &Path,
    decoder: &str,
) -> Vec<std::ffi::OsString> {
    vec![
        "-hide_banner".into(),
        "-loglevel".into(),
        "error".into(),
        "-y".into(),
        "-c:v".into(),
        decoder.into(),
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

#[cfg(test)]
mod tests {
    use super::{
        alpha_cache_filename, alpha_tmp_path, clear_cached_paths, ffmpeg_alpha_transcode_arguments,
    };
    use std::path::Path;

    #[test]
    fn replacement_invalidates_only_the_owned_video_cache() {
        let root =
            std::env::temp_dir().join(format!("cpa-video-cache-clear-{}", std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        let source = Path::new("/data/media/pomodoro-end/提示视频.webm");
        let target = root.join(alpha_cache_filename(source));
        std::fs::write(&target, b"old converted video").unwrap();
        std::fs::write(alpha_tmp_path(&target), b"unfinished conversion").unwrap();
        std::fs::write(root.join("unrelated.mov"), b"keep").unwrap();
        clear_cached_paths(&root, source).unwrap();
        assert!(!target.exists());
        assert!(!alpha_tmp_path(&target).exists());
        assert!(root.join("unrelated.mov").exists());
        clear_cached_paths(&root, source).unwrap();
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn alpha_transcode_supports_vp9_and_vp8_sources() {
        let source = Path::new("/tmp/input.webm");
        let target = Path::new("/tmp/output.mov");
        let vp9 = ffmpeg_alpha_transcode_arguments(source, target, "libvpx-vp9");
        let vp8 = ffmpeg_alpha_transcode_arguments(source, target, "libvpx");
        assert!(vp9.windows(2).any(|pair| pair == ["-c:v", "libvpx-vp9"]));
        assert!(vp8.windows(2).any(|pair| pair == ["-c:v", "libvpx"]));
    }

    #[test]
    fn decoder_change_invalidates_old_alpha_cache() {
        assert!(alpha_cache_filename(Path::new("/tmp/input.webm")).contains("-v3-"));
    }
}
