use super::{NativeError, NativeErrorKind, PresenceAvailability};
use block2::RcBlock;
use nokhwa::pixel_format::RgbFormat;
use nokhwa::utils::{ApiBackend, FrameFormat, RequestedFormat, RequestedFormatType};
use nokhwa::Camera;
use objc2::runtime::{AnyObject, Bool};
use objc2::AnyThread;
use objc2_av_foundation::{AVAuthorizationStatus, AVCaptureDevice, AVMediaTypeVideo};
use objc2_core_foundation::CFData;
use objc2_core_graphics::{
    CGBitmapInfo, CGColorRenderingIntent, CGColorSpace, CGDataProvider, CGImage,
};
use objc2_foundation::{NSArray, NSDictionary};
use objc2_vision::{
    VNDetectFaceRectanglesRequest, VNImageOption, VNImageRequestHandler, VNRequest,
};
use std::ptr;
use std::sync::mpsc;
use std::time::Duration;

const RAW_CAMERA_FORMATS: &[FrameFormat] = &[
    FrameFormat::YUYV,
    FrameFormat::NV12,
    FrameFormat::RAWRGB,
    FrameFormat::RAWBGR,
];
fn video_media_type() -> &'static objc2_av_foundation::AVMediaType {
    unsafe { AVMediaTypeVideo.expect("AVMediaTypeVideo is unavailable") }
}

pub(super) fn status() -> PresenceAvailability {
    let status = unsafe { AVCaptureDevice::authorizationStatusForMediaType(video_media_type()) };
    match status {
        AVAuthorizationStatus::NotDetermined => PresenceAvailability::PermissionRequired,
        AVAuthorizationStatus::Authorized => {
            let device = unsafe { AVCaptureDevice::defaultDeviceWithMediaType(video_media_type()) };
            if device.is_some() {
                PresenceAvailability::Ready
            } else {
                PresenceAvailability::NoDevice
            }
        }
        AVAuthorizationStatus::Denied | AVAuthorizationStatus::Restricted => {
            PresenceAvailability::PermissionDenied
        }
        _ => PresenceAvailability::Error,
    }
}

pub(super) fn request_access() -> PresenceAvailability {
    if status() != PresenceAvailability::PermissionRequired {
        return status();
    }

    let (tx, rx) = mpsc::sync_channel(1);
    let handler = RcBlock::new(move |granted: Bool| {
        let _ = tx.send(granted.as_bool());
    });
    unsafe {
        AVCaptureDevice::requestAccessForMediaType_completionHandler(video_media_type(), &handler);
    }
    match rx.recv_timeout(Duration::from_secs(120)) {
        Ok(true) => status(),
        Ok(false) => PresenceAvailability::PermissionDenied,
        Err(_) => PresenceAvailability::Error,
    }
}

pub(super) fn open_privacy_settings() -> Result<(), String> {
    std::process::Command::new("open")
        .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_Camera")
        .spawn()
        .map_err(|error| format!("open camera privacy settings failed: {error}"))?;
    Ok(())
}

