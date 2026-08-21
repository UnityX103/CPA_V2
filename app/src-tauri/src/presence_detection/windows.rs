use super::{NativeError, NativeErrorKind, PresenceAvailability};
use nokhwa::pixel_format::RgbFormat;
use nokhwa::utils::{ApiBackend, FrameFormat, RequestedFormat, RequestedFormatType};
use nokhwa::Camera;
use std::time::Duration;
use windows::Graphics::Imaging::{BitmapPixelFormat, SoftwareBitmap};
use windows::Media::FaceAnalysis::FaceDetector;
use windows::Security::Cryptography::CryptographicBuffer;
use windows::Win32::System::WinRT::{RoInitialize, RoUninitialize, RO_INIT_MULTITHREADED};

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
            initialized: unsafe { RoInitialize(RO_INIT_MULTITHREADED) }.is_ok(),
        }
    }
}

impl Drop for RoInitializeGuard {
    fn drop(&mut self) {
        if self.initialized {
            unsafe { RoUninitialize() };
        }
    }
}

pub(super) fn status() -> PresenceAvailability {
    match nokhwa::query(ApiBackend::MediaFoundation) {
        Ok(devices) if devices.is_empty() => PresenceAvailability::NoDevice,
        Ok(_) => PresenceAvailability::Ready,
        Err(error) => availability_for_error(&classify_camera_error(&error.to_string())),
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
    let stop_result = camera.stop_stream().map_err(map_camera_error);
    match (detection, stop_result) {
        (Err(error), _) | (Ok(_), Err(error)) => Err(error),
        (Ok(present), Ok(())) => Ok(present),
    }
}

pub(super) fn stream_samples(
    frame_interval: Duration,
    mut emit: impl FnMut(Result<bool, NativeError>) -> bool,
) -> Result<(), NativeError> {
    let _winrt = RoInitializeGuard::new();
    let mut camera = open_camera()?;
    let detector = create_face_detector()?;
    loop {
        let result = sample_open_camera(&mut camera, &detector);
        let sample_succeeded = result.is_ok();
        if !emit(result) || !sample_succeeded {
            break;
        }
        std::thread::sleep(frame_interval);
    }
    camera.stop_stream().map_err(map_camera_error)
}

fn open_camera() -> Result<Camera, NativeError> {
    let devices = nokhwa::query(ApiBackend::MediaFoundation).map_err(map_camera_error)?;
    let index = devices
        .first()
        .map(|device| device.index().clone())
        .ok_or_else(|| NativeError::new(NativeErrorKind::NoDevice, "camera-not-found"))?;
    let format = RequestedFormat::with_formats(
        RequestedFormatType::AbsoluteHighestFrameRate,
        RAW_CAMERA_FORMATS,
    );
    let mut camera = Camera::with_backend(index, format, ApiBackend::MediaFoundation)
        .map_err(map_camera_error)?;
    camera.open_stream().map_err(map_camera_error)?;
    Ok(camera)
}

fn create_face_detector() -> Result<FaceDetector, NativeError> {
    FaceDetector::CreateAsync()
        .and_then(|operation| operation.get())
        .map_err(|_| NativeError::new(NativeErrorKind::Error, "face-detector-unavailable"))
}

fn sample_open_camera(camera: &mut Camera, detector: &FaceDetector) -> Result<bool, NativeError> {
    let frame = camera.frame().map_err(map_camera_error)?;
    let decoded = frame
        .decode_image::<RgbFormat>()
        .map_err(map_camera_error)?;
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

fn map_camera_error(error: nokhwa::NokhwaError) -> NativeError {
    classify_camera_error(&error.to_string())
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
}
