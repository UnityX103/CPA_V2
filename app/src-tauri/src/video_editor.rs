use serde::{Deserialize, Serialize};
use std::ffi::OsString;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use tauri::{AppHandle, Emitter};

const MAX_BRUSH_STROKES: usize = 256;
const MAX_BRUSH_POINTS: usize = 20_000;
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
    if path.exists() {
        if !path.is_file() {
            return Err("输出视频路径不是普通文件".to_string());
        }
        return path
            .canonicalize()
            .map_err(|error| format!("无法读取已有输出视频路径：{error}"));
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

fn paths_are_equal(left: &Path, right: &Path) -> bool {
    #[cfg(target_os = "windows")]
    {
        left.to_string_lossy()
            .eq_ignore_ascii_case(&right.to_string_lossy())
    }
    #[cfg(not(target_os = "windows"))]
    {
        left == right
    }
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
#[allow(dead_code)]
enum RuntimePlatform {
    Macos,
    Windows,
    Other,
}

#[derive(Debug, Clone, Copy)]
enum ExecutableKind {
    Ffmpeg,
    Ffprobe,
    BackgroundRemover,
}

fn platform_candidates(
    kind: ExecutableKind,
    platform: RuntimePlatform,
    manifest_dir: &Path,
) -> Vec<PathBuf> {
    let name = match kind {
        ExecutableKind::Ffmpeg => "ffmpeg",
        ExecutableKind::Ffprobe => "ffprobe",
        ExecutableKind::BackgroundRemover => "backgroundremover",
    };
    let mut candidates = Vec::new();
    match platform {
        RuntimePlatform::Macos => {
            if matches!(kind, ExecutableKind::BackgroundRemover) {
                candidates.push(manifest_dir.join(
                    "../tmp/video-matting-lab/tools/BackgroundRemover/.venv/bin/backgroundremover",
                ));
            }
            candidates.push(PathBuf::from(name));
            candidates.push(PathBuf::from(format!("/usr/local/bin/{name}")));
            candidates.push(PathBuf::from(format!("/opt/homebrew/bin/{name}")));
        }
        RuntimePlatform::Windows => {
            if matches!(kind, ExecutableKind::BackgroundRemover) {
                candidates.push(PathBuf::from(format!(
                    r"{}\..\tmp\video-matting-lab\tools\BackgroundRemover\.venv\Scripts\backgroundremover.exe",
                    manifest_dir.display()
                )));
                candidates.push(PathBuf::from(r".venv\Scripts\backgroundremover.exe"));
            }
            let executable = if matches!(kind, ExecutableKind::BackgroundRemover) {
                "backgroundremover.exe".to_string()
            } else {
                format!("{name}.exe")
            };
            candidates.push(PathBuf::from(executable.clone()));
            candidates.push(PathBuf::from(format!(r"C:\ffmpeg\bin\{executable}")));
            if let Some(local_app_data) = std::env::var_os("LOCALAPPDATA") {
                candidates.push(
                    PathBuf::from(local_app_data)
                        .join("Microsoft")
                        .join("WinGet")
                        .join("Links")
                        .join(executable),
                );
            }
        }
        RuntimePlatform::Other => candidates.push(PathBuf::from(name)),
    }
    candidates
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
pub fn probe_video_for_editing(path: String) -> Result<VideoProbe, String> {
    let input = validate_input_path(Path::new(&path))?;
    let ffprobe = resolve_executable(ExecutableKind::Ffprobe)
        .ok_or_else(|| "未找到 ffprobe，请设置 CPA_FFPROBE".to_string())?;
    probe_video(&ffprobe, &input)
}

#[tauri::command]
pub fn video_editor_runtime_status() -> VideoEditorRuntimeStatus {
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
    let message = if ready {
        "外部视频抠图运行时可用；当前发布包尚未内置该运行时".to_string()
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
    validate_job_id(&request.job_id)?;
    emit_progress(app, &request.job_id, 0, "正在检查运行环境");
    let runtime = resolve_runtime()?;
    let source = validate_input_path(Path::new(&request.input_path))?;
    let probe = probe_video(&runtime.ffprobe, &source)?;
    let validated = validate_process_request(request.clone(), &probe)?;

    let job_dir = JobTempDir::new(&request.job_id)?;
    let preprocessed = job_dir.path().join("preprocessed.mp4");
    let matte = job_dir.path().join("matte.mp4");
    let brush_mask = job_dir.path().join("brush-mask.pgm");
    let partial_output = partial_output_path(&validated.output_path, &request.job_id)?;
    let mut partial_guard = PartialOutputGuard::new(partial_output.clone());

    emit_progress(app, &request.job_id, 10, "正在裁剪视频");
    let mut preprocess = Command::new(&runtime.ffmpeg);
    preprocess.args(preprocess_arguments(&validated, &preprocessed));
    run_checked_command(preprocess, "视频裁剪")?;
    ensure_nonempty_file(&preprocessed, "裁剪后的视频")?;

    emit_progress(app, &request.job_id, 35, "正在使用 BackgroundRemover 抠图");
    let mut background = Command::new(&runtime.background_remover);
    background.args(background_remover_arguments(&preprocessed, &matte));
    background.env("BACKGROUNDREMOVER_DEVICE", "cpu");
    background.env("U2NETP_PATH", &runtime.u2netp_model);
    background.env("PYTHONNOUSERSITE", "1");
    prepend_runtime_path(&mut background, &runtime.ffmpeg, &runtime.ffprobe)?;
    run_checked_command(background, "BackgroundRemover 抠图")?;
    ensure_nonempty_file(&matte, "BackgroundRemover 蒙版")?;

    emit_progress(app, &request.job_id, 70, "正在应用阈值和画笔");
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

    emit_progress(app, &request.job_id, 95, "正在验证透明视频");
    validate_alpha_webm_file(&runtime.ffprobe, &partial_output)?;
    replace_output_file(&partial_output, &validated.output_path)?;
    partial_guard.commit();

    emit_progress(app, &request.job_id, 100, "处理完成");
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
    let background_remover = resolve_executable(ExecutableKind::BackgroundRemover)
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
    let environment_key = match kind {
        ExecutableKind::Ffmpeg => "CPA_FFMPEG",
        ExecutableKind::Ffprobe => "CPA_FFPROBE",
        ExecutableKind::BackgroundRemover => "CPA_BACKGROUND_REMOVER",
    };
    let mut candidates = Vec::new();
    if let Some(configured) = std::env::var_os(environment_key).filter(|value| !value.is_empty()) {
        candidates.push(PathBuf::from(configured));
    }
    candidates.extend(platform_candidates(
        kind,
        current_platform(),
        Path::new(env!("CARGO_MANIFEST_DIR")),
    ));
    candidates
        .into_iter()
        .find(|candidate| executable_responds(candidate, kind))
}

fn executable_responds(candidate: &Path, kind: ExecutableKind) -> bool {
    let argument = if matches!(kind, ExecutableKind::BackgroundRemover) {
        "--help"
    } else {
        "-version"
    };
    Command::new(candidate)
        .arg(argument)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .is_ok_and(|status| status.success())
}

fn resolve_u2netp_model() -> Option<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(configured) = std::env::var_os("U2NETP_PATH").filter(|value| !value.is_empty()) {
        candidates.push(PathBuf::from(configured));
    }
    candidates.push(
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../tmp/video-matting-lab/tools/BackgroundRemover/models/u2netp.pth"),
    );
    if let Some(home) = home_directory() {
        candidates.push(home.join(".u2net").join("u2netp.pth"));
    }
    candidates.into_iter().find(|candidate| candidate.is_file())
}

fn home_directory() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
}

fn current_platform() -> RuntimePlatform {
    #[cfg(target_os = "macos")]
    {
        RuntimePlatform::Macos
    }
    #[cfg(target_os = "windows")]
    {
        RuntimePlatform::Windows
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        RuntimePlatform::Other
    }
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

fn partial_output_path(output: &Path, job_id: &str) -> Result<PathBuf, String> {
    let parent = output
        .parent()
        .ok_or_else(|| "输出视频路径缺少父目录".to_string())?;
    let filename = output
        .file_stem()
        .and_then(|stem| stem.to_str())
        .unwrap_or("edited-video");
    let sequence = JOB_COUNTER.fetch_add(1, Ordering::Relaxed);
    Ok(parent.join(format!(
        ".{filename}-{job_id}-{}-{sequence}.partial.webm",
        std::process::id()
    )))
}

fn replace_output_file(partial: &Path, output: &Path) -> Result<(), String> {
    if output.exists() {
        fs::remove_file(output).map_err(|error| format!("无法替换已有输出视频：{error}"))?;
    }
    fs::rename(partial, output).map_err(|error| format!("无法保存编辑后的视频：{error}"))
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

struct PartialOutputGuard {
    path: PathBuf,
    committed: bool,
}

impl PartialOutputGuard {
    fn new(path: PathBuf) -> Self {
        Self {
            path,
            committed: false,
        }
    }

    fn commit(&mut self) {
        self.committed = true;
    }
}

impl Drop for PartialOutputGuard {
    fn drop(&mut self) {
        if !self.committed {
            let _ = fs::remove_file(&self.path);
        }
    }
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
    fn rejects_an_output_symlink_that_points_back_to_the_input() {
        use std::os::unix::fs::symlink;

        let input = temp_video("webm");
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

        assert_eq!(error, "输入视频和输出视频不能是同一个文件");
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
    fn macos_and_windows_have_explicit_runtime_candidates() {
        let manifest = Path::new("/workspace/app/src-tauri");
        let mac = platform_candidates(ExecutableKind::Ffmpeg, RuntimePlatform::Macos, manifest);
        let windows =
            platform_candidates(ExecutableKind::Ffmpeg, RuntimePlatform::Windows, manifest);
        let mac_worker = platform_candidates(
            ExecutableKind::BackgroundRemover,
            RuntimePlatform::Macos,
            manifest,
        );
        let windows_worker = platform_candidates(
            ExecutableKind::BackgroundRemover,
            RuntimePlatform::Windows,
            manifest,
        );

        assert!(mac.contains(&PathBuf::from("/usr/local/bin/ffmpeg")));
        assert!(windows.contains(&PathBuf::from(r"C:\ffmpeg\bin\ffmpeg.exe")));
        assert!(mac_worker
            .iter()
            .any(|path| path.ends_with(".venv/bin/backgroundremover")));
        assert!(windows_worker
            .iter()
            .any(|path| path.ends_with(r".venv\Scripts\backgroundremover.exe")));
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
}