pub(super) fn sample() -> Result<bool, NativeError> {
    let mut camera = open_camera()?;
    let detection = sample_open_camera(&mut camera);
    let stop_result = camera.stop_stream().map_err(map_camera_error);
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

fn open_camera() -> Result<Camera, NativeError> {
    match status() {
        PresenceAvailability::PermissionRequired | PresenceAvailability::PermissionDenied => {
            return Err(NativeError::new(
                NativeErrorKind::PermissionDenied,
                "camera-permission-denied",
            ));
        }
        PresenceAvailability::NoDevice => {
            return Err(NativeError::new(
                NativeErrorKind::NoDevice,
                "camera-not-found",
            ));
        }
        PresenceAvailability::Ready => {}
        _ => {
            return Err(NativeError::new(
                NativeErrorKind::Error,
                "camera-status-error",
            ))
        }
    }

    let index = default_camera_index()?;
    let format = RequestedFormat::with_formats(
        RequestedFormatType::AbsoluteHighestFrameRate,
        RAW_CAMERA_FORMATS,
    );
    let mut camera =
        Camera::with_backend(index, format, ApiBackend::AVFoundation).map_err(map_camera_error)?;
    camera.open_stream().map_err(map_camera_error)?;
    Ok(camera)
}

fn sample_open_camera(camera: &mut Camera) -> Result<bool, NativeError> {
    let frame = camera.frame().map_err(map_camera_error)?;
    let decoded = frame
        .decode_image::<RgbFormat>()
        .map_err(map_camera_error)?;
    let (width, height) = decoded.dimensions();
    let bytes = decoded.into_raw();

    detect_face(&bytes, width as usize, height as usize)
}

fn default_camera_index() -> Result<nokhwa::utils::CameraIndex, NativeError> {
    let default_device = unsafe { AVCaptureDevice::defaultDeviceWithMediaType(video_media_type()) }
        .ok_or_else(|| NativeError::new(NativeErrorKind::NoDevice, "camera-not-found"))?;
    let default_id = unsafe { default_device.uniqueID() }.to_string();
    let devices = nokhwa::query(ApiBackend::AVFoundation).map_err(map_camera_error)?;
    devices
        .into_iter()
        .find(|device| device.misc() == default_id)
        .map(|device| device.index().clone())
        .ok_or_else(|| NativeError::new(NativeErrorKind::NoDevice, "default-camera-not-found"))
}

fn detect_face(bytes: &[u8], width: usize, height: usize) -> Result<bool, NativeError> {
    let data = CFData::from_bytes(bytes);
    let provider = CGDataProvider::with_cf_data(Some(&data))
        .ok_or_else(|| NativeError::new(NativeErrorKind::Error, "image-provider-failed"))?;
    let color_space = CGColorSpace::new_device_rgb()
        .ok_or_else(|| NativeError::new(NativeErrorKind::Error, "color-space-failed"))?;
    let image = unsafe {
        CGImage::new(
            width,
            height,
            8,
            24,
            width * 3,
            Some(&color_space),
            CGBitmapInfo::empty(),
            Some(&provider),
            ptr::null(),
            false,
            CGColorRenderingIntent::RenderingIntentDefault,
        )
    }
    .ok_or_else(|| NativeError::new(NativeErrorKind::Error, "cg-image-failed"))?;

    let request = unsafe { VNDetectFaceRectanglesRequest::new() };
    let requests = NSArray::<VNRequest>::from_slice(&[&request]);
    let options = NSDictionary::<VNImageOption, AnyObject>::new();
    let handler = unsafe {
        VNImageRequestHandler::initWithCGImage_options(
            VNImageRequestHandler::alloc(),
            &image,
            &options,
        )
    };
    handler
        .performRequests_error(&requests)
        .map_err(|_| NativeError::new(NativeErrorKind::Error, "vision-request-failed"))?;
    let results = unsafe { request.results() };
    Ok(results.is_some_and(|faces| faces.count() > 0))
}

fn map_camera_error(error: nokhwa::NokhwaError) -> NativeError {
    classify_camera_error(&error.to_string())
}

fn classify_camera_error(message: &str) -> NativeError {
    let lower = message.to_ascii_lowercase();
    if lower.contains("permission") || lower.contains("not authorized") || lower.contains("denied")
    {
        NativeError::new(
            NativeErrorKind::PermissionDenied,
            "camera-permission-denied",
        )
    } else if lower.contains("no device") || lower.contains("not found") || lower.contains("index")
    {
        NativeError::new(NativeErrorKind::NoDevice, "camera-not-found")
    } else if lower.contains("busy") || lower.contains("in use") || lower.contains("exclusive") {
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
            classify_camera_error("permission denied").kind,
            NativeErrorKind::PermissionDenied
        );
        assert_eq!(
            classify_camera_error("no device found").kind,
            NativeErrorKind::NoDevice
        );
        assert_eq!(
            classify_camera_error("device is busy").kind,
            NativeErrorKind::Busy
        );
        assert_eq!(
            classify_camera_error("decode failed").kind,
            NativeErrorKind::Error
        );
    }
}
