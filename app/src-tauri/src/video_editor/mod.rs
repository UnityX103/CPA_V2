mod macos;
mod windows;

use serde::{Deserialize, Serialize};
use std::ffi::{OsStr, OsString};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::thread;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};
use tauri_plugin_dialog::DialogExt;

const MAX_BRUSH_STROKES: usize = 256;
const MAX_BRUSH_POINTS: usize = 20_000;
const EXECUTABLE_PROBE_TIMEOUT: Duration = Duration::from_secs(3);
const EXTERNAL_BACKGROUND_REMOVER_PROBE_TIMEOUT: Duration = Duration::from_secs(120);
const EXECUTABLE_PROBE_POLL_INTERVAL: Duration = Duration::from_millis(10);
static JOB_COUNTER: AtomicU64 = AtomicU64::new(1);

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoCrop {
    pub x: i64,
    pub y: i64,
    pub width: i64,
    pub height: i64,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrushPoint {
    pub x: f64,
    pub y: f64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrushStroke {
    pub radius: f64,
    pub points: Vec<BrushPoint>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoProcessRequest {
    pub job_id: String,
    pub input_path: String,
    pub output_path: String,
    pub crop: VideoCrop,
    pub start_seconds: f64,
    pub end_seconds: f64,
    pub threshold: i64,
    pub brush_strokes: Vec<BrushStroke>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct VideoProbe {
    pub width: u32,
    pub height: u32,
    pub duration_seconds: f64,
    pub frame_rate: f64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct VideoEditorRuntimeStatus {
    pub ready: bool,
    pub message: String,
    pub ffmpeg_path: Option<String>,
    pub ffprobe_path: Option<String>,
    pub background_remover_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct VideoProcessResult {
    pub output_path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct VideoEditorProgress {
    job_id: String,
    percent: u8,
    stage: String,
}

#[derive(Debug, Clone)]
struct RuntimePaths {
    ffmpeg: PathBuf,
    ffprobe: PathBuf,
    background_remover: PathBuf,
    u2netp_model: PathBuf,
}

#[derive(Debug)]
struct ValidatedRequest {
    input_path: PathBuf,
    output_path: PathBuf,
    crop: VideoCrop,
    start_seconds: f64,
    end_seconds: f64,
    threshold: u8,
    brush_strokes: Vec<BrushStroke>,
}

fn validate_process_request(
    request: VideoProcessRequest,
    probe: &VideoProbe,
) -> Result<ValidatedRequest, String> {
    let input_path = validate_input_path(Path::new(&request.input_path))?;
    let output_path = validate_output_path(Path::new(&request.output_path))?;
    if paths_are_equal(&input_path, &output_path) {
        return Err("输入视频和输出视频不能是同一个文件".to_string());
    }
    validate_job_id(&request.job_id)?;
    validate_crop(request.crop, probe)?;
    validate_trim(
        request.start_seconds,
        request.end_seconds,
        probe.duration_seconds,
    )?;
    let threshold =
        u8::try_from(request.threshold).map_err(|_| "抠图阈值必须在 0 到 255 之间".to_string())?;
    validate_brush_strokes(&request.brush_strokes)?;

    Ok(ValidatedRequest {
        input_path,
        output_path,
        crop: request.crop,
        start_seconds: request.start_seconds,
        end_seconds: request.end_seconds,
        threshold,
        brush_strokes: request.brush_strokes,
    })
}

fn validate_input_path(path: &Path) -> Result<PathBuf, String> {
    if !path.is_absolute() {
        return Err("输入视频路径必须是绝对路径".to_string());
    }
    if !has_allowed_extension(path, &["mp4", "mov", "webm", "m4v", "ogv", "ogg"]) {
        return Err("不支持该输入视频格式".to_string());
    }
    if !path.is_file() {
        return Err("输入视频文件不存在".to_string());
    }
    path.canonicalize()
        .map_err(|error| format!("无法读取输入视频路径：{error}"))
}

fn validate_output_path(path: &Path) -> Result<PathBuf, String> {
    if !path.is_absolute() {
        return Err("输出视频路径必须是绝对路径".to_string());
    }
    if !has_allowed_extension(path, &["webm"]) {
        return Err("输出视频必须使用 .webm 扩展名".to_string());
    }
    let filename = path
        .file_name()
        .filter(|name| !name.is_empty())
        .ok_or_else(|| "输出视频路径缺少文件名".to_string())?;
    let parent = path
        .parent()
        .ok_or_else(|| "输出视频路径缺少父目录".to_string())?;
    if !parent.is_dir() {
        return Err("输出视频的保存目录不存在".to_string());
    }
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() => {
            return Err("输出视频路径不能是符号链接".to_string());
        }
        Ok(metadata) if !metadata.is_file() => {
            return Err("输出视频路径不是普通文件".to_string());
        }
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(format!("无法读取已有输出视频路径：{error}")),
    }
    let canonical_parent = parent
        .canonicalize()
        .map_err(|error| format!("无法读取输出目录：{error}"))?;
    Ok(canonical_parent.join(filename))
}

fn has_allowed_extension(path: &Path, allowed: &[&str]) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| {
            allowed
                .iter()
                .any(|allowed_extension| extension.eq_ignore_ascii_case(allowed_extension))
        })
}

#[cfg(target_os = "windows")]
fn paths_are_equal(left: &Path, right: &Path) -> bool {
    if left
        .to_string_lossy()
        .eq_ignore_ascii_case(&right.to_string_lossy())
    {
        return true;
    }
    match (left.canonicalize(), right.canonicalize()) {
        (Ok(left), Ok(right)) => left
            .to_string_lossy()
            .eq_ignore_ascii_case(&right.to_string_lossy()),
        _ => false,
    }
}

#[cfg(unix)]
fn paths_are_equal(left: &Path, right: &Path) -> bool {
    use std::os::unix::fs::MetadataExt;

    if left == right {
        return true;
    }
    match (fs::metadata(left), fs::metadata(right)) {
        (Ok(left), Ok(right)) => left.dev() == right.dev() && left.ino() == right.ino(),
        _ => false,
    }
}

#[cfg(all(not(target_os = "windows"), not(unix)))]
fn paths_are_equal(left: &Path, right: &Path) -> bool {
    left == right
}

fn validate_job_id(job_id: &str) -> Result<(), String> {
    if job_id.is_empty() || job_id.len() > 128 {
        return Err("处理任务编号无效".to_string());
    }
    if !job_id
        .chars()
        .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.'))
    {
        return Err("处理任务编号包含非法字符".to_string());
    }
    Ok(())
}

fn validate_crop(crop: VideoCrop, probe: &VideoProbe) -> Result<(), String> {
    if crop.x < 0 || crop.y < 0 || crop.width < 2 || crop.height < 2 {
        return Err("裁剪区域超出视频范围".to_string());
    }
    if crop.x % 2 != 0 || crop.y % 2 != 0 || crop.width % 2 != 0 || crop.height % 2 != 0 {
        return Err("裁剪坐标和尺寸必须是偶数".to_string());
    }
    let right = crop
        .x
        .checked_add(crop.width)
        .ok_or_else(|| "裁剪区域超出视频范围".to_string())?;
    let bottom = crop
        .y
        .checked_add(crop.height)
        .ok_or_else(|| "裁剪区域超出视频范围".to_string())?;
    if right > i64::from(probe.width) || bottom > i64::from(probe.height) {
        return Err("裁剪区域超出视频范围".to_string());
    }
    Ok(())
}

fn validate_trim(start: f64, end: f64, duration: f64) -> Result<(), String> {
    if !start.is_finite() || !end.is_finite() || !duration.is_finite() {
        return Err("视频时间范围无效".to_string());
    }
    if start < 0.0 || end <= start || end - start < 0.1 || end > duration + 0.001 {
        return Err("视频时间范围无效".to_string());
    }
    Ok(())
}

fn validate_brush_strokes(strokes: &[BrushStroke]) -> Result<(), String> {
    if strokes.len() > MAX_BRUSH_STROKES {
        return Err(format!("画笔笔画不能超过 {MAX_BRUSH_STROKES} 条"));
    }
    let mut total_points = 0usize;
    for stroke in strokes {
        if !stroke.radius.is_finite()
            || !(0.0..=0.5).contains(&stroke.radius)
            || stroke.radius == 0.0
        {
            return Err("画笔半径必须在 0 到 0.5 之间".to_string());
        }
        if stroke.points.is_empty() {
            return Err("画笔笔画不能为空".to_string());
        }
        total_points = total_points
            .checked_add(stroke.points.len())
            .ok_or_else(|| "画笔点数过多".to_string())?;
        if total_points > MAX_BRUSH_POINTS {
            return Err(format!("画笔点数不能超过 {MAX_BRUSH_POINTS} 个"));
        }
        for point in &stroke.points {
            if !point.x.is_finite()
                || !point.y.is_finite()
                || !(0.0..=1.0).contains(&point.x)
                || !(0.0..=1.0).contains(&point.y)
            {
                return Err("画笔坐标必须在 0 到 1 之间".to_string());
            }
        }
    }
    Ok(())
}

fn parse_ffprobe_json(json: &[u8]) -> Result<VideoProbe, String> {
    let document: serde_json::Value =
        serde_json::from_slice(json).map_err(|error| format!("无法解析视频信息：{error}"))?;
    let stream = document
        .get("streams")
        .and_then(serde_json::Value::as_array)
        .and_then(|streams| streams.first())
        .ok_or_else(|| "视频中没有可用的视频轨道".to_string())?;

    let mut width = json_u32(stream.get("width"), "视频宽度")?;
    let mut height = json_u32(stream.get("height"), "视频高度")?;
    if width == 0 || height == 0 {
        return Err("视频尺寸无效".to_string());
    }

    let rotation = stream
        .get("side_data_list")
        .and_then(serde_json::Value::as_array)
        .and_then(|entries| {
            entries
                .iter()
                .find_map(|entry| json_i64(entry.get("rotation")))
        })
        .or_else(|| {
            stream
                .get("tags")
                .and_then(|tags| json_i64(tags.get("rotate")))
        })
        .unwrap_or(0);
    if rotation.rem_euclid(180) == 90 {
        std::mem::swap(&mut width, &mut height);
    }

    let duration_seconds = json_f64(stream.get("duration"))
        .or_else(|| {
            document
                .get("format")
                .and_then(|format| json_f64(format.get("duration")))
        })
        .filter(|value| value.is_finite() && *value > 0.0)
        .ok_or_else(|| "无法读取视频时长".to_string())?;

    let frame_rate = stream
        .get("avg_frame_rate")
        .and_then(parse_frame_rate)
        .filter(|value| *value > 0.0)
        .or_else(|| {
            stream
                .get("r_frame_rate")
                .and_then(parse_frame_rate)
                .filter(|value| *value > 0.0)
        })
        .ok_or_else(|| "无法读取视频帧率".to_string())?;

    Ok(VideoProbe {
        width,
        height,
        duration_seconds,
        frame_rate,
    })
}

fn json_u32(value: Option<&serde_json::Value>, label: &str) -> Result<u32, String> {
    let raw = value
        .and_then(serde_json::Value::as_u64)
        .ok_or_else(|| format!("无法读取{label}"))?;
    u32::try_from(raw).map_err(|_| format!("{label}超出支持范围"))
}

fn json_i64(value: Option<&serde_json::Value>) -> Option<i64> {
    value.and_then(|value| {
        value
            .as_i64()
            .or_else(|| value.as_str()?.parse::<i64>().ok())
    })
}

fn json_f64(value: Option<&serde_json::Value>) -> Option<f64> {
    value.and_then(|value| {
        value
            .as_f64()
            .or_else(|| value.as_str()?.parse::<f64>().ok())
    })
}

fn parse_frame_rate(value: &serde_json::Value) -> Option<f64> {
    let rate = value.as_str()?;
    let (numerator, denominator) = rate.split_once('/').unwrap_or((rate, "1"));
    let numerator = numerator.parse::<f64>().ok()?;
    let denominator = denominator.parse::<f64>().ok()?;
    if !numerator.is_finite() || !denominator.is_finite() || denominator == 0.0 {
        return None;
    }
    Some(numerator / denominator)
}

fn build_brush_mask_pgm(
    width: u32,
    height: u32,
    strokes: &[BrushStroke],
) -> Result<Vec<u8>, String> {
    if width == 0 || height == 0 {
        return Err("无法为零尺寸视频创建画笔蒙版".to_string());
    }
    validate_brush_strokes(strokes)?;
    let width_usize = usize::try_from(width).map_err(|_| "视频宽度过大".to_string())?;
    let height_usize = usize::try_from(height).map_err(|_| "视频高度过大".to_string())?;
    let pixel_count = width_usize
        .checked_mul(height_usize)
        .ok_or_else(|| "视频尺寸过大".to_string())?;
    if pixel_count > 100_000_000 {
        return Err("视频尺寸过大，无法创建画笔蒙版".to_string());
    }

    let mut pixels = vec![255u8; pixel_count];
    let min_dimension = f64::from(width.min(height));
    for stroke in strokes {
        let radius = (stroke.radius * min_dimension).max(1.0);
        let points: Vec<(f64, f64)> = stroke
            .points
            .iter()
            .map(|point| {
                (
                    point.x * f64::from(width.saturating_sub(1)),
                    point.y * f64::from(height.saturating_sub(1)),
                )
            })
            .collect();
        if points.len() == 1 {
            draw_mask_disk(&mut pixels, width_usize, height_usize, points[0], radius);
            continue;
        }
        for segment in points.windows(2) {
            let (start_x, start_y) = segment[0];
            let (end_x, end_y) = segment[1];
            let distance = (end_x - start_x).hypot(end_y - start_y);
            let step_size = (radius * 0.5).max(1.0);
            let steps = (distance / step_size).ceil().max(1.0) as usize;
            for step in 0..=steps {
                let t = step as f64 / steps as f64;
                draw_mask_disk(
                    &mut pixels,
                    width_usize,
                    height_usize,
                    (
                        start_x + (end_x - start_x) * t,
                        start_y + (end_y - start_y) * t,
                    ),
                    radius,
                );
            }
        }
    }

    let mut pgm = format!("P5\n{width} {height}\n255\n").into_bytes();
    pgm.extend_from_slice(&pixels);
    Ok(pgm)
}

fn draw_mask_disk(pixels: &mut [u8], width: usize, height: usize, center: (f64, f64), radius: f64) {
    let min_x = (center.0 - radius).floor().max(0.0) as usize;
    let max_x = (center.0 + radius).ceil().min((width - 1) as f64) as usize;
    let min_y = (center.1 - radius).floor().max(0.0) as usize;
    let max_y = (center.1 + radius).ceil().min((height - 1) as f64) as usize;
    let radius_squared = radius * radius;
    for y in min_y..=max_y {
        for x in min_x..=max_x {
            let dx = x as f64 - center.0;
            let dy = y as f64 - center.1;
            if dx * dx + dy * dy <= radius_squared {
                pixels[y * width + x] = 0;
            }
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct RuntimeTarget {
    directory_name: &'static str,
    manifest_architecture: &'static str,
}

fn runtime_target_for(target_os: &str, target_arch: &str) -> Option<RuntimeTarget> {
    match (target_os, target_arch) {
        ("macos", "x86_64") => Some(RuntimeTarget {
            directory_name: "macos-x86_64",
            manifest_architecture: "x86_64",
        }),
        ("macos", "aarch64" | "arm64") => Some(RuntimeTarget {
            directory_name: "macos-arm64",
            manifest_architecture: "arm64",
        }),
        ("windows", "x86_64") => Some(RuntimeTarget {
            directory_name: "windows-x86_64",
            manifest_architecture: "x86_64",
        }),
        _ => None,
    }
}

#[derive(Debug, Clone, Copy)]
pub(super) enum ExecutableKind {
    Ffmpeg,
    Ffprobe,
    BackgroundRemover,
}

impl ExecutableKind {
    fn program_name(self) -> &'static str {
        match self {
            ExecutableKind::Ffmpeg => "ffmpeg",
            ExecutableKind::Ffprobe => "ffprobe",
            ExecutableKind::BackgroundRemover => "backgroundremover",
        }
    }

    fn environment_key(self) -> &'static str {
        match self {
            ExecutableKind::Ffmpeg => "CPA_FFMPEG",
            ExecutableKind::Ffprobe => "CPA_FFPROBE",
            ExecutableKind::BackgroundRemover => "CPA_BACKGROUND_REMOVER",
        }
    }
}

fn preprocess_arguments(request: &ValidatedRequest, target: &Path) -> Vec<OsString> {
    let crop = request.crop;
    vec![
        "-hide_banner".into(),
        "-loglevel".into(),
        "error".into(),
        "-y".into(),
        "-i".into(),
        request.input_path.as_os_str().to_owned(),
        "-ss".into(),
        format_seconds(request.start_seconds).into(),
        "-t".into(),
        format_seconds(request.end_seconds - request.start_seconds).into(),
        "-vf".into(),
        format!(
            "crop={}:{}:{}:{},setsar=1",
            crop.width, crop.height, crop.x, crop.y
        )
        .into(),
        "-map_metadata".into(),
        "-1".into(),
        "-an".into(),
        "-c:v".into(),
        "mpeg4".into(),
        "-q:v".into(),
        "2".into(),
        "-pix_fmt".into(),
        "yuv420p".into(),
        target.as_os_str().to_owned(),
    ]
}

fn background_remover_arguments(input: &Path, matte: &Path) -> Vec<OsString> {
    vec![
        "-i".into(),
        input.as_os_str().to_owned(),
        "-m".into(),
        "u2netp".into(),
        "-wn".into(),
        "1".into(),
        "-gb".into(),
        "1".into(),
        "-mk".into(),
        "-o".into(),
        matte.as_os_str().to_owned(),
    ]
}

fn postprocess_arguments(
    source: &Path,
    matte: &Path,
    brush_mask: &Path,
    threshold: u8,
    frame_rate: f64,
    duration_seconds: f64,
    output: &Path,
) -> Vec<OsString> {
    let filter = format!(
        "[1:v]format=gray,lut=y='if(lt(val,{threshold}),0,val)'[soft];\
         [2:v]format=gray[brush];\
         [soft][brush]blend=all_expr='A*B/255',format=gray[alpha];\
         [0:v][alpha]alphamerge,format=yuva420p[out]"
    );
    vec![
        "-hide_banner".into(),
        "-loglevel".into(),
        "error".into(),
        "-y".into(),
        "-i".into(),
        source.as_os_str().to_owned(),
        "-i".into(),
        matte.as_os_str().to_owned(),
        "-loop".into(),
        "1".into(),
        "-framerate".into(),
        format_seconds(frame_rate).into(),
        "-i".into(),
        brush_mask.as_os_str().to_owned(),
        "-filter_complex".into(),
        filter.into(),
        "-map".into(),
        "[out]".into(),
        "-an".into(),
        "-c:v".into(),
        "libvpx".into(),
        "-crf".into(),
        "18".into(),
        "-b:v".into(),
        "0".into(),
        "-pix_fmt".into(),
        "yuva420p".into(),
        "-auto-alt-ref".into(),
        "0".into(),
        "-metadata:s:v:0".into(),
        "alpha_mode=1".into(),
        "-shortest".into(),
        "-t".into(),
        format_seconds(duration_seconds).into(),
        output.as_os_str().to_owned(),
    ]
}

fn format_seconds(value: f64) -> String {
    format!("{value:.6}")
}

fn validate_alpha_webm_probe(json: &[u8]) -> Result<(), String> {
    let document: serde_json::Value =
        serde_json::from_slice(json).map_err(|error| format!("无法解析输出视频信息：{error}"))?;
    let stream = document
        .get("streams")
        .and_then(serde_json::Value::as_array)
        .and_then(|streams| streams.first())
        .ok_or_else(|| "输出 WebM 中没有视频轨道".to_string())?;
    if stream.get("codec_name").and_then(serde_json::Value::as_str) != Some("vp8") {
        return Err("输出视频不是 VP8 WebM".to_string());
    }
    let has_alpha = stream
        .get("tags")
        .and_then(serde_json::Value::as_object)
        .is_some_and(|tags| {
            tags.iter().any(|(key, value)| {
                key.eq_ignore_ascii_case("alpha_mode")
                    && value.as_str().is_some_and(|value| value == "1")
            })
        });
    if !has_alpha {
        return Err("输出 WebM 缺少 alpha 通道标记".to_string());
    }
    Ok(())
}

#[tauri::command]
pub async fn probe_video_for_editing(path: String) -> Result<VideoProbe, String> {
    tauri::async_runtime::spawn_blocking(move || probe_video_for_editing_blocking(path))
        .await
        .map_err(|error| format!("视频探测任务异常结束：{error}"))?
}

#[tauri::command]
pub async fn pick_edited_video_output_path(
    app: AppHandle,
    input_path: String,
) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let default_filename = edited_video_output_filename(&input_path);
        app.dialog()
            .file()
            .set_file_name(default_filename)
            .add_filter("透明 WebM 视频", &["webm"])
            .blocking_save_file()
            .map(|path| {
                let path = path
                    .into_path()
                    .map_err(|error| format!("无法读取视频保存路径：{error}"))?;
                crate::video_files::allow_video_asset_file(&app, &path)?;
                Ok(path.to_string_lossy().into_owned())
            })
            .transpose()
    })
    .await
    .map_err(|error| format!("视频保存对话框异常结束：{error}"))?
}

fn edited_video_output_filename(input_path: &str) -> String {
    let stem = Path::new(input_path)
        .file_stem()
        .filter(|stem| !stem.is_empty())
        .map(|stem| stem.to_string_lossy())
        .unwrap_or_else(|| "edited-video".into());
    format!("{stem}-transparent.webm")
}

fn probe_video_for_editing_blocking(path: String) -> Result<VideoProbe, String> {
    let input = validate_input_path(Path::new(&path))?;
    let ffprobe = resolve_executable(ExecutableKind::Ffprobe)
        .ok_or_else(|| "未找到 ffprobe，请设置 CPA_FFPROBE".to_string())?;
    probe_video(&ffprobe, &input)
}

#[tauri::command]
pub async fn video_editor_runtime_status() -> VideoEditorRuntimeStatus {
    tauri::async_runtime::spawn_blocking(video_editor_runtime_status_blocking)
        .await
        .unwrap_or_else(|error| VideoEditorRuntimeStatus {
            ready: false,
            message: format!("视频抠图运行时检查异常结束：{error}"),
            ffmpeg_path: None,
            ffprobe_path: None,
            background_remover_path: None,
        })
}

fn video_editor_runtime_status_blocking() -> VideoEditorRuntimeStatus {
    let ffmpeg = resolve_executable(ExecutableKind::Ffmpeg);
    let ffprobe = resolve_executable(ExecutableKind::Ffprobe);
    let background_remover = resolve_executable(ExecutableKind::BackgroundRemover);
    let model = resolve_u2netp_model();

    let mut missing = Vec::new();
    if ffmpeg.is_none() {
        missing.push("ffmpeg（可设置 CPA_FFMPEG）");
    }
    if ffprobe.is_none() {
        missing.push("ffprobe（可设置 CPA_FFPROBE）");
    }
    if background_remover.is_none() {
        missing.push("BackgroundRemover（可设置 CPA_BACKGROUND_REMOVER）");
    }
    if model.is_none() {
        missing.push("U2NetP 模型（可设置 U2NETP_PATH）");
    }

    let ready = missing.is_empty();
    let resolved_paths = [
        ffmpeg.as_deref(),
        ffprobe.as_deref(),
        background_remover.as_deref(),
        model.as_deref(),
    ];
    let bundled = bundled_runtime_status(&resolved_paths);
    let required_target = current_platform_runtime_target().directory_name;
    let message = if ready && bundled.complete {
        format!(
            "已发现内置 {required_target} 视频抠图 payload 与目标 manifest；发布完整性以 video-runtime:verify 为准"
        )
    } else if ready && bundled.component_count == 0 {
        format!(
            "已发现外部视频抠图运行时路径；保存时会先做有界健康检查，发布仍需 verified {required_target} payload"
        )
    } else if ready {
        "已发现混合或未锁定视频抠图路径；保存时会先验证外部 worker，发布前请运行 video-runtime:verify".to_string()
    } else if bundled.component_count > 0 {
        format!(
            "内置视频抠图 payload 不完整：缺少 {}；发布前请重新 prepare/verify",
            missing.join("、")
        )
    } else {
        format!("视频抠图运行时未就绪：缺少 {}", missing.join("、"))
    };

    VideoEditorRuntimeStatus {
        ready,
        message,
        ffmpeg_path: path_string(ffmpeg.as_deref()),
        ffprobe_path: path_string(ffprobe.as_deref()),
        background_remover_path: path_string(background_remover.as_deref()),
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct BundledRuntimeStatus {
    component_count: usize,
    complete: bool,
}

fn bundled_runtime_status(paths: &[Option<&Path>; 4]) -> BundledRuntimeStatus {
    let manifest_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
    let roots = paths
        .iter()
        .filter_map(|path| path.and_then(|path| current_platform_runtime_root(path, manifest_dir)))
        .collect::<Vec<_>>();
    let component_count = roots.len();
    let complete = component_count == paths.len()
        && roots.windows(2).all(|pair| pair[0] == pair[1])
        && runtime_manifest_matches_target(&roots[0]);
    BundledRuntimeStatus {
        component_count,
        complete,
    }
}

fn runtime_manifest_matches_target(root: &Path) -> bool {
    runtime_manifest_matches(root, current_platform_runtime_target())
}

fn runtime_manifest_matches(root: &Path, target: RuntimeTarget) -> bool {
    let Ok(bytes) = fs::read(root.join("runtime-manifest.json")) else {
        return false;
    };
    let Ok(manifest) = serde_json::from_slice::<serde_json::Value>(&bytes) else {
        return false;
    };
    manifest
        .get("schemaVersion")
        .and_then(serde_json::Value::as_u64)
        == Some(1)
        && manifest
            .get("architecture")
            .and_then(serde_json::Value::as_str)
            == Some(target.manifest_architecture)
        && manifest.get("target").and_then(serde_json::Value::as_str) == Some(target.directory_name)
}

fn current_platform_runtime_root(path: &Path, manifest_dir: &Path) -> Option<PathBuf> {
    #[cfg(target_os = "macos")]
    {
        macos::runtime_root_for_path(path, manifest_dir)
    }
    #[cfg(target_os = "windows")]
    {
        windows::runtime_root_for_path(path, manifest_dir)
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = (path, manifest_dir);
        None
    }
}

fn current_platform_runtime_target() -> RuntimeTarget {
    #[cfg(target_os = "macos")]
    {
        macos::runtime_target()
    }
    #[cfg(target_os = "windows")]
    {
        windows::runtime_target()
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        RuntimeTarget {
            directory_name: "unsupported",
            manifest_architecture: "unsupported",
        }
    }
}

#[tauri::command]
pub async fn process_background_removed_video(
    app: AppHandle,
    request: VideoProcessRequest,
) -> Result<VideoProcessResult, String> {
    tauri::async_runtime::spawn_blocking(move || process_video(&app, request))
        .await
        .map_err(|error| format!("视频处理任务异常结束：{error}"))?
}

fn process_video(
    app: &AppHandle,
    request: VideoProcessRequest,
) -> Result<VideoProcessResult, String> {
    process_video_with_progress(request, |job_id, percent, stage| {
        emit_progress(app, job_id, percent, stage);
    })
}

fn process_video_with_progress(
    request: VideoProcessRequest,
    mut progress: impl FnMut(&str, u8, &str),
) -> Result<VideoProcessResult, String> {
    validate_job_id(&request.job_id)?;
    progress(&request.job_id, 0, "正在检查运行环境");
    let runtime = resolve_runtime()?;
    let source = validate_input_path(Path::new(&request.input_path))?;
    let probe = probe_video(&runtime.ffprobe, &source)?;
    let validated = validate_process_request(request.clone(), &probe)?;

    let job_dir = JobTempDir::new(&request.job_id)?;
    let output_staging = OutputStagingDir::new(&validated.output_path, &request.job_id)?;
    let preprocessed = job_dir.path().join("preprocessed.mp4");
    let matte = job_dir.path().join("matte.mp4");
    let brush_mask = job_dir.path().join("brush-mask.pgm");
    let partial_output = output_staging.path().join("result.webm");

    progress(&request.job_id, 10, "正在裁剪视频");
    let mut preprocess = Command::new(&runtime.ffmpeg);
    preprocess.args(preprocess_arguments(&validated, &preprocessed));
    run_checked_command(preprocess, "视频裁剪")?;
    ensure_nonempty_file(&preprocessed, "裁剪后的视频")?;

    progress(&request.job_id, 35, "正在使用 BackgroundRemover 抠图");
    let mut background = Command::new(&runtime.background_remover);
    background.args(background_remover_arguments(&preprocessed, &matte));
    background.env("BACKGROUNDREMOVER_DEVICE", "cpu");
    background.env("U2NETP_PATH", &runtime.u2netp_model);
    background.env("PYTHONNOUSERSITE", "1");
    configure_frozen_worker_numba(&mut background, &job_dir.path().join("numba-cache"));
    prepend_runtime_path(&mut background, &runtime.ffmpeg, &runtime.ffprobe)?;
    run_checked_command(background, "BackgroundRemover 抠图")?;
    ensure_nonempty_file(&matte, "BackgroundRemover 蒙版")?;

    progress(&request.job_id, 70, "正在应用阈值和画笔");
    let mask_bytes = build_brush_mask_pgm(
        u32::try_from(validated.crop.width).map_err(|_| "裁剪宽度无效".to_string())?,
        u32::try_from(validated.crop.height).map_err(|_| "裁剪高度无效".to_string())?,
        &validated.brush_strokes,
    )?;
    fs::write(&brush_mask, mask_bytes).map_err(|error| format!("无法保存画笔蒙版：{error}"))?;

    let mut postprocess = Command::new(&runtime.ffmpeg);
    postprocess.args(postprocess_arguments(
        &preprocessed,
        &matte,
        &brush_mask,
        validated.threshold,
        probe.frame_rate,
        validated.end_seconds - validated.start_seconds,
        &partial_output,
    ));
    run_checked_command(postprocess, "透明视频编码")?;
    ensure_nonempty_file(&partial_output, "透明 WebM")?;

    progress(&request.job_id, 95, "正在验证透明视频");
    validate_alpha_webm_file(&runtime.ffprobe, &partial_output)?;
    replace_output_file(
        &partial_output,
        &validated.output_path,
        &validated.input_path,
    )?;

    progress(&request.job_id, 100, "处理完成");
    Ok(VideoProcessResult {
        output_path: validated.output_path.to_string_lossy().into_owned(),
    })
}

fn emit_progress(app: &AppHandle, job_id: &str, percent: u8, stage: &str) {
    let _ = app.emit(
        "video-editor-progress",
        VideoEditorProgress {
            job_id: job_id.to_string(),
            percent,
            stage: stage.to_string(),
        },
    );
}

fn probe_video(ffprobe: &Path, input: &Path) -> Result<VideoProbe, String> {
    let mut command = Command::new(ffprobe);
    command.args([
        OsString::from("-v"),
        OsString::from("error"),
        OsString::from("-select_streams"),
        OsString::from("v:0"),
        OsString::from("-show_entries"),
        OsString::from(
            "format=duration:stream=width,height,avg_frame_rate,r_frame_rate,duration:stream_tags=rotate:stream_side_data=rotation",
        ),
        OsString::from("-of"),
        OsString::from("json"),
        input.as_os_str().to_owned(),
    ]);
    let output = run_capture_checked(command, "读取视频信息")?;
    parse_ffprobe_json(&output.stdout)
}

fn validate_alpha_webm_file(ffprobe: &Path, output_path: &Path) -> Result<(), String> {
    let mut command = Command::new(ffprobe);
    command.args([
        OsString::from("-v"),
        OsString::from("error"),
        OsString::from("-select_streams"),
        OsString::from("v:0"),
        OsString::from("-show_entries"),
        OsString::from("stream=codec_name:stream_tags=alpha_mode"),
        OsString::from("-of"),
        OsString::from("json"),
        output_path.as_os_str().to_owned(),
    ]);
    let output = run_capture_checked(command, "验证透明 WebM")?;
    validate_alpha_webm_probe(&output.stdout)
}

fn resolve_runtime() -> Result<RuntimePaths, String> {
    let ffmpeg = resolve_executable(ExecutableKind::Ffmpeg)
        .ok_or_else(|| "未找到 ffmpeg，请设置 CPA_FFMPEG".to_string())?;
    let ffprobe = resolve_executable(ExecutableKind::Ffprobe)
        .ok_or_else(|| "未找到 ffprobe，请设置 CPA_FFPROBE".to_string())?;
    let background_remover = resolve_background_remover_for_processing()
        .ok_or_else(|| "未找到 BackgroundRemover，请设置 CPA_BACKGROUND_REMOVER".to_string())?;
    let u2netp_model = resolve_u2netp_model()
        .ok_or_else(|| "未找到 U2NetP 模型，请设置 U2NETP_PATH".to_string())?;
    Ok(RuntimePaths {
        ffmpeg,
        ffprobe,
        background_remover,
        u2netp_model,
    })
}

fn resolve_executable(kind: ExecutableKind) -> Option<PathBuf> {
    let configured = development_runtime_override(
        std::env::var_os(kind.environment_key()),
        cfg!(debug_assertions),
    );
    executable_candidates(kind, configured, Path::new(env!("CARGO_MANIFEST_DIR")))
        .into_iter()
        .find(|candidate| executable_is_available(candidate, kind))
}

fn resolve_background_remover_for_processing() -> Option<PathBuf> {
    let configured = development_runtime_override(
        std::env::var_os(ExecutableKind::BackgroundRemover.environment_key()),
        cfg!(debug_assertions),
    );
    let manifest_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
    executable_candidates(ExecutableKind::BackgroundRemover, configured, manifest_dir)
        .into_iter()
        .find(|candidate| {
            background_remover_candidate_is_usable_for_processing(
                candidate,
                manifest_dir,
                EXTERNAL_BACKGROUND_REMOVER_PROBE_TIMEOUT,
            )
        })
}

pub(crate) fn resolve_ffmpeg_executable() -> Option<PathBuf> {
    resolve_executable(ExecutableKind::Ffmpeg)
}

fn executable_candidates(
    kind: ExecutableKind,
    configured: Option<PathBuf>,
    manifest_dir: &Path,
) -> Vec<PathBuf> {
    let search_path = std::env::var_os("PATH");
    let mut candidates = configured_executable_candidates(configured, search_path.as_deref());
    candidates.extend(current_platform_executable_candidates(kind, manifest_dir));
    candidates
}

fn configured_executable_candidates(
    configured: Option<PathBuf>,
    search_path: Option<&OsStr>,
) -> Vec<PathBuf> {
    let Some(candidate) = configured else {
        return Vec::new();
    };
    if candidate.is_absolute() || candidate.components().count() > 1 {
        return vec![candidate];
    }
    let candidates = search_path
        .map(std::env::split_paths)
        .into_iter()
        .flatten()
        .map(|directory| directory.join(&candidate))
        .collect::<Vec<_>>();
    if candidates.is_empty() {
        vec![candidate]
    } else {
        candidates
    }
}

fn development_runtime_override(
    configured: Option<OsString>,
    include_development_overrides: bool,
) -> Option<PathBuf> {
    include_development_overrides
        .then_some(configured)
        .flatten()
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
}

fn current_platform_executable_candidates(
    kind: ExecutableKind,
    manifest_dir: &Path,
) -> Vec<PathBuf> {
    #[cfg(target_os = "macos")]
    {
        macos::executable_candidates(kind, manifest_dir)
    }
    #[cfg(target_os = "windows")]
    {
        windows::executable_candidates(kind, manifest_dir)
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = manifest_dir;
        vec![PathBuf::from(kind.program_name())]
    }
}

fn current_platform_model_candidates(manifest_dir: &Path, home: Option<&Path>) -> Vec<PathBuf> {
    #[cfg(target_os = "macos")]
    {
        macos::u2netp_model_candidates(manifest_dir, home)
    }
    #[cfg(target_os = "windows")]
    {
        windows::u2netp_model_candidates(manifest_dir, home)
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let mut candidates = Vec::new();
        if let Some(home) = home {
            candidates.push(home.join(".u2net").join("u2netp.pth"));
        }
        let _ = manifest_dir;
        candidates
    }
}

fn resolve_u2netp_model() -> Option<PathBuf> {
    let configured = development_runtime_override(
        std::env::var_os("U2NETP_PATH"),
        cfg!(debug_assertions),
    );
    configured
        .into_iter()
        .chain(current_platform_model_candidates(
            Path::new(env!("CARGO_MANIFEST_DIR")),
            home_directory().as_deref(),
        ))
        .into_iter()
        .find(|candidate| candidate.is_file())
}

fn executable_responds(candidate: &Path, kind: ExecutableKind) -> bool {
    executable_responds_with_timeout(candidate, kind, EXECUTABLE_PROBE_TIMEOUT)
}

fn executable_is_available(candidate: &Path, kind: ExecutableKind) -> bool {
    if matches!(kind, ExecutableKind::BackgroundRemover) {
        return is_executable_file(candidate);
    }
    executable_responds(candidate, kind)
}

fn is_executable_file(candidate: &Path) -> bool {
    let Ok(metadata) = fs::metadata(candidate) else {
        return false;
    };
    if !metadata.is_file() {
        return false;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        metadata.permissions().mode() & 0o111 != 0
    }
    #[cfg(not(unix))]
    {
        true
    }
}

fn background_remover_candidate_is_usable_for_processing(
    candidate: &Path,
    manifest_dir: &Path,
    external_probe_timeout: Duration,
) -> bool {
    if !is_executable_file(candidate) {
        return false;
    }
    if current_platform_runtime_root(candidate, manifest_dir)
        .is_some_and(|root| runtime_manifest_matches_target(&root))
    {
        return true;
    }
    executable_responds_with_timeout(
        candidate,
        ExecutableKind::BackgroundRemover,
        external_probe_timeout,
    )
}

fn executable_responds_with_timeout(
    candidate: &Path,
    kind: ExecutableKind,
    timeout: Duration,
) -> bool {
    let argument = if matches!(kind, ExecutableKind::BackgroundRemover) {
        "--help"
    } else {
        "-version"
    };
    let mut command = Command::new(candidate);
    command
        .arg(argument)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    if matches!(kind, ExecutableKind::BackgroundRemover) {
        command.env("BACKGROUNDREMOVER_DEVICE", "cpu");
        configure_frozen_worker_numba(
            &mut command,
            &std::env::temp_dir().join("cpa-video-editor-numba-cache"),
        );
    }
    let Ok(mut child) = command.spawn() else {
        return false;
    };
    let started = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(status)) => return status.success(),
            Ok(None) if started.elapsed() < timeout => {
                let remaining = timeout.saturating_sub(started.elapsed());
                thread::sleep(EXECUTABLE_PROBE_POLL_INTERVAL.min(remaining));
            }
            Ok(None) | Err(_) => {
                let _ = child.kill();
                let _ = child.wait();
                return false;
            }
        }
    }
}

fn configure_frozen_worker_numba(command: &mut Command, cache_dir: &Path) {
    command.env("NUMBA_DISABLE_JIT", "1");
    command.env("NUMBA_CACHE_DIR", cache_dir);
}

fn home_directory() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
}

