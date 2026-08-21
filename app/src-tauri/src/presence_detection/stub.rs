use super::{NativeError, NativeErrorKind, PresenceAvailability};

pub(super) fn status() -> PresenceAvailability {
    PresenceAvailability::Error
}

pub(super) fn request_access() -> PresenceAvailability {
    PresenceAvailability::Error
}

pub(super) fn open_privacy_settings() -> Result<(), String> {
    Err("camera presence detection is unsupported on this platform".to_string())
}

pub(super) fn sample() -> Result<bool, NativeError> {
    Err(NativeError::new(
        NativeErrorKind::Error,
        "unsupported-platform",
    ))
}

pub(super) fn stream_samples(
    _frame_interval: std::time::Duration,
    mut emit: impl FnMut(Result<bool, NativeError>) -> bool,
) -> Result<(), NativeError> {
    let error = NativeError::new(NativeErrorKind::Error, "unsupported-platform");
    let _ = emit(Err(error.clone()));
    Err(error)
}
