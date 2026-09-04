use super::{CameraDevice, NativeError, NativeErrorKind, PresenceAvailability};

pub(super) fn list_devices() -> Result<Vec<CameraDevice>, NativeError> {
    Ok(Vec::new())
}

pub(super) fn status(_camera_device_id: Option<&str>) -> PresenceAvailability {
    PresenceAvailability::Error
}

pub(super) fn request_access(_camera_device_id: Option<&str>) -> PresenceAvailability {
    PresenceAvailability::Error
}

pub(super) fn open_privacy_settings() -> Result<(), String> {
    Err("camera presence detection is unsupported on this platform".to_string())
}

pub(super) fn sample(_camera_device_id: Option<&str>) -> Result<bool, NativeError> {
    Err(NativeError::new(
        NativeErrorKind::Error,
        "unsupported-platform",
    ))
}

pub(super) fn stream_samples(
    _frame_interval: std::time::Duration,
    _camera_device_id: Option<&str>,
    mut emit: impl FnMut(Result<bool, NativeError>) -> bool,
) -> Result<(), NativeError> {
    let error = NativeError::new(NativeErrorKind::Error, "unsupported-platform");
    let _ = emit(Err(error.clone()));
    Err(error)
}