fn path_string(path: Option<&Path>) -> Option<String> {
    path.map(|path| path.to_string_lossy().into_owned())
}

fn prepend_runtime_path(
    command: &mut Command,
    ffmpeg: &Path,
    ffprobe: &Path,
) -> Result<(), String> {
    let mut directories = Vec::new();
    for executable in [ffmpeg, ffprobe] {
        if let Some(parent) = executable
            .parent()
            .filter(|parent| !parent.as_os_str().is_empty())
        {
            if !directories.iter().any(|existing| existing == parent) {
                directories.push(parent.to_path_buf());
            }
        }
    }
    if let Some(existing) = std::env::var_os("PATH") {
        directories.extend(std::env::split_paths(&existing));
    }
    let joined = std::env::join_paths(directories)
        .map_err(|error| format!("无法配置视频处理运行路径：{error}"))?;
    command.env("PATH", joined);
    Ok(())
}

fn run_checked_command(command: Command, label: &str) -> Result<(), String> {
    run_capture_checked(command, label).map(|_| ())
}

fn run_capture_checked(mut command: Command, label: &str) -> Result<Output, String> {
    command.stdin(Stdio::null());
    let output = command
        .output()
        .map_err(|error| format!("无法启动{label}：{error}"))?;
    if !output.status.success() {
        let detail = process_output_tail(&output);
        return Err(if detail.is_empty() {
            format!("{label}失败，退出状态：{}", output.status)
        } else {
            format!("{label}失败：{detail}")
        });
    }
    Ok(output)
}

