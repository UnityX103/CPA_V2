use base64::Engine;
use image::{imageops, RgbImage};
use serde::{Deserialize, Serialize};
use std::ffi::{OsStr, OsString};
use std::io::Read;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdout, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Condvar, Mutex, OnceLock};
use std::time::{Duration, Instant};

#[cfg(target_os = "macos")]
mod macos;
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
mod stub;
#[cfg(target_os = "windows")]
mod windows;

static STOP_REQUESTED: AtomicBool = AtomicBool::new(false);
static CALIBRATING: AtomicBool = AtomicBool::new(false);

struct CalibrationGuard;

impl Drop for CalibrationGuard {
    fn drop(&mut self) {
        CALIBRATING.store(false, Ordering::Release);
    }
}

const SAMPLE_HELPER_ARG: &str = "--camera-presence-sample-helper";
const STREAM_HELPER_ARG: &str = "--camera-presence-stream-helper";
const CAMERA_DEVICE_ID_ARG: &str = "--camera-device-id";
const WORKSTATION_REGION_ARG: &str = "--workstation-region";
const CALIBRATION_HELPER_ARG: &str = "--camera-calibration-helper";
const SAMPLE_TIMEOUT: Duration = Duration::from_secs(10);
const MIN_STREAM_INTERVAL_SECONDS: u64 = 5;
const MAX_STREAM_INTERVAL_SECONDS: u64 = 600;
#[cfg(test)]
const SAMPLE_POLL_INTERVAL: Duration = Duration::from_millis(25);

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub enum PresencePlatform {
    Macos,
    Windows,
    Other,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum PresenceAvailability {
    PermissionRequired,
    Ready,
    PermissionDenied,
    NoDevice,
    Busy,
    Error,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum PresenceObservation {
    Present,
    Absent,
    Unknown,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PresenceCapability {
    pub platform: PresencePlatform,
    pub availability: PresenceAvailability,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PresenceSample {
    pub observation: PresenceObservation,
    pub availability: PresenceAvailability,
    pub error_code: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CameraDevice {
    pub id: String,
    pub name: String,
    pub is_default: bool,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkstationRegion {
    x: f32,
    y: f32,
    width: f32,
    height: f32,
}

impl WorkstationRegion {
    fn valid(self) -> bool {
        [self.x, self.y, self.width, self.height]
            .iter()
            .all(|value| value.is_finite())
            && self.x >= 0.0
            && self.y >= 0.0
            && self.width >= 0.1
            && self.height >= 0.1
            && self.x + self.width <= 1.000001
            && self.y + self.height <= 1.000001
    }
}

fn crop_to_workstation(image: RgbImage, region: Option<WorkstationRegion>) -> RgbImage {
    let Some(region) = region else { return image };
    let (width, height) = image.dimensions();
    if width == 0 || height == 0 {
        return image;
    }
    let x = (region.x * width as f32).floor() as u32;
    let y = (region.y * height as f32).floor() as u32;
    let right = ((region.x + region.width) * width as f32).ceil() as u32;
    let bottom = ((region.y + region.height) * height as f32).ceil() as u32;
    imageops::crop_imm(
        &image,
        x.min(width - 1),
        y.min(height - 1),
        right.min(width).saturating_sub(x).max(1),
        bottom.min(height).saturating_sub(y).max(1),
    )
    .to_image()
}

fn nearby_face(width_ratio: f32, height_ratio: f32) -> bool {
    width_ratio >= 0.12 && height_ratio >= 0.12
}

fn encode_calibration_frame(image: RgbImage) -> Result<String, NativeError> {
    let (width, height) = image.dimensions();
    let longest = width.max(height);
    let resized = if longest > 640 {
        imageops::resize(
            &image,
            (width as u64 * 640 / longest as u64).max(1) as u32,
            (height as u64 * 640 / longest as u64).max(1) as u32,
            imageops::FilterType::Triangle,
        )
    } else {
        image
    };
    let mut jpeg = Vec::new();
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut jpeg, 75)
        .encode_image(&resized)
        .map_err(|_| NativeError::new(NativeErrorKind::Error, "camera-preview-encode-failed"))?;
    Ok(format!(
        "data:image/jpeg;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(jpeg)
    ))
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
pub(super) enum NativeErrorKind {
    PermissionDenied,
    NoDevice,
    Busy,
    Error,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
pub(super) struct NativeError {
    pub kind: NativeErrorKind,
    pub code: String,
}

impl NativeError {
    pub(super) fn new(kind: NativeErrorKind, code: impl Into<String>) -> Self {
        Self {
            kind,
            code: code.into(),
        }
    }
}

#[derive(Default)]
struct StreamState {
    child: Option<Child>,
    generation: u64,
    sequence: u64,
    delivered_sequence: u64,
    latest: Option<(u64, Result<bool, NativeError>)>,
    running: bool,
    frame_interval: Option<Duration>,
    camera_device_id: Option<String>,
    workstation_region: Option<WorkstationRegion>,
}

#[derive(Clone, Debug, PartialEq)]
struct StreamHelperRequest {
    frame_interval: Duration,
    camera_device_id: Option<String>,
    workstation_region: Option<WorkstationRegion>,
}

fn platform() -> PresencePlatform {
    #[cfg(target_os = "macos")]
    return PresencePlatform::Macos;
    #[cfg(target_os = "windows")]
    return PresencePlatform::Windows;
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    return PresencePlatform::Other;
}

fn error_sample(error: NativeError) -> PresenceSample {
    let availability = match error.kind {
        NativeErrorKind::PermissionDenied => PresenceAvailability::PermissionDenied,
        NativeErrorKind::NoDevice => PresenceAvailability::NoDevice,
        NativeErrorKind::Busy => PresenceAvailability::Busy,
        NativeErrorKind::Error => PresenceAvailability::Error,
    };
    PresenceSample {
        observation: PresenceObservation::Unknown,
        availability,
        error_code: Some(error.code),
    }
}

fn parse_helper_output(output: &str) -> Result<bool, NativeError> {
    serde_json::from_str::<Result<bool, NativeError>>(output.trim())
        .map_err(|_| NativeError::new(NativeErrorKind::Error, "camera-helper-invalid-response"))?
}

fn validated_stream_interval(seconds: u64) -> Result<Duration, NativeError> {
    if !(MIN_STREAM_INTERVAL_SECONDS..=MAX_STREAM_INTERVAL_SECONDS).contains(&seconds) {
        return Err(NativeError::new(
            NativeErrorKind::Error,
            "camera-sample-interval-invalid",
        ));
    }
    Ok(Duration::from_secs(seconds))
}

fn parse_stream_interval(value: &OsStr) -> Result<Duration, NativeError> {
    let seconds = value
        .to_str()
        .and_then(|raw| raw.parse::<u64>().ok())
        .ok_or_else(|| {
            NativeError::new(NativeErrorKind::Error, "camera-sample-interval-invalid")
        })?;
    validated_stream_interval(seconds)
}

fn requested_camera_device_id(args: &[OsString]) -> Result<Option<String>, NativeError> {
    let Some(index) = args
        .iter()
        .position(|arg| arg == OsStr::new(CAMERA_DEVICE_ID_ARG))
    else {
        return Ok(None);
    };
    let value = args
        .get(index + 1)
        .ok_or_else(|| NativeError::new(NativeErrorKind::Error, "camera-device-id-missing"))?;
    let value = value
        .to_str()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    value
        .map(|value| Some(value.to_string()))
        .ok_or_else(|| NativeError::new(NativeErrorKind::Error, "camera-device-id-invalid"))
}

fn requested_region(args: &[OsString]) -> Result<Option<WorkstationRegion>, NativeError> {
    let Some(index) = args
        .iter()
        .position(|arg| arg == OsStr::new(WORKSTATION_REGION_ARG))
    else {
        return Ok(None);
    };
    let raw = args
        .get(index + 1)
        .and_then(|arg| arg.to_str())
        .ok_or_else(|| NativeError::new(NativeErrorKind::Error, "camera-region-invalid"))?;
    let region: WorkstationRegion = serde_json::from_str(raw)
        .map_err(|_| NativeError::new(NativeErrorKind::Error, "camera-region-invalid"))?;
    if !region.valid() {
        return Err(NativeError::new(
            NativeErrorKind::Error,
            "camera-region-invalid",
        ));
    }
    Ok(Some(region))
}

fn requested_stream_helper(args: &[OsString]) -> Option<Result<StreamHelperRequest, NativeError>> {
    for (index, arg) in args.iter().enumerate() {
        if arg == OsStr::new(STREAM_HELPER_ARG) {
            return Some(args.get(index + 1).map_or_else(
                || {
                    Err(NativeError::new(
                        NativeErrorKind::Error,
                        "camera-sample-interval-missing",
                    ))
                },
                |value| {
                    Ok(StreamHelperRequest {
                        frame_interval: parse_stream_interval(value)?,
                        camera_device_id: requested_camera_device_id(args)?,
                        workstation_region: requested_region(args)?,
                    })
                },
            ));
        }
    }
    None
}

fn stream_runtime() -> &'static (Mutex<StreamState>, Condvar) {
    static RUNTIME: OnceLock<(Mutex<StreamState>, Condvar)> = OnceLock::new();
    RUNTIME.get_or_init(|| (Mutex::new(StreamState::default()), Condvar::new()))
}

fn terminate_child(child: &mut Child) {
    let _ = child.kill();
    let _ = child.wait();
}

#[cfg(test)]
fn wait_for_sample_child(
    mut child: Child,
    timeout: Duration,
    should_stop: impl Fn() -> bool,
) -> Result<bool, NativeError> {
    let deadline = Instant::now() + timeout;
    loop {
        if should_stop() {
            terminate_child(&mut child);
            return Err(NativeError::new(
                NativeErrorKind::Error,
                "camera-sample-cancelled",
            ));
        }
        if Instant::now() >= deadline {
            terminate_child(&mut child);
            return Err(NativeError::new(
                NativeErrorKind::Error,
                "camera-sample-timeout",
            ));
        }

        match child.try_wait() {
            Ok(Some(status)) => {
                let mut output = String::new();
                if let Some(mut stdout) = child.stdout.take() {
                    stdout.read_to_string(&mut output).map_err(|_| {
                        NativeError::new(NativeErrorKind::Error, "camera-helper-output-read-failed")
                    })?;
                }
                if !status.success() {
                    return Err(NativeError::new(
                        NativeErrorKind::Error,
                        "camera-helper-exited",
                    ));
                }
                return parse_helper_output(&output);
            }
            Ok(None) => std::thread::sleep(SAMPLE_POLL_INTERVAL),
            Err(_) => {
                terminate_child(&mut child);
                return Err(NativeError::new(
                    NativeErrorKind::Error,
                    "camera-helper-wait-failed",
                ));
            }
        }
    }
}

fn stop_stream_locked(state: &mut StreamState) {
    state.generation = state.generation.wrapping_add(1);
    if let Some(mut child) = state.child.take() {
        terminate_child(&mut child);
    }
    state.sequence = 0;
    state.delivered_sequence = 0;
    state.latest = None;
    state.running = false;
    state.frame_interval = None;
    state.camera_device_id = None;
    state.workstation_region = None;
}

fn stop_stream_process() {
    let (mutex, ready) = stream_runtime();
    let mut state = mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    stop_stream_locked(&mut state);
    ready.notify_all();
}

fn publish_stream_result(generation: u64, result: Result<bool, NativeError>) {
    let (mutex, ready) = stream_runtime();
    let mut state = mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if state.generation != generation {
        return;
    }
    state.sequence = state.sequence.wrapping_add(1);
    let sequence = state.sequence;
    state.latest = Some((sequence, result));
    ready.notify_all();
}

fn finish_stream_reader(generation: u64, error: Option<NativeError>) {
    let (mutex, ready) = stream_runtime();
    let mut state = mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if state.generation != generation {
        return;
    }
    state.running = false;
    let has_undelivered = state
        .latest
        .as_ref()
        .is_some_and(|(sequence, _)| *sequence > state.delivered_sequence);
    if !has_undelivered {
        state.sequence = state.sequence.wrapping_add(1);
        let sequence = state.sequence;
        state.latest = Some((
            sequence,
            Err(error.unwrap_or_else(|| {
                NativeError::new(NativeErrorKind::Error, "camera-stream-helper-exited")
            })),
        ));
    }
    ready.notify_all();
}

fn read_stream_output(stdout: ChildStdout, generation: u64) {
    let mut reader = BufReader::new(stdout);
    loop {
        let mut line = String::new();
        match reader.read_line(&mut line) {
            Ok(0) => {
                finish_stream_reader(generation, None);
                return;
            }
            Ok(_) => publish_stream_result(generation, parse_helper_output(&line)),
            Err(_) => {
                finish_stream_reader(
                    generation,
                    Some(NativeError::new(
                        NativeErrorKind::Error,
                        "camera-stream-output-read-failed",
                    )),
                );
                return;
            }
        }
    }
}

fn start_stream_locked(
    state: &mut StreamState,
    frame_interval: Duration,
    camera_device_id: Option<&str>,
    region: Option<WorkstationRegion>,
) -> Result<(), NativeError> {
    let executable = std::env::current_exe().map_err(|_| {
        NativeError::new(NativeErrorKind::Error, "camera-helper-executable-not-found")
    })?;
    let mut command = Command::new(executable);
    command
        .arg(STREAM_HELPER_ARG)
        .arg(frame_interval.as_secs().to_string());
    if let Some(camera_device_id) = camera_device_id {
        command.arg(CAMERA_DEVICE_ID_ARG).arg(camera_device_id);
    }
    if let Some(region) = region {
        command.arg(WORKSTATION_REGION_ARG).arg(
            serde_json::to_string(&region)
                .map_err(|_| NativeError::new(NativeErrorKind::Error, "camera-region-invalid"))?,
        );
    }
    let mut child = command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|_| NativeError::new(NativeErrorKind::Error, "camera-stream-spawn-failed"))?;
    let Some(stdout) = child.stdout.take() else {
        terminate_child(&mut child);
        return Err(NativeError::new(
            NativeErrorKind::Error,
            "camera-stream-output-unavailable",
        ));
    };

    state.generation = state.generation.wrapping_add(1);
    let generation = state.generation;
    state.sequence = 0;
    state.delivered_sequence = 0;
    state.latest = None;
    state.running = true;
    state.frame_interval = Some(frame_interval);
    state.camera_device_id = camera_device_id.map(str::to_string);
    state.workstation_region = region;
    state.child = Some(child);
    std::thread::spawn(move || read_stream_output(stdout, generation));
    Ok(())
}

fn sample_from_stream_with_timeout(
    frame_interval: Duration,
    camera_device_id: Option<String>,
    region: Option<WorkstationRegion>,
) -> Result<bool, NativeError> {
    let deadline = Instant::now() + SAMPLE_TIMEOUT;
    let (mutex, ready) = stream_runtime();
    let mut state = mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if CALIBRATING.load(Ordering::Acquire) {
        return Err(NativeError::new(
            NativeErrorKind::Busy,
            "camera-calibrating",
        ));
    }
    if state
        .frame_interval
        .is_some_and(|current| current != frame_interval)
        || state.camera_device_id != camera_device_id
        || state.workstation_region != region
    {
        stop_stream_locked(&mut state);
    }
    let has_undelivered = state
        .latest
        .as_ref()
        .is_some_and(|(sequence, _)| *sequence > state.delivered_sequence);
    if !state.running && !has_undelivered {
        stop_stream_locked(&mut state);
        start_stream_locked(
            &mut state,
            frame_interval,
            camera_device_id.as_deref(),
            region,
        )?;
    }
    let generation = state.generation;
    let after_sequence = state.delivered_sequence;

    loop {
        if STOP_REQUESTED.load(Ordering::Acquire) {
            stop_stream_locked(&mut state);
            return Err(NativeError::new(
                NativeErrorKind::Error,
                "camera-sample-cancelled",
            ));
        }
        if state.generation != generation {
            return Err(NativeError::new(
                NativeErrorKind::Error,
                "camera-sample-cancelled",
            ));
        }
        if let Some((sequence, result)) = state.latest.as_ref() {
            if *sequence > after_sequence {
                let sequence = *sequence;
                let result = result.clone();
                state.delivered_sequence = state.delivered_sequence.max(sequence);
                return result;
            }
        }

        let now = Instant::now();
        if now >= deadline {
            stop_stream_locked(&mut state);
            return Err(NativeError::new(
                NativeErrorKind::Error,
                "camera-sample-timeout",
            ));
        }
        let remaining = deadline.saturating_duration_since(now);
        let (next_state, timeout) = ready
            .wait_timeout(state, remaining)
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        state = next_state;
        if timeout.timed_out() {
            stop_stream_locked(&mut state);
            return Err(NativeError::new(
                NativeErrorKind::Error,
                "camera-sample-timeout",
            ));
        }
    }
}

fn write_stream_result(stdout: &mut impl Write, result: &Result<bool, NativeError>) -> bool {
    serde_json::to_writer(&mut *stdout, result).is_ok()
        && stdout.write_all(b"\n").is_ok()
        && stdout.flush().is_ok()
}

fn run_releasing_sample_loop(
    frame_interval: Duration,
    mut sample: impl FnMut() -> Result<bool, NativeError>,
    mut emit: impl FnMut(Result<bool, NativeError>) -> bool,
    mut wait: impl FnMut(Duration),
) -> Result<(), NativeError> {
    loop {
        let result = sample();
        let sample_succeeded = result.is_ok();
        if !emit(result) || !sample_succeeded {
            return Ok(());
        }
        wait(frame_interval);
    }
}

pub(crate) fn run_sample_helper_if_requested() -> bool {
    let args = std::env::args_os().collect::<Vec<_>>();
    if args
        .iter()
        .any(|arg| arg == OsStr::new(CALIBRATION_HELPER_ARG))
    {
        let result = requested_camera_device_id(&args)
            .and_then(|id| platform_impl::calibration_frame(id.as_deref()));
        let mut stdout = std::io::stdout().lock();
        let _ = serde_json::to_writer(&mut stdout, &result);
        let _ = stdout.flush();
        return true;
    }
    if let Some(request) = requested_stream_helper(&args) {
        let mut stdout = std::io::stdout().lock();
        let mut emitted = false;
        let result = request.and_then(|request| {
            platform_impl::stream_samples(
                request.frame_interval,
                request.camera_device_id.as_deref(),
                request.workstation_region,
                |sample| {
                    emitted = true;
                    write_stream_result(&mut stdout, &sample)
                },
            )
        });
        if let Err(error) = result {
            if !emitted {
                let _ = write_stream_result(&mut stdout, &Err(error));
            }
        }
        return true;
    }
    if !args.iter().any(|arg| arg == OsStr::new(SAMPLE_HELPER_ARG)) {
        return false;
    }

    let result = requested_camera_device_id(&args).and_then(|camera_device_id| {
        requested_region(&args)
            .and_then(|region| platform_impl::sample(camera_device_id.as_deref(), region))
    });
    let mut stdout = std::io::stdout().lock();
    let _ = serde_json::to_writer(&mut stdout, &result);
    let _ = stdout.flush();
    true
}

pub(crate) fn prepare_for_run() {
    STOP_REQUESTED.store(false, Ordering::Release);
    stop_stream_process();
}

pub(crate) fn stop_for_exit() {
    STOP_REQUESTED.store(true, Ordering::Release);
    stop_stream_process();
}

#[tauri::command]
pub async fn list_camera_devices() -> Result<Vec<CameraDevice>, String> {
    tauri::async_runtime::spawn_blocking(platform_impl::list_devices)
        .await
        .map_err(|error| format!("camera device list task failed: {error}"))?
        .map_err(|error| error.code)
}

#[tauri::command]
pub async fn camera_presence_status(
    camera_device_id: Option<String>,
) -> Result<PresenceCapability, String> {
    let availability = tauri::async_runtime::spawn_blocking(move || {
        platform_impl::status(camera_device_id.as_deref())
    })
    .await
    .map_err(|error| format!("camera status task failed: {error}"))?;
    Ok(PresenceCapability {
        platform: platform(),
        availability,
    })
}

#[tauri::command]
pub async fn request_camera_presence_access(
    app: tauri::AppHandle,
    camera_device_id: Option<String>,
) -> Result<PresenceCapability, String> {
    let app_for_prompt = app.clone();
    let availability = tauri::async_runtime::spawn_blocking(move || {
        #[cfg(target_os = "macos")]
        let window_snapshot =
            crate::accessibility::lower_permission_windows_for_camera_prompt(&app_for_prompt)?;
        let result = platform_impl::request_access(camera_device_id.as_deref());
        #[cfg(target_os = "macos")]
        crate::accessibility::restore_permission_windows(&app_for_prompt, window_snapshot)?;
        #[cfg(not(target_os = "macos"))]
        let _ = app_for_prompt;
        Ok::<PresenceAvailability, String>(result)
    })
    .await
    .map_err(|error| format!("camera permission task failed: {error}"))??;

    Ok(PresenceCapability {
        platform: platform(),
        availability,
    })
}

#[tauri::command]
pub fn open_camera_privacy_settings() -> Result<(), String> {
    platform_impl::open_privacy_settings()
}

#[tauri::command]
pub fn stop_camera_presence_stream() {
    stop_stream_process();
}

#[tauri::command]
pub async fn sample_camera_presence(
    interval_seconds: u64,
    camera_device_id: Option<String>,
    workstation_region: Option<WorkstationRegion>,
) -> Result<PresenceSample, String> {
    let frame_interval = match validated_stream_interval(interval_seconds) {
        Ok(interval) => interval,
        Err(error) => return Ok(error_sample(error)),
    };
    if workstation_region.is_some_and(|region| !region.valid()) {
        return Ok(error_sample(NativeError::new(
            NativeErrorKind::Error,
            "camera-region-invalid",
        )));
    }
    let result = tauri::async_runtime::spawn_blocking(move || {
        sample_from_stream_with_timeout(frame_interval, camera_device_id, workstation_region)
    })
    .await
    .map_err(|error| format!("camera sample task failed: {error}"));

    match result? {
        Ok(present) => Ok(PresenceSample {
            observation: if present {
                PresenceObservation::Present
            } else {
                PresenceObservation::Absent
            },
            availability: PresenceAvailability::Ready,
            error_code: None,
        }),
        Err(error) => Ok(error_sample(error)),
    }
}

fn capture_calibration_frame_with_timeout(
    camera_device_id: Option<&str>,
) -> Result<String, NativeError> {
    let executable = std::env::current_exe().map_err(|_| {
        NativeError::new(NativeErrorKind::Error, "camera-helper-executable-not-found")
    })?;
    let mut command = Command::new(executable);
    command.arg(CALIBRATION_HELPER_ARG);
    if let Some(id) = camera_device_id {
        command.arg(CAMERA_DEVICE_ID_ARG).arg(id);
    }
    let mut child = command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|_| NativeError::new(NativeErrorKind::Error, "camera-preview-spawn-failed"))?;
    let stdout = child.stdout.take().ok_or_else(|| {
        NativeError::new(NativeErrorKind::Error, "camera-preview-output-unavailable")
    })?;
    let reader = std::thread::spawn(move || {
        let mut output = Vec::new();
        BufReader::new(stdout)
            .take(2_000_000)
            .read_to_end(&mut output)
            .map(|_| output)
    });
    let deadline = Instant::now() + SAMPLE_TIMEOUT;
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                let output = reader
                    .join()
                    .map_err(|_| {
                        NativeError::new(NativeErrorKind::Error, "camera-preview-read-failed")
                    })?
                    .map_err(|_| {
                        NativeError::new(NativeErrorKind::Error, "camera-preview-read-failed")
                    })?;
                if !status.success() {
                    return Err(NativeError::new(
                        NativeErrorKind::Error,
                        "camera-preview-helper-exited",
                    ));
                }
                return serde_json::from_slice::<Result<String, NativeError>>(&output).map_err(
                    |_| NativeError::new(NativeErrorKind::Error, "camera-preview-invalid-response"),
                )?;
            }
            Ok(None) if Instant::now() < deadline && !STOP_REQUESTED.load(Ordering::Acquire) => {
                std::thread::sleep(Duration::from_millis(25));
            }
            _ => {
                terminate_child(&mut child);
                let _ = reader.join();
                return Err(NativeError::new(
                    NativeErrorKind::Error,
                    "camera-preview-timeout",
                ));
            }
        }
    }
}

#[tauri::command]
pub async fn capture_camera_calibration_frame(
    camera_device_id: Option<String>,
) -> Result<String, String> {
    if CALIBRATING.swap(true, Ordering::AcqRel) {
        return Err("camera-preview-busy".to_string());
    }
    stop_stream_process();
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = CalibrationGuard;
        capture_calibration_frame_with_timeout(camera_device_id.as_deref())
    })
    .await
    .map_err(|error| format!("camera preview task failed: {error}"))?
    .map_err(|error| error.code)
}

