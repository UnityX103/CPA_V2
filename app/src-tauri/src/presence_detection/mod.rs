use serde::{Deserialize, Serialize};
use std::ffi::OsStr;
use std::io::{Read, Write};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

#[cfg(target_os = "macos")]
mod macos;
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
mod stub;
#[cfg(target_os = "windows")]
mod windows;

static SAMPLE_IN_FLIGHT: AtomicBool = AtomicBool::new(false);
static STOP_REQUESTED: AtomicBool = AtomicBool::new(false);

const SAMPLE_HELPER_ARG: &str = "--camera-presence-sample-helper";
const SAMPLE_TIMEOUT: Duration = Duration::from_secs(10);
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

struct SampleGuard;

impl SampleGuard {
    fn acquire() -> Option<Self> {
        SAMPLE_IN_FLIGHT
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .ok()
            .map(|_| Self)
    }
}

impl Drop for SampleGuard {
    fn drop(&mut self) {
        SAMPLE_IN_FLIGHT.store(false, Ordering::Release);
    }
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

fn terminate_child(child: &mut Child) {
    let _ = child.kill();
    let _ = child.wait();
}

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

fn sample_with_timeout() -> Result<bool, NativeError> {
    let executable = std::env::current_exe().map_err(|_| {
        NativeError::new(NativeErrorKind::Error, "camera-helper-executable-not-found")
    })?;
    let child = Command::new(executable)
        .arg(SAMPLE_HELPER_ARG)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|_| NativeError::new(NativeErrorKind::Error, "camera-helper-spawn-failed"))?;

    wait_for_sample_child(child, SAMPLE_TIMEOUT, || {
        STOP_REQUESTED.load(Ordering::Acquire)
    })
}

pub(crate) fn run_sample_helper_if_requested() -> bool {
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
}

pub(crate) fn stop_for_exit() {
    STOP_REQUESTED.store(true, Ordering::Release);
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
        let window_snapshot = crate::accessibility::yield_permission_windows(&app_for_prompt)?;
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
pub async fn sample_camera_presence() -> Result<PresenceSample, String> {
    let Some(guard) = SampleGuard::acquire() else {
        return Ok(error_sample(NativeError::new(
            NativeErrorKind::Busy,
            "sample-in-flight",
        )));
    };

    let result = tauri::async_runtime::spawn_blocking(sample_with_timeout)
        .await
        .map_err(|error| format!("camera sample task failed: {error}"));
    drop(guard);

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
    fn sample_guard_is_single_flight_and_releases_on_drop() {
        SAMPLE_IN_FLIGHT.store(false, Ordering::Release);
        let first = SampleGuard::acquire().expect("first sample should acquire the guard");
        assert!(SampleGuard::acquire().is_none());
        drop(first);
        assert!(SampleGuard::acquire().is_some());
    }

    #[test]
    fn helper_payload_round_trips_success_and_structured_errors() {
        assert_eq!(parse_helper_output(r#"{"Ok":true}"#), Ok(true));
        let error = NativeError::new(NativeErrorKind::Busy, "camera-busy");
        let payload = serde_json::to_string(&Result::<bool, NativeError>::Err(error.clone()))
            .expect("serialize helper error");
        assert_eq!(parse_helper_output(&payload), Err(error));
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