fn process_output_tail(output: &Output) -> String {
    let bytes = if output.stderr.is_empty() {
        &output.stdout
    } else {
        &output.stderr
    };
    let start = bytes.len().saturating_sub(8 * 1024);
    String::from_utf8_lossy(&bytes[start..]).trim().to_string()
}

fn ensure_nonempty_file(path: &Path, label: &str) -> Result<(), String> {
    let metadata = fs::metadata(path).map_err(|error| format!("{label}未生成：{error}"))?;
    if !metadata.is_file() || metadata.len() == 0 {
        return Err(format!("{label}为空"));
    }
    Ok(())
}

fn replace_output_file(partial: &Path, output: &Path, input: &Path) -> Result<(), String> {
    let output = validate_output_path(output)?;
    if paths_are_equal(input, &output) {
        return Err("输入视频和输出视频不能是同一个文件".to_string());
    }

    #[cfg(unix)]
    {
        fs::rename(partial, output).map_err(|error| format!("无法保存编辑后的视频：{error}"))
    }
    #[cfg(not(unix))]
    {
        if output.exists() {
            fs::remove_file(&output).map_err(|error| format!("无法替换已有输出视频：{error}"))?;
        }
        fs::rename(partial, output).map_err(|error| format!("无法保存编辑后的视频：{error}"))
    }
}

