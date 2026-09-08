use objc2_core_graphics::{CGEventSource, CGEventSourceStateID, CGEventType};

pub(super) fn idle_milliseconds() -> Result<u64, String> {
    // kCGAnyInputEventType queries aggregate keyboard/mouse idle time. This does
    // not create an event tap or request Accessibility/Input Monitoring access.
    let seconds = CGEventSource::seconds_since_last_event_type(
        CGEventSourceStateID::CombinedSessionState,
        CGEventType(u32::MAX),
    );
    if !seconds.is_finite() || seconds < 0.0 || seconds > u64::MAX as f64 / 1000.0 {
        return Err("无法读取键鼠活动时间".into());
    }
    Ok((seconds * 1000.0) as u64)
}
