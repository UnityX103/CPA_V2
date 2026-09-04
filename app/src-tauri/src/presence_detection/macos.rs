use super::{CameraDevice, NativeError, NativeErrorKind, PresenceAvailability};
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

pub(super) fn list_devices() -> Result<Vec<CameraDevice>, NativeError> {
    let default_id = unsafe { AVCaptureDevice::defaultDeviceWithMediaType(video_media_type()) }
        .map(|device| unsafe { device.uniqueID() }.to_string());
    let devices = nokhwa::query(ApiBackend::AVFoundation).map_err(map_camera_error)?;
    Ok(devices
        .into_iter()
        .map(|device| {
            let id = device.misc();
            CameraDevice {
                is_default: default_id.as_deref() == Some(id.as_str()),
                id,
                name: device.human_name().to_string(),
            }
        })
        .collect())
}

pub(super) fn status(camera_device_id: Option<&str>) -> PresenceAvailability {
    let status = unsafe { AVCaptureDevice::authorizationStatusForMediaType(video_media_type()) };
    match status {
        AVAuthorizationStatus::NotDetermined => PresenceAvailability::PermissionRequired,
        AVAuthorizationStatus::Authorized => camera_index(camera_device_id)
            .map(|_| PresenceAvailability::Ready)
            .unwrap_or_else(|error| availability_for_error(&error)),
        AVAuthorizationStatus::Denied | AVAuthorizationStatus::Restricted => {
            PresenceAvailability::PermissionDenied
        }
        _ => PresenceAvailability::Error,
    }
}

pub(super) fn request_access(camera_device_id: Option<&str>) -> PresenceAvailability {
    if status(camera_device_id) != PresenceAvailability::PermissionRequired {
        return status(camera_device_id);
    }

    let (tx, rx) = mpsc::sync_channel(1);
    let handler = RcBlock::new(move |granted: Bool| {
        let _ = tx.send(granted.as_bool());
    });
    unsafe {
        AVCaptureDevice::requestAccessForMediaType_completionHandler(video_media_type(), &handler);
    }
    match rx.recv_timeout(Duration::from_secs(120)) {
        Ok(true) => status(camera_device_id),
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

pub(super) fn sample(camera_device_id: Option<&str>) -> Result<bool, NativeError> {
    let mut camera = open_camera(camera_device_id)?;
    let detection = sample_open_camera(&mut camera);
    let stop_result = camera.stop_stream().map_err(map_camera_error);
    match (detection, stop_result) {
        (Err(error), _) | (Ok(_), Err(error)) => Err(error),
        (Ok(present), Ok(())) => Ok(present),
    }
}

pub(super) fn stream_samples(
    frame_interval: Duration,
    camera_device_id: Option<&str>,
    emit: impl FnMut(Result<bool, NativeError>) -> bool,
) -> Result<(), NativeError> {
    super::run_releasing_sample_loop(
        frame_interval,
        || sample(camera_device_id),
        emit,
        std::thread::sleep,
    )
}

fn open_camera(camera_device_id: Option<&str>) -> Result<Camera, NativeError> {
    match status(camera_device_id) {
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

    let index = camera_index(camera_device_id)?;
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

fn camera_index(camera_device_id: Option<&str>) -> Result<nokhwa::utils::CameraIndex, NativeError> {
    let target_id = match camera_device_id {
        Some(camera_device_id) => camera_device_id.to_string(),
        None => {
            let default_device =
                unsafe { AVCaptureDevice::defaultDeviceWithMediaType(video_media_type()) }
                    .ok_or_else(|| {
                        NativeError::new(NativeErrorKind::NoDevice, "camera-not-found")
                    })?;
            unsafe { default_device.uniqueID() }.to_string()
        }
    };
    let devices = nokhwa::query(ApiBackend::AVFoundation).map_err(map_camera_error)?;
    devices
        .into_iter()
        .find(|device| device.misc() == target_id)
        .map(|device| device.index().clone())
        .ok_or_else(|| {
            NativeError::new(
                NativeErrorKind::NoDevice,
                if camera_device_id.is_some() {
                    "selected-camera-not-found"
                } else {
                    "default-camera-not-found"
                },
            )
        })
}

fn availability_for_error(error: &NativeError) -> PresenceAvailability {
    match error.kind {
        NativeErrorKind::PermissionDenied => PresenceAvailability::PermissionDenied,
        NativeErrorKind::NoDevice => PresenceAvailability::NoDevice,
        NativeErrorKind::Busy => PresenceAvailability::Busy,
        NativeErrorKind::Error => PresenceAvailability::Error,
    }
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