struct JobTempDir {
    path: PathBuf,
}

impl JobTempDir {
    fn new(job_id: &str) -> Result<Self, String> {
        for _ in 0..10 {
            let sequence = JOB_COUNTER.fetch_add(1, Ordering::Relaxed);
            let path = std::env::temp_dir().join(format!(
                "cpa-video-editor-{job_id}-{}-{sequence}",
                std::process::id()
            ));
            match fs::create_dir(&path) {
                Ok(()) => return Ok(Self { path }),
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
                Err(error) => return Err(format!("无法创建视频处理临时目录：{error}")),
            }
        }
        Err("无法创建唯一的视频处理临时目录".to_string())
    }

    fn path(&self) -> &Path {
        &self.path
    }
}

impl Drop for JobTempDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.path);
    }
}

struct OutputStagingDir {
    path: PathBuf,
}

impl OutputStagingDir {
    fn new(output: &Path, job_id: &str) -> Result<Self, String> {
        let parent = output
            .parent()
            .ok_or_else(|| "输出视频路径缺少父目录".to_string())?;
        for _ in 0..10 {
            let sequence = JOB_COUNTER.fetch_add(1, Ordering::Relaxed);
            let path = parent.join(format!(
                ".cpa-video-editor-{job_id}-{}-{sequence}",
                std::process::id()
            ));
            match create_private_directory(&path) {
                Ok(()) => return Ok(Self { path }),
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
                Err(error) => return Err(format!("无法创建输出暂存目录：{error}")),
            }
        }
        Err("无法创建唯一的输出暂存目录".to_string())
    }

