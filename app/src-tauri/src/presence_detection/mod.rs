use serde::{Deserialize, Serialize};
use std::ffi::OsStr;
#[cfg(test)]
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

const SAMPLE_HELPER_ARG: &str = "--camera-presence-sample-helper";
const STREAM_HELPER_ARG: &str = "--camera-presence-stream-helper";
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

fn requested_stream_helper_interval() -> Option<Result<Duration, NativeError>> {
    let mut args = std::env::args_os();
    while let Some(arg) = args.next() {
        if arg == OsStr::new(STREAM_HELPER_ARG) {
            return Some(args.next().map_or_else(
                || {
                    Err(NativeError::new(
                        NativeErrorKind::Error,
                        "camera-sample-interval-missing",
                    ))
                },
                |value| parse_stream_interval(&value),
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
) -> Result<(), NativeError> {
    let executable = std::env::current_exe().map_err(|_| {
        NativeError::new(NativeErrorKind::Error, "camera-helper-executable-not-found")
    })?;
    let mut child = Command::new(executable)
        .arg(STREAM_HELPER_ARG)
        .arg(frame_interval.as_secs().to_string())
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
    state.child = Some(child);
    std::thread::spawn(move || read_stream_output(stdout, generation));
    Ok(())
}

fn sample_from_stream_with_timeout(frame_interval: Duration) -> Result<bool, NativeError> {
    let deadline = Instant::now() + SAMPLE_TIMEOUT;
    let (mutex, ready) = stream_runtime();
    let mut state = mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if state
        .frame_interval
        .is_some_and(|current| current != frame_interval)
    {
        stop_stream_locked(&mut state);
    }
    let has_undelivered = state
        .latest
        .as_ref()
        .is_some_and(|(sequence, _)| *sequence > state.delivered_sequence);
    if !state.running && !has_undelivered {
        stop_stream_locked(&mut state);
        start_stream_locked(&mut state, frame_interval)?;
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

pub(crate) fn run_sample_helper_if_requested() -> bool {
    if let Some(frame_interval) = requested_stream_helper_interval() {
        let mut stdout = std::io::stdout().lock();
        let mut emitted = false;
        let result = frame_interval.and_then(|frame_interval| {
            platform_impl::stream_samples(frame_interval, |sample| {
                emitted = true;
                write_stream_result(&mut stdout, &sample)
            })
        });
        if let Err(error) = result {
            if !emitted {
                let _ = write_stream_result(&mut stdout, &Err(error));
            }
        }
        return true;
    }
    if !std::env::args_os().any(|arg| arg == OsStr::new(SAMPLE_HELPER_ARG)) {
        return false;
    }

    let result = platform_impl::sample();
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
pub async fn camera_presence_status() -> Result<PresenceCapability, String> {
    let availability = tauri::async_runtime::spawn_blocking(platform_impl::status)
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
) -> Result<PresenceCapability, String> {
    let app_for_prompt = app.clone();
    let availability = tauri::async_runtime::spawn_blocking(move || {
        #[cfg(target_os = "macos")]
        let window_snapshot =
            crate::accessibility::lower_permission_windows_for_camera_prompt(&app_for_prompt)?;
        let result = platform_impl::request_access();
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
pub async fn sample_camera_presence(interval_seconds: u64) -> Result<PresenceSample, String> {
    let frame_interval = match validated_stream_interval(interval_seconds) {
        Ok(interval) => interval,
        Err(error) => return Ok(error_sample(error)),
    };
    let result = tauri::async_runtime::spawn_blocking(move || {
        sample_from_stream_with_timeout(frame_interval)
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