#[cfg(target_os = "macos")]
use macos as platform_impl;
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
use stub as platform_impl;
#[cfg(target_os = "windows")]
use windows as platform_impl;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn expected_native_errors_map_to_unknown_samples() {
        let cases = [
            (
                NativeErrorKind::PermissionDenied,
                PresenceAvailability::PermissionDenied,
            ),
            (NativeErrorKind::NoDevice, PresenceAvailability::NoDevice),
            (NativeErrorKind::Busy, PresenceAvailability::Busy),
            (NativeErrorKind::Error, PresenceAvailability::Error),
        ];
        for (kind, availability) in cases {
            assert_eq!(
                error_sample(NativeError::new(kind, "test-code")),
                PresenceSample {
                    observation: PresenceObservation::Unknown,
                    availability,
                    error_code: Some("test-code".to_string()),
                }
            );
        }
    }

    #[test]
    fn helper_payload_round_trips_success_and_structured_errors() {
        assert_eq!(parse_helper_output(r#"{"Ok":true}"#), Ok(true));
        let error = NativeError::new(NativeErrorKind::Busy, "camera-busy");
        let payload = serde_json::to_string(&Result::<bool, NativeError>::Err(error.clone()))
            .expect("serialize helper error");
        assert_eq!(parse_helper_output(&payload), Err(error));
    }

    #[test]
    fn stream_interval_uses_configured_seconds_and_rejects_out_of_range_values() {
        assert_eq!(
            parse_stream_interval(OsStr::new("5")),
            Ok(Duration::from_secs(5))
        );
        assert_eq!(
            parse_stream_interval(OsStr::new("4"))
                .expect_err("interval below the settings minimum should be rejected")
                .code,
            "camera-sample-interval-invalid"
        );
        assert_eq!(
            parse_stream_interval(OsStr::new("601"))
                .expect_err("interval above the settings maximum should be rejected")
                .code,
            "camera-sample-interval-invalid"
        );
    }

    #[test]
    fn stream_helper_preserves_the_selected_camera_id() {
        let args = vec![
            OsString::from("cpa"),
            OsString::from(STREAM_HELPER_ARG),
            OsString::from("30"),
            OsString::from(CAMERA_DEVICE_ID_ARG),
            OsString::from("camera-usb"),
        ];

        assert_eq!(
            requested_stream_helper(&args),
            Some(Ok(StreamHelperRequest {
                frame_interval: Duration::from_secs(30),
                camera_device_id: Some("camera-usb".to_string()),
                workstation_region: None,
            }))
        );
    }

    #[test]
    fn region_filters_to_the_selected_seat_and_rejects_invalid_coordinates() {
        let region = WorkstationRegion {
            x: 0.25,
            y: 0.1,
            width: 0.5,
            height: 0.8,
        };
        assert!(region.valid());
        let image = RgbImage::new(100, 80);
        assert_eq!(
            crop_to_workstation(image, Some(region)).dimensions(),
            (50, 64)
        );
        assert!(!WorkstationRegion { x: 0.8, ..region }.valid());
        assert!(!WorkstationRegion {
            width: f32::NAN,
            ..region
        }
        .valid());
        assert!(!nearby_face(0.08, 0.2));
        assert!(nearby_face(0.18, 0.2));
        let args = vec![
            OsString::from(WORKSTATION_REGION_ARG),
            OsString::from(r#"{"x":0.25,"y":0.1,"width":0.5,"height":0.8}"#),
        ];
        assert_eq!(requested_region(&args), Ok(Some(region)));
    }

    #[test]
    fn calibration_image_is_scaled_and_kept_in_memory() {
        let image = RgbImage::new(1280, 720);
        let frame = encode_calibration_frame(image).expect("jpeg");
        let encoded = frame
            .strip_prefix("data:image/jpeg;base64,")
            .expect("image data");
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(encoded)
            .expect("base64");
        let decoded = image::load_from_memory(&bytes).expect("jpeg image");
        assert_eq!((decoded.width(), decoded.height()), (640, 360));
        let portrait = encode_calibration_frame(RgbImage::new(720, 1280)).expect("jpeg");
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(portrait.strip_prefix("data:image/jpeg;base64,").unwrap())
            .expect("base64");
        let decoded = image::load_from_memory(&bytes).expect("jpeg image");
        assert_eq!((decoded.width(), decoded.height()), (360, 640));
    }

    #[test]
    fn stream_helper_defaults_to_the_system_camera_without_an_id() {
        let args = vec![
            OsString::from("cpa"),
            OsString::from(STREAM_HELPER_ARG),
            OsString::from("10"),
        ];

        assert_eq!(
            requested_stream_helper(&args),
            Some(Ok(StreamHelperRequest {
                frame_interval: Duration::from_secs(10),
                camera_device_id: None,
                workstation_region: None,
            }))
        );
    }

    #[test]
    fn stream_loop_runs_a_fresh_releasing_sample_after_each_interval() {
        use std::cell::{Cell, RefCell};

        let sample_calls = Cell::new(0);
        let waits = RefCell::new(Vec::new());
        let emitted = RefCell::new(Vec::new());

        run_releasing_sample_loop(
            Duration::from_secs(30),
            || {
                let call = sample_calls.get() + 1;
                sample_calls.set(call);
                Ok(call == 1)
            },
            |result| {
                emitted.borrow_mut().push(result);
                emitted.borrow().len() < 2
            },
            |duration| waits.borrow_mut().push(duration),
        )
        .expect("sample loop should stop cleanly when the receiver closes");

        assert_eq!(sample_calls.get(), 2);
        assert_eq!(emitted.into_inner(), vec![Ok(true), Ok(false)]);
        assert_eq!(waits.into_inner(), vec![Duration::from_secs(30)]);
    }

    #[test]
    fn stream_loop_stops_without_waiting_after_a_sample_error() {
        use std::cell::Cell;

        let waits = Cell::new(0);
        let error = NativeError::new(NativeErrorKind::Busy, "camera-busy");
        run_releasing_sample_loop(
            Duration::from_secs(30),
            || Err(error.clone()),
            |result| {
                assert_eq!(result, Err(error.clone()));
                true
            },
            |_| waits.set(waits.get() + 1),
        )
        .expect("expected capture failures are delivered as structured samples");

        assert_eq!(waits.get(), 0);
    }

    #[cfg(unix)]
    #[test]
    fn timed_out_helper_is_terminated_promptly() {
        let child = Command::new("sh")
            .args(["-c", "sleep 5"])
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .expect("spawn timeout fixture");
        let started = Instant::now();

        let error = wait_for_sample_child(child, Duration::from_millis(75), || false)
            .expect_err("helper should time out");

        assert_eq!(error.code, "camera-sample-timeout");
        assert!(started.elapsed() < Duration::from_secs(1));
    }

    #[cfg(unix)]
    #[test]
    fn exit_cancellation_terminates_helper_promptly() {
        let child = Command::new("sh")
            .args(["-c", "sleep 5"])
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .expect("spawn cancellation fixture");
        let started = Instant::now();

        let error = wait_for_sample_child(child, Duration::from_secs(5), || true)
            .expect_err("helper should be cancelled");

        assert_eq!(error.code, "camera-sample-cancelled");
        assert!(started.elapsed() < Duration::from_secs(1));
    }
}
