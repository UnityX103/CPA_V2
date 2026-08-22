use super::{NativeError, NativeErrorKind, PresenceAvailability};
use nokhwa::pixel_format::RgbFormat;
use nokhwa::utils::{ApiBackend, FrameFormat, RequestedFormat, RequestedFormatType};
use nokhwa::Camera;
use std::time::Duration;
use windows::Graphics::Imaging::{BitmapPixelFormat, SoftwareBitmap};
use windows::Media::FaceAnalysis::FaceDetector;
use windows::Security::Cryptography::CryptographicBuffer;
use windows::Win32::System::WinRT::{RoInitialize, RoUninitialize, RO_INIT_SINGLETHREADED};

const RAW_CAMERA_FORMATS: &[FrameFormat] = &[
    FrameFormat::YUYV,
    FrameFormat::NV12,
    FrameFormat::RAWRGB,
    FrameFormat::RAWBGR,
];
struct RoInitializeGuard {
    initialized: bool,
}

impl RoInitializeGuard {
    fn new() -> Self {
        Self {
            // nokhwa's Media Foundation backend initializes COM as STA. WinRT
            // must use the same apartment or device enumeration fails with
            // RPC_E_CHANGED_MODE before the camera permission can be checked.
            initialized: unsafe { RoInitialize(winrt_apartment()) }.is_ok(),
        }
    }
}

fn winrt_apartment() -> windows::Win32::System::WinRT::RO_INIT_TYPE {
    RO_INIT_SINGLETHREADED
}

impl Drop for RoInitializeGuard {
    fn drop(&mut self) {
        if self.initialized {
            unsafe { RoUninitialize() };
        }
    }
}

pub(super) fn status() -> PresenceAvailability {
    match probe_camera_access() {
        Ok(()) => PresenceAvailability::Ready,
        Err(error) => availability_for_error(&error),
    }
}

pub(super) fn request_access() -> PresenceAvailability {
    status()
}

pub(super) fn open_privacy_settings() -> Result<(), String> {
    std::process::Command::new("cmd")
        .args(["/c", "start", "", "ms-settings:privacy-webcam"])
        .spawn()
        .map_err(|error| format!("open camera privacy settings failed: {error}"))?;
    Ok(())
}

pub(super) fn sample() -> Result<bool, NativeError> {
    let _winrt = RoInitializeGuard::new();
    let mut camera = open_camera()?;
    let detector = create_face_detector()?;
    let detection = sample_open_camera(&mut camera, &detector);
    let stop_result = camera
        .stop_stream()
        .map_err(|error| map_camera_error_at(error, "camera-stream-stop-failed"));
    match (detection, stop_result) {
        (Err(error), _) | (Ok(_), Err(error)) => Err(error),
        (Ok(present), Ok(())) => Ok(present),
    }
}

pub(super) fn stream_samples(
    frame_interval: Duration,
    emit: impl FnMut(Result<bool, NativeError>) -> bool,
) -> Result<(), NativeError> {
    super::run_releasing_sample_loop(frame_interval, sample, emit, std::thread::sleep)
}

fn probe_camera_access() -> Result<(), NativeError> {
    let mut camera = open_camera()?;
    camera
        .stop_stream()
        .map_err(|error| map_camera_error_at(error, "camera-stream-stop-failed"))
}

fn open_camera() -> Result<Camera, NativeError> {
    let devices = nokhwa::query(ApiBackend::MediaFoundation)
        .map_err(|error| map_camera_error_at(error, "camera-query-failed"))?;
    let index = devices
        .first()
        .map(|device| device.index().clone())
        .ok_or_else(|| NativeError::new(NativeErrorKind::NoDevice, "camera-not-found"))?;
    let format = RequestedFormat::with_formats(
        RequestedFormatType::AbsoluteHighestFrameRate,
        RAW_CAMERA_FORMATS,
    );
    let mut camera = Camera::with_backend(index, format, ApiBackend::MediaFoundation)
        .map_err(|error| map_camera_error_at(error, "camera-open-failed"))?;
    camera
        .open_stream()
        .map_err(|error| map_camera_error_at(error, "camera-stream-open-failed"))?;
    Ok(camera)
}