    fn path(&self) -> &Path {
        &self.path
    }
}

impl Drop for OutputStagingDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.path);
    }
}

#[cfg(unix)]
fn create_private_directory(path: &Path) -> std::io::Result<()> {
    use std::os::unix::fs::DirBuilderExt;

    let mut builder = fs::DirBuilder::new();
    builder.mode(0o700).create(path)
}

#[cfg(not(unix))]
fn create_private_directory(path: &Path) -> std::io::Result<()> {
    fs::create_dir(path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::sync::atomic::{AtomicU64, Ordering};

    static TEST_FILE_COUNTER: AtomicU64 = AtomicU64::new(1);

    fn probe() -> VideoProbe {
        VideoProbe {
            width: 854,
            height: 480,
            duration_seconds: 3.5,
            frame_rate: 24.0,
        }
    }

    fn valid_request(input_path: String, output_path: String) -> VideoProcessRequest {
        VideoProcessRequest {
            job_id: "job-1".to_string(),
            input_path,
            output_path,
            crop: VideoCrop {
                x: 0,
                y: 0,
                width: 854,
                height: 480,
            },
            start_seconds: 0.0,
            end_seconds: 3.5,
            threshold: 24,
            brush_strokes: vec![BrushStroke {
                radius: 0.03,
                points: vec![BrushPoint { x: 0.25, y: 0.75 }],
            }],
        }
    }

    fn temp_video(extension: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "cpa-video-editor-validation-{}-{}-{}",
            std::process::id(),
            TEST_FILE_COUNTER.fetch_add(1, Ordering::Relaxed),
            extension
        ));
        fs::create_dir_all(&dir).expect("create temp directory");
        let path = dir.join(format!("source.{extension}"));
        fs::write(&path, b"video").expect("write source fixture");
        path
    }

    #[test]
    fn accepts_a_complete_safe_edit_request() {
        let input = temp_video("mp4");
        let output = input.parent().unwrap().join("result.webm");

        let validated = validate_process_request(
            valid_request(
                input.to_string_lossy().into_owned(),
                output.to_string_lossy().into_owned(),
            ),
            &probe(),
        )
        .expect("request should be valid");

        assert_eq!(validated.input_path, input.canonicalize().unwrap());
        assert_eq!(
            validated.output_path,
            output
                .parent()
                .unwrap()
                .canonicalize()
                .unwrap()
                .join("result.webm")
        );
        assert_eq!(validated.threshold, 24);

        let _ = fs::remove_dir_all(input.parent().unwrap());
    }

    #[test]
    fn creates_a_private_output_staging_directory_next_to_the_destination() {
        let input = temp_video("mp4");
        let output = input.parent().unwrap().join("result.webm");

        let staging = OutputStagingDir::new(&output, "reservation-test")
            .expect("create output staging directory");
        let staging_path = staging.path().to_path_buf();
        let metadata = fs::symlink_metadata(&staging_path).expect("read staging metadata");

        assert!(metadata.is_dir());
        assert!(!metadata.file_type().is_symlink());
        assert_eq!(staging_path.parent(), output.parent());
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(metadata.permissions().mode() & 0o777, 0o700);
        }

        drop(staging);
        assert!(!staging_path.exists());
        let _ = fs::remove_dir_all(input.parent().unwrap());
    }

    #[test]
    fn rejects_relative_and_unsupported_paths() {
        assert_eq!(
            validate_input_path(Path::new("videos/cat.mp4")).unwrap_err(),
            "输入视频路径必须是绝对路径"
        );

        let input = temp_video("txt");
        assert_eq!(
            validate_input_path(&input).unwrap_err(),
            "不支持该输入视频格式"
        );
        assert_eq!(
            validate_output_path(Path::new("result.webm")).unwrap_err(),
            "输出视频路径必须是绝对路径"
        );
        assert_eq!(
            validate_output_path(&input.parent().unwrap().join("result.mov")).unwrap_err(),
            "输出视频必须使用 .webm 扩展名"
        );

        let _ = fs::remove_dir_all(input.parent().unwrap());
    }

    #[test]
    fn rejects_using_the_input_file_as_the_output() {
        let input = temp_video("webm");
        let error = validate_process_request(
            valid_request(
                input.to_string_lossy().into_owned(),
                input.to_string_lossy().into_owned(),
            ),
            &probe(),
        )
        .unwrap_err();

        assert_eq!(error, "输入视频和输出视频不能是同一个文件");
        let _ = fs::remove_dir_all(input.parent().unwrap());
    }

    #[cfg(unix)]
    #[test]
    fn rejects_an_output_hard_link_to_the_input_file() {
        let input = temp_video("webm");
        let original = fs::read(&input).expect("read original input");
        let output = input.parent().unwrap().join("result.webm");
        fs::hard_link(&input, &output).expect("create output hard link");

        let error = validate_process_request(
            valid_request(
                input.to_string_lossy().into_owned(),
                output.to_string_lossy().into_owned(),
            ),
            &probe(),
        )
        .unwrap_err();

        assert_eq!(error, "输入视频和输出视频不能是同一个文件");
        assert_eq!(
            fs::read(&input).expect("input must remain readable"),
            original
        );
        assert_eq!(
            fs::read(&output).expect("hard link must remain readable"),
            original
        );
        let _ = fs::remove_dir_all(input.parent().unwrap());
    }

    #[cfg(unix)]
    #[test]
    fn rechecks_output_identity_immediately_before_replacement() {
        let input = temp_video("webm");
        let original = fs::read(&input).expect("read original input");
        let output = input.parent().unwrap().join("result.webm");
        let staging = OutputStagingDir::new(&output, "replace-race-test")
            .expect("create output staging directory");
        let partial = staging.path().join("result.webm");
        fs::write(&partial, b"new-video").expect("write staged video");
        fs::hard_link(&input, &output).expect("race output into input identity");

        let error = replace_output_file(&partial, &output, &input).unwrap_err();

        assert_eq!(error, "输入视频和输出视频不能是同一个文件");
        assert_eq!(
            fs::read(&input).expect("input must remain readable"),
            original
        );
        assert_eq!(
            fs::read(&partial).expect("staged output must remain"),
            b"new-video"
        );
        let _ = fs::remove_dir_all(input.parent().unwrap());
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn rejects_case_variant_output_that_resolves_to_the_input_file() {
        let original_path = temp_video("webm");
        let input = original_path.parent().unwrap().join("Source.webm");
        fs::rename(&original_path, &input).expect("rename source with mixed case");
        let original = fs::read(&input).expect("read original input");
        let output = input.parent().unwrap().join("source.webm");

        if output.exists() {
            let error = validate_process_request(
                valid_request(
                    input.to_string_lossy().into_owned(),
                    output.to_string_lossy().into_owned(),
                ),
                &probe(),
            )
            .unwrap_err();
            assert_eq!(error, "输入视频和输出视频不能是同一个文件");
            assert_eq!(
                fs::read(&input).expect("input must remain readable"),
                original
            );
        }

        let _ = fs::remove_dir_all(input.parent().unwrap());
    }

    #[cfg(unix)]
    #[test]
    fn rejects_an_output_symlink_that_points_back_to_the_input() {
        use std::os::unix::fs::symlink;

        let input = temp_video("webm");
        let original = fs::read(&input).expect("read original input");
        let output = input.parent().unwrap().join("result.webm");
        symlink(&input, &output).expect("create output symlink");

        let error = validate_process_request(
            valid_request(
                input.to_string_lossy().into_owned(),
                output.to_string_lossy().into_owned(),
            ),
            &probe(),
        )
        .unwrap_err();

        assert_eq!(error, "输出视频路径不能是符号链接");
        assert_eq!(
            fs::read(&input).expect("input must remain readable"),
            original
        );
        assert!(fs::symlink_metadata(&output)
            .expect("output symlink must remain in place")
            .file_type()
            .is_symlink());
        let _ = fs::remove_dir_all(input.parent().unwrap());
    }

    #[cfg(unix)]
    #[test]
    fn rejects_an_output_symlink_without_modifying_its_non_video_target() {
        use std::os::unix::fs::symlink;

        let input = temp_video("mp4");
        let important = input.parent().unwrap().join("important.txt");
        let important_contents = b"must-not-be-overwritten";
        fs::write(&important, important_contents).expect("write important target");
        let output = input.parent().unwrap().join("result.webm");
        symlink(&important, &output).expect("create output symlink");

        let error = validate_process_request(
            valid_request(
                input.to_string_lossy().into_owned(),
                output.to_string_lossy().into_owned(),
            ),
            &probe(),
        )
        .unwrap_err();

        assert_eq!(error, "输出视频路径不能是符号链接");
        assert_eq!(
            fs::read(&important).expect("important target must remain readable"),
            important_contents
        );
        assert!(fs::symlink_metadata(&output)
            .expect("output symlink must remain in place")
            .file_type()
            .is_symlink());
        let _ = fs::remove_dir_all(input.parent().unwrap());
    }

    #[test]
    fn rejects_crop_time_and_threshold_outside_the_probe_range() {
        let input = temp_video("mp4");
        let output = input.parent().unwrap().join("result.webm");
        let mut request = valid_request(
            input.to_string_lossy().into_owned(),
            output.to_string_lossy().into_owned(),
        );
        request.crop.width = 856;
        assert_eq!(
            validate_process_request(request.clone(), &probe()).unwrap_err(),
            "裁剪区域超出视频范围"
        );

        request.crop.width = 854;
        request.end_seconds = 4.0;
        assert_eq!(
            validate_process_request(request.clone(), &probe()).unwrap_err(),
            "视频时间范围无效"
        );

        request.end_seconds = 3.5;
        request.threshold = 256;
        assert_eq!(
            validate_process_request(request, &probe()).unwrap_err(),
            "抠图阈值必须在 0 到 255 之间"
        );

        let _ = fs::remove_dir_all(input.parent().unwrap());
    }

    #[test]
    fn rejects_excessive_or_out_of_range_brush_points() {
        let too_many = BrushStroke {
            radius: 0.03,
            points: vec![BrushPoint { x: 0.5, y: 0.5 }; MAX_BRUSH_POINTS + 1],
        };
        assert_eq!(
            validate_brush_strokes(&[too_many]).unwrap_err(),
            format!("画笔点数不能超过 {MAX_BRUSH_POINTS} 个")
        );

        assert_eq!(
            validate_brush_strokes(&[BrushStroke {
                radius: 0.03,
                points: vec![BrushPoint { x: 1.1, y: 0.5 }],
            }])
            .unwrap_err(),
            "画笔坐标必须在 0 到 1 之间"
        );
    }

    #[test]
    fn ffprobe_rotation_metadata_swaps_display_dimensions() {
        let metadata = br#"{
            "streams": [{
                "width": 1920,
                "height": 1080,
                "avg_frame_rate": "30000/1001",
                "r_frame_rate": "30/1",
                "duration": "3.5",
                "tags": { "rotate": "90" },
                "side_data_list": [{ "rotation": 90 }]
            }],
            "format": { "duration": "3.5" }
        }"#;

        let result = parse_ffprobe_json(metadata).expect("probe metadata should parse");

        assert_eq!(result.width, 1080);
        assert_eq!(result.height, 1920);
        assert_eq!(result.duration_seconds, 3.5);
        assert!((result.frame_rate - 29.970_029_97).abs() < 0.000_001);
    }

    #[test]
    fn brush_mask_is_white_except_for_the_static_painted_region() {
        let mask = build_brush_mask_pgm(
            10,
            10,
            &[BrushStroke {
                radius: 0.1,
                points: vec![BrushPoint { x: 0.5, y: 0.5 }],
            }],
        )
        .expect("mask should render");
        let header = b"P5\n10 10\n255\n";

        assert!(mask.starts_with(header));
        let pixels = &mask[header.len()..];
        assert_eq!(pixels.len(), 100);
        assert_eq!(pixels[0], 255);
        assert_eq!(pixels[5 * 10 + 5], 0);
    }

    fn argument_strings(arguments: Vec<OsString>) -> Vec<String> {
        arguments
            .into_iter()
            .map(|argument| argument.to_string_lossy().into_owned())
            .collect()
    }

    #[test]
    fn video_runtime_targets_match_the_supported_desktop_architectures() {
        assert_eq!(
            runtime_target_for("macos", "x86_64"),
            Some(RuntimeTarget {
                directory_name: "macos-x86_64",
                manifest_architecture: "x86_64",
            })
        );
        assert_eq!(
            runtime_target_for("windows", "x86_64"),
            Some(RuntimeTarget {
                directory_name: "windows-x86_64",
                manifest_architecture: "x86_64",
            })
        );
        assert_eq!(
            runtime_target_for("macos", "aarch64"),
            Some(RuntimeTarget {
                directory_name: "macos-arm64",
                manifest_architecture: "arm64",
            })
        );
        assert_eq!(
            runtime_target_for("macos", "arm64"),
            runtime_target_for("macos", "aarch64")
        );
        assert_eq!(runtime_target_for("windows", "aarch64"), None);
    }

    #[test]
    fn runtime_manifest_uses_the_mapped_manifest_architecture() {
        let root = std::env::temp_dir().join(format!(
            "cpa-video-runtime-x64-manifest-{}-{}",
            std::process::id(),
            TEST_FILE_COUNTER.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&root).expect("create runtime manifest fixture");
        let target = runtime_target_for("macos", "x86_64").expect("macOS x64 target");

        fs::write(
            root.join("runtime-manifest.json"),
            r#"{"schemaVersion":1,"architecture":"x86_64","target":"macos-x86_64"}"#,
        )
        .expect("write matching x64 runtime manifest");
        assert!(runtime_manifest_matches(&root, target));

        fs::write(
            root.join("runtime-manifest.json"),
            r#"{"schemaVersion":1,"architecture":"arm64","target":"macos-x86_64"}"#,
        )
        .expect("write mismatched x64 runtime manifest");
        assert!(!runtime_manifest_matches(&root, target));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn arm_runtime_manifest_requires_the_arm_directory_and_architecture() {
        let root = std::env::temp_dir().join(format!(
            "cpa-video-runtime-arm64-manifest-{}-{}",
            std::process::id(),
            TEST_FILE_COUNTER.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&root).expect("create ARM runtime manifest fixture");
        let target = runtime_target_for("macos", "aarch64").expect("macOS ARM64 target");

        fs::write(
            root.join("runtime-manifest.json"),
            r#"{"schemaVersion":1,"architecture":"arm64","target":"macos-arm64"}"#,
        )
        .expect("write matching ARM runtime manifest");
        assert!(runtime_manifest_matches(&root, target));

        fs::write(
            root.join("runtime-manifest.json"),
            r#"{"schemaVersion":1,"architecture":"x86_64","target":"macos-arm64"}"#,
        )
        .expect("write mismatched ARM runtime manifest");
        assert!(!runtime_manifest_matches(&root, target));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn macos_module_selects_the_runtime_for_the_compiled_architecture() {
        assert_eq!(
            macos::runtime_target(),
            runtime_target_for("macos", std::env::consts::ARCH)
                .expect("supported macOS architecture")
        );
    }

    #[cfg(target_arch = "x86_64")]
    #[test]
    fn windows_module_selects_the_runtime_for_the_compiled_architecture() {
        assert_eq!(
            windows::runtime_target(),
            runtime_target_for("windows", std::env::consts::ARCH)
                .expect("supported Windows architecture")
        );
    }

    #[test]
    fn macos_and_windows_have_candidates_for_the_compiled_architecture() {
        let manifest = Path::new("/workspace/app/src-tauri");
        let mac = macos::executable_candidates(ExecutableKind::Ffmpeg, manifest);
        let mac_worker = macos::executable_candidates(ExecutableKind::BackgroundRemover, manifest);

        assert!(mac.contains(&PathBuf::from("/usr/local/bin/ffmpeg")));
        let current_macos_target = macos::runtime_target();
        assert!(mac
            .iter()
            .any(|path| path.ends_with(
                Path::new("video-runtime")
                    .join(current_macos_target.directory_name)
                    .join("bin/ffmpeg")
            )));
        assert!(mac_worker.contains(&PathBuf::from("/usr/local/bin/backgroundremover")));

        #[cfg(target_arch = "x86_64")]
        {
            let windows = windows::executable_candidates(ExecutableKind::Ffmpeg, manifest);
            let windows_worker =
                windows::executable_candidates(ExecutableKind::BackgroundRemover, manifest);
            assert!(windows.contains(&PathBuf::from(r"C:\ffmpeg\bin\ffmpeg.exe")));
            assert!(windows.iter().any(|path| {
                path.ends_with(r"video-runtime\windows-x86_64\bin\ffmpeg.exe")
                    || path.ends_with("video-runtime/windows-x86_64/bin/ffmpeg.exe")
            }));
            assert!(windows_worker.iter().any(|path| {
                path.to_string_lossy()
                    .contains("BackgroundRemover/.venv/Scripts/backgroundremover.exe")
            }));
        }
    }

    #[test]
    fn release_runtime_roots_use_only_the_installed_payload() {
        let manifest = Path::new("/workspace/app/src-tauri");
        let mac_executable = Path::new("/Applications/CPA.app/Contents/MacOS/app");

        let mac_roots = macos::runtime_roots_for(manifest, Some(mac_executable), false);
        assert_eq!(
            mac_roots,
            vec![PathBuf::from("/Applications/CPA.app/Contents/MacOS")
                .join("../Resources/video-runtime")
                .join(macos::runtime_target().directory_name),]
        );
        assert!(!mac_roots.iter().any(|path| path.starts_with(manifest)));

        #[cfg(target_arch = "x86_64")]
        {
            let windows_executable = Path::new("/opt/CPA/app.exe");
            let windows_roots =
                windows::runtime_roots_for(manifest, Some(windows_executable), false);
            assert_eq!(
                windows_roots,
                vec![PathBuf::from("/opt/CPA/video-runtime")
                    .join(windows::runtime_target().directory_name),]
            );
            assert!(!windows_roots.iter().any(|path| path.starts_with(manifest)));
        }
    }

    #[test]
    fn development_runtime_roots_prefer_the_installed_layout_before_staging() {
        let manifest = Path::new("/workspace/app/src-tauri");
        let executable = Path::new("/Applications/CPA.app/Contents/MacOS/app");

        let roots = macos::runtime_roots_for(manifest, Some(executable), true);

        assert_eq!(
            roots.first(),
            Some(
                &PathBuf::from("/Applications/CPA.app/Contents/MacOS")
                    .join("../Resources/video-runtime")
                    .join(macos::runtime_target().directory_name),
            ),
        );
        assert_eq!(
            roots.get(1),
            Some(
                &manifest
                    .join("video-runtime")
                    .join(macos::runtime_target().directory_name),
            ),
        );
    }

    #[test]
    fn background_remover_disables_frozen_worker_jit_and_uses_a_writable_cache() {
        let mut command = Command::new("backgroundremover");
        let cache_dir = Path::new("/tmp/cpa-video-editor-job/numba-cache");

        configure_frozen_worker_numba(&mut command, cache_dir);

        assert_eq!(
            command
                .get_envs()
                .find(|(key, _)| *key == OsStr::new("NUMBA_CACHE_DIR"))
                .and_then(|(_, value)| value),
            Some(cache_dir.as_os_str()),
        );
        assert_eq!(
            command
                .get_envs()
                .find(|(key, _)| *key == OsStr::new("NUMBA_DISABLE_JIT"))
                .and_then(|(_, value)| value),
            Some(OsStr::new("1")),
        );
    }

    #[cfg(unix)]
    #[test]
    fn runtime_health_probe_times_out_instead_of_leaking_a_child() {
        use std::time::{Duration, Instant};

        let pids_before = Command::new("/usr/bin/pgrep")
            .args(["-x", "yes"])
            .output()
            .map(|output| output.stdout)
            .unwrap_or_default();

        let started = Instant::now();
        assert!(!executable_responds_with_timeout(
            Path::new("/usr/bin/yes"),
            ExecutableKind::Ffmpeg,
            Duration::from_millis(50),
        ));
        assert!(!background_remover_candidate_is_usable_for_processing(
            Path::new("/usr/bin/yes"),
            Path::new("/workspace/app/src-tauri"),
            Duration::from_millis(50),
        ));
        assert!(started.elapsed() < Duration::from_secs(2));
        let pids_after = Command::new("/usr/bin/pgrep")
            .args(["-x", "yes"])
            .output()
            .map(|output| output.stdout)
            .unwrap_or_default();
        assert_eq!(
            pids_after, pids_before,
            "timed-out runtime child must be killed and reaped",
        );
    }

    #[cfg(unix)]
    #[test]
    fn background_remover_availability_does_not_launch_the_slow_worker() {
        use std::os::unix::fs::PermissionsExt;

        let root = std::env::temp_dir().join(format!(
            "cpa-video-runtime-worker-availability-{}-{}",
            std::process::id(),
            TEST_FILE_COUNTER.fetch_add(1, Ordering::Relaxed),
        ));
        fs::create_dir_all(&root).expect("create worker availability fixture");
        let marker = root.join("launched");
        let worker = root.join("backgroundremover");
        fs::write(
            &worker,
            format!(
                "#!/bin/sh\ntouch '{}'\nexec /bin/sleep 60\n",
                marker.display()
            ),
        )
        .expect("write worker availability fixture");
        let mut permissions = fs::metadata(&worker).unwrap().permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(&worker, permissions).unwrap();

        assert!(executable_is_available(
            &worker,
            ExecutableKind::BackgroundRemover,
        ));
        assert!(
            !marker.exists(),
            "availability check must not launch the worker"
        );

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn bundled_runtime_manifest_must_match_the_compiled_target() {
        let root = std::env::temp_dir().join(format!(
            "cpa-video-runtime-manifest-{}-{}",
            std::process::id(),
            TEST_FILE_COUNTER.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&root).expect("create runtime manifest fixture");
        let current_target = current_platform_runtime_target();
        fs::write(
            root.join("runtime-manifest.json"),
            format!(
                r#"{{"schemaVersion":1,"architecture":"{}","target":"{}"}}"#,
                current_target.manifest_architecture, current_target.directory_name
            ),
        )
        .expect("write matching runtime manifest");
        assert!(runtime_manifest_matches_target(&root));

        let mismatched_architecture = if current_target.manifest_architecture == "arm64" {
            "x86_64"
        } else {
            "arm64"
        };
        fs::write(
            root.join("runtime-manifest.json"),
            format!(
                r#"{{"schemaVersion":1,"architecture":"{}","target":"{}"}}"#,
                mismatched_architecture, current_target.directory_name
            ),
        )
        .expect("write wrong-architecture runtime manifest");
        assert!(!runtime_manifest_matches_target(&root));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn explicit_runtime_override_is_the_first_candidate() {
        let candidates = executable_candidates(
            ExecutableKind::Ffmpeg,
            Some(PathBuf::from("/opt/cpa-runtime/ffmpeg")),
            Path::new("/workspace/app/src-tauri"),
        );

        assert_eq!(
            candidates.first(),
            Some(&PathBuf::from("/opt/cpa-runtime/ffmpeg"))
        );
        assert_eq!(ExecutableKind::Ffmpeg.environment_key(), "CPA_FFMPEG");
    }

    #[test]
    fn release_runtime_ignores_external_environment_overrides() {
        assert_eq!(
            development_runtime_override(Some(OsString::from("/opt/external/ffmpeg")), false),
            None,
        );
        assert_eq!(
            development_runtime_override(Some(OsString::from("/opt/external/ffmpeg")), true),
            Some(PathBuf::from("/opt/external/ffmpeg")),
        );
    }

    #[test]
    fn relative_runtime_override_is_resolved_through_path() {
        let search_path =
            std::env::join_paths([Path::new("/opt/cpa/bin"), Path::new("/usr/local/bin")])
                .expect("build PATH fixture");

        let candidates = configured_executable_candidates(
            Some(PathBuf::from("backgroundremover")),
            Some(search_path.as_os_str()),
        );

        assert_eq!(
            candidates,
            vec![
                PathBuf::from("/opt/cpa/bin/backgroundremover"),
                PathBuf::from("/usr/local/bin/backgroundremover"),
            ],
        );
    }

    #[test]
    fn edited_video_output_filename_keeps_the_input_stem() {
        assert_eq!(
            edited_video_output_filename("/Users/xpy/Videos/cat.mp4"),
            "cat-transparent.webm",
        );
        assert_eq!(
            edited_video_output_filename(""),
            "edited-video-transparent.webm",
        );
    }

    #[test]
    fn command_arguments_crop_and_trim_before_u2netp_matting() {
        let request = ValidatedRequest {
            input_path: PathBuf::from("/videos/cat.mp4"),
            output_path: PathBuf::from("/videos/cat-alpha.webm"),
            crop: VideoCrop {
                x: 10,
                y: 20,
                width: 800,
                height: 400,
            },
            start_seconds: 0.5,
            end_seconds: 3.0,
            threshold: 24,
            brush_strokes: vec![],
        };
        let preprocess = argument_strings(preprocess_arguments(
            &request,
            Path::new("/tmp/preprocessed.mp4"),
        ));
        let matting = argument_strings(background_remover_arguments(
            Path::new("/tmp/preprocessed.mp4"),
            Path::new("/tmp/matte.mp4"),
        ));

        assert!(preprocess
            .windows(2)
            .any(|pair| pair == ["-ss", "0.500000"]));
        assert!(preprocess.windows(2).any(|pair| pair == ["-t", "2.500000"]));
        assert!(preprocess.contains(&"crop=800:400:10:20,setsar=1".to_string()));
        assert!(matting.windows(2).any(|pair| pair == ["-m", "u2netp"]));
        assert!(matting.contains(&"-mk".to_string()));
        assert!(matting.windows(2).any(|pair| pair == ["-wn", "1"]));
    }

    #[test]
    fn alpha_postprocessing_keeps_values_above_threshold_and_applies_brush_mask() {
        let arguments = argument_strings(postprocess_arguments(
            Path::new("/tmp/source.mp4"),
            Path::new("/tmp/matte.mp4"),
            Path::new("/tmp/brush.pgm"),
            24,
            24.0,
            2.5,
            Path::new("/tmp/output.webm"),
        ));
        let filter = arguments
            .iter()
            .position(|argument| argument == "-filter_complex")
            .and_then(|index| arguments.get(index + 1))
            .expect("filter graph");

        assert!(filter.contains("if(lt(val,24),0,val)"));
        assert!(filter.contains("A*B/255"));
        assert!(arguments.windows(2).any(|pair| pair == ["-c:v", "libvpx"]));
        assert!(arguments.windows(2).any(|pair| pair == ["-crf", "18"]));
        assert!(arguments.windows(2).any(|pair| pair == ["-b:v", "0"]));
        assert!(arguments
            .windows(2)
            .any(|pair| pair == ["-pix_fmt", "yuva420p"]));
        assert!(arguments
            .windows(2)
            .any(|pair| pair == ["-metadata:s:v:0", "alpha_mode=1"]));
        assert!(arguments.windows(2).any(|pair| pair == ["-t", "2.500000"]));
    }

    fn validate_real_media_alpha(alpha: &[u8], width: u32, height: u32) -> Result<(), String> {
        let frame_pixels = usize::try_from(width)
            .ok()
            .and_then(|width| {
                usize::try_from(height)
                    .ok()
                    .and_then(|height| width.checked_mul(height))
            })
            .filter(|pixels| *pixels > 0)
            .ok_or_else(|| "alpha 画面尺寸无效".to_string())?;
        if alpha.len() < frame_pixels * 2 || alpha.len() % frame_pixels != 0 {
            return Err("alpha 语义门禁至少需要两个完整帧".to_string());
        }
        let frame_width = usize::try_from(width).map_err(|_| "alpha 宽度无效".to_string())?;
        for (frame_index, frame) in alpha.chunks_exact(frame_pixels).enumerate() {
            let min = frame.iter().copied().min().unwrap_or(0);
            let max = frame.iter().copied().max().unwrap_or(0);
            if max.saturating_sub(min) < 32 {
                return Err(format!("alpha 第 {frame_index} 帧动态范围不足"));
            }
            let foreground =
                frame.iter().filter(|value| **value >= 128).count() as f64 / frame_pixels as f64;
            if !(0.001..0.95).contains(&foreground) {
                return Err(format!("alpha 第 {frame_index} 帧前景比例异常"));
            }
            let soft = frame
                .iter()
                .filter(|value| (8..=247).contains(&**value))
                .count() as f64
                / frame_pixels as f64;
            if soft <= 0.001 {
                return Err(format!("alpha 第 {frame_index} 帧缺少软边缘"));
            }

            let mut adjacent_difference = 0_u64;
            let mut high_frequency = 0_usize;
            let mut adjacent_pairs = 0_usize;
            for row in frame.chunks_exact(frame_width) {
                for pair in row.windows(2) {
                    let difference = pair[0].abs_diff(pair[1]);
                    adjacent_difference += u64::from(difference);
                    high_frequency += usize::from(difference > 16);
                    adjacent_pairs += 1;
                }
            }
            let adjacent_mean = adjacent_difference as f64 / adjacent_pairs as f64;
            let high_frequency_ratio = high_frequency as f64 / adjacent_pairs as f64;
            if adjacent_mean <= 0.01 {
                return Err(format!("alpha 第 {frame_index} 帧没有空间变化"));
            }
            if adjacent_mean > 5.0 || high_frequency_ratio > 0.25 {
                return Err(format!("alpha 第 {frame_index} 帧出现高频条纹"));
            }
        }

        let mut temporal_difference = 0_u64;
        let mut temporal_pairs = 0_usize;
        for (frame_index, frames) in alpha
            .chunks_exact(frame_pixels)
            .collect::<Vec<_>>()
            .windows(2)
            .enumerate()
        {
            let frame_difference = frames[0]
                .iter()
                .zip(frames[1])
                .map(|(left, right)| u64::from(left.abs_diff(*right)))
                .sum::<u64>();
            if frame_difference as f64 / frame_pixels as f64 > 32.0 {
                return Err(format!("alpha 第 {frame_index} 与下一帧之间跳变异常"));
            }
            temporal_difference += frame_difference;
            temporal_pairs += frame_pixels;
        }
        let temporal_mean = temporal_difference as f64 / temporal_pairs as f64;
        if temporal_mean <= 0.01 {
            return Err("alpha 帧间没有时间变化".to_string());
        }
        Ok(())
    }

    #[test]
    fn saved_video_must_be_vp8_webm_with_alpha_metadata() {
        let valid = br#"{
            "streams": [{
                "codec_name": "vp8",
                "tags": { "ALPHA_MODE": "1" }
            }]
        }"#;
        validate_alpha_webm_probe(valid).expect("VP8 alpha output should be accepted");

        let opaque = br#"{
            "streams": [{
                "codec_name": "vp8",
                "tags": {}
            }]
        }"#;
        assert_eq!(
            validate_alpha_webm_probe(opaque).unwrap_err(),
            "输出 WebM 缺少 alpha 通道标记"
        );
    }

    #[test]
    fn real_media_alpha_gate_rejects_flat_static_and_striped_mattes() {
        let width = 64_u32;
        let height = 32_u32;
        let pixels = usize::try_from(width * height).unwrap();
        let healthy_first = (0..pixels)
            .map(|index| u8::try_from(index % usize::from(u8::MAX)).unwrap())
            .collect::<Vec<_>>();
        let healthy_second = healthy_first
            .iter()
            .map(|value| value.saturating_add(1))
            .collect::<Vec<_>>();
        let mut healthy = healthy_first.clone();
        healthy.extend_from_slice(&healthy_second);
        validate_real_media_alpha(&healthy, width, height)
            .expect("soft moving matte fixture should pass");

        let flat = vec![0_u8; pixels * 2];
        assert!(validate_real_media_alpha(&flat, width, height)
            .unwrap_err()
            .contains("动态范围"));

        let mut static_matte = healthy_first.clone();
        static_matte.extend_from_slice(&healthy_first);
        assert!(validate_real_media_alpha(&static_matte, width, height)
            .unwrap_err()
            .contains("时间变化"));

        let inverted = healthy_first
            .iter()
            .map(|value| u8::MAX - value)
            .collect::<Vec<_>>();
        let mut temporal_jump = healthy_first.clone();
        temporal_jump.extend_from_slice(&inverted);
        assert!(validate_real_media_alpha(&temporal_jump, width, height)
            .unwrap_err()
            .contains("跳变异常"));

        let striped_frame = (0..pixels)
            .map(|index| if index % 2 == 0 { 16 } else { 240 })
            .collect::<Vec<_>>();
        let mut striped = striped_frame.clone();
        striped.extend_from_slice(&striped_frame);
        assert!(validate_real_media_alpha(&striped, width, height)
            .unwrap_err()
            .contains("高频条纹"));
    }

    #[test]
    fn real_media_pipeline_runs_when_explicitly_enabled() {
        if std::env::var("CPA_VIDEO_EDITOR_E2E").as_deref() != Ok("1") {
            return;
        }

        let runtime = resolve_runtime().expect("configured video-editor runtime");
        let input = std::env::var_os("CPA_VIDEO_EDITOR_TEST_INPUT")
            .map(PathBuf::from)
            .unwrap_or_else(|| {
                Path::new(env!("CARGO_MANIFEST_DIR"))
                    .join("../tmp/video-matting-lab/media/cat-test.mp4")
            });
        assert!(
            input.is_file(),
            "set CPA_VIDEO_EDITOR_TEST_INPUT to an existing local animal video"
        );
        let probe = probe_video(&runtime.ffprobe, &input).expect("probe local E2E source");
        assert!(probe.duration_seconds >= 0.2, "E2E source is too short");

        let width = probe.width - (probe.width % 2);
        let height = probe.height - (probe.height % 2);
        let duration = probe.duration_seconds.min(0.75);
        let output_dir = std::env::temp_dir().join(format!(
            "cpa-video-editor-real-e2e-{}-{}",
            std::process::id(),
            JOB_COUNTER.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&output_dir).expect("create real E2E output directory");
        let output = output_dir.join("painted-alpha.webm");
        let request = VideoProcessRequest {
            job_id: "real-media-e2e".to_string(),
            input_path: input.to_string_lossy().into_owned(),
            output_path: output.to_string_lossy().into_owned(),
            crop: VideoCrop {
                x: 0,
                y: 0,
                width: i64::from(width),
                height: i64::from(height),
            },
            start_seconds: 0.0,
            end_seconds: duration,
            threshold: 0,
            brush_strokes: vec![BrushStroke {
                radius: 0.08,
                points: vec![BrushPoint { x: 0.5, y: 0.5 }],
            }],
        };
        let mut progress = Vec::new();

        let result = process_video_with_progress(request, |_job_id, percent, _stage| {
            progress.push(percent);
        })
        .expect("real BackgroundRemover pipeline");

        let returned_output = PathBuf::from(&result.output_path);
        assert!(returned_output.is_absolute());
        assert!(returned_output.is_file(), "returned output path must exist");
        assert_eq!(
            returned_output
                .canonicalize()
                .expect("canonicalize returned output path"),
            output
                .canonicalize()
                .expect("canonicalize expected output path"),
            "returned and requested paths must identify the same file"
        );
        assert!(
            fs::metadata(&returned_output)
                .expect("read returned output metadata")
                .len()
                > 0,
            "returned output file must not be empty"
        );
        assert_eq!(progress, vec![0, 10, 35, 70, 95, 100]);
        let output_probe = probe_video(&runtime.ffprobe, &output).expect("probe processed output");
        assert!((output_probe.duration_seconds - duration).abs() <= 0.3);

        let mut alpha_command = Command::new(&runtime.ffmpeg);
        alpha_command.args([
            OsString::from("-hide_banner"),
            OsString::from("-loglevel"),
            OsString::from("error"),
            OsString::from("-c:v"),
            OsString::from("libvpx"),
            OsString::from("-i"),
            output.as_os_str().to_owned(),
            OsString::from("-vf"),
            OsString::from("alphaextract"),
            OsString::from("-f"),
            OsString::from("rawvideo"),
            OsString::from("-pix_fmt"),
            OsString::from("gray"),
            OsString::from("-"),
        ]);
        let alpha = run_capture_checked(alpha_command, "提取 E2E alpha")
            .expect("decode output alpha frames")
            .stdout;
        let expected_pixels = usize::try_from(width)
            .unwrap()
            .checked_mul(usize::try_from(height).unwrap())
            .unwrap();
        validate_real_media_alpha(&alpha, width, height)
            .expect("real media alpha must contain stable moving foreground mattes");
        let center = usize::try_from(height / 2).unwrap() * usize::try_from(width).unwrap()
            + usize::try_from(width / 2).unwrap();
        assert!(alpha[center] <= 16, "painted center must be transparent");
        assert!(
            alpha[..expected_pixels].iter().copied().max().unwrap_or(0) > 16,
            "fixture must retain some foreground outside the painted region"
        );

        let _ = fs::remove_dir_all(output_dir);
    }
}