fn create_face_detector() -> Result<FaceDetector, NativeError> {
    FaceDetector::CreateAsync()
        .and_then(|operation| operation.get())
        .map_err(|_| NativeError::new(NativeErrorKind::Error, "face-detector-unavailable"))
}

fn sample_open_camera(camera: &mut Camera, detector: &FaceDetector) -> Result<bool, NativeError> {
    let frame = camera
        .frame()
        .map_err(|error| map_camera_error_at(error, "camera-frame-read-failed"))?;
    let decoded = frame
        .decode_image::<RgbFormat>()
        .map_err(|error| map_camera_error_at(error, "camera-frame-decode-failed"))?;
    let (width, height) = decoded.dimensions();
    let rgb = decoded.into_raw();

    let mut bgra = Vec::with_capacity((width * height * 4) as usize);
    for pixel in rgb.chunks_exact(3) {
        bgra.extend_from_slice(&[pixel[2], pixel[1], pixel[0], 255]);
    }
    let buffer = CryptographicBuffer::CreateFromByteArray(&bgra)
        .map_err(|_| NativeError::new(NativeErrorKind::Error, "bitmap-buffer-failed"))?;
    let bitmap = SoftwareBitmap::CreateCopyFromBuffer(
        &buffer,
        BitmapPixelFormat::Bgra8,
        width as i32,
        height as i32,
    )
    .map_err(|_| NativeError::new(NativeErrorKind::Error, "software-bitmap-failed"))?;
    let faces = detector
        .DetectFacesAsync(&bitmap)
        .and_then(|operation| operation.get())
        .map_err(|_| NativeError::new(NativeErrorKind::Error, "face-detection-failed"))?;
    Ok(faces.Size().unwrap_or(0) > 0)
}

fn availability_for_error(error: &NativeError) -> PresenceAvailability {
    match error.kind {
        NativeErrorKind::PermissionDenied => PresenceAvailability::PermissionDenied,
        NativeErrorKind::NoDevice => PresenceAvailability::NoDevice,
        NativeErrorKind::Busy => PresenceAvailability::Busy,
        NativeErrorKind::Error => PresenceAvailability::Error,
    }
}

fn map_camera_error_at(error: nokhwa::NokhwaError, fallback_code: &'static str) -> NativeError {
    let classified = classify_camera_error(&error.to_string());
    if classified.kind == NativeErrorKind::Error {
        NativeError::new(NativeErrorKind::Error, fallback_code)
    } else {
        classified
    }
}

fn classify_camera_error(message: &str) -> NativeError {
    let lower = message.to_ascii_lowercase();
    if lower.contains("access denied")
        || lower.contains("permission")
        || lower.contains("0x80070005")
    {
        NativeError::new(
            NativeErrorKind::PermissionDenied,
            "camera-permission-denied",
        )
    } else if lower.contains("no device")
        || lower.contains("not found")
        || lower.contains("0x80070490")
    {
        NativeError::new(NativeErrorKind::NoDevice, "camera-not-found")
    } else if lower.contains("busy") || lower.contains("in use") || lower.contains("0xc00d3704") {
        NativeError::new(NativeErrorKind::Busy, "camera-busy")
    } else {
        NativeError::new(NativeErrorKind::Error, "camera-capture-failed")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_expected_capture_failures() {
        assert_eq!(
            classify_camera_error("0x80070005 access denied").kind,
            NativeErrorKind::PermissionDenied
        );
        assert_eq!(
            classify_camera_error("0x80070490 not found").kind,
            NativeErrorKind::NoDevice
        );
        assert_eq!(
            classify_camera_error("0xc00d3704 device in use").kind,
            NativeErrorKind::Busy
        );
        assert_eq!(
            classify_camera_error("decode failed").kind,
            NativeErrorKind::Error
        );
    }

    #[test]
    fn generic_camera_errors_keep_their_safe_pipeline_stage() {
        let error = map_camera_error_at(
            nokhwa::NokhwaError::GeneralError("driver detail".to_string()),
            "camera-frame-read-failed",
        );
        assert_eq!(error.kind, NativeErrorKind::Error);
        assert_eq!(error.code, "camera-frame-read-failed");
    }

    #[test]
    fn winrt_uses_the_sta_required_by_the_media_foundation_backend() {
        assert_eq!(winrt_apartment().0, RO_INIT_SINGLETHREADED.0);
    }
}
