use serde::Deserialize;

pub const WINDOW_EDGE_MARGIN: f64 = 24.0;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct LogicalRect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct LogicalSizePair {
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResizeScaledWindowArgs {
    pub label: String,
    pub base_width: f64,
    pub base_height: f64,
    pub scale: f64,
    pub min_width: f64,
    pub min_height: f64,
    pub center: bool,
}

pub fn scaled_size(
    base_width: f64,
    base_height: f64,
    scale: f64,
) -> Result<LogicalSizePair, String> {
    if !base_width.is_finite() || !base_height.is_finite() || !scale.is_finite() {
        return Err("scaled window dimensions must be finite".to_string());
    }
    if base_width <= 0.0 || base_height <= 0.0 || scale <= 0.0 {
        return Err("scaled window dimensions must be positive".to_string());
    }
    Ok(LogicalSizePair {
        width: base_width * scale,
        height: base_height * scale,
    })
}

pub fn clamp_size_to_monitor(
    size: LogicalSizePair,
    min_width: f64,
    min_height: f64,
    monitor_width: f64,
    monitor_height: f64,
    margin: f64,
) -> LogicalSizePair {
    let available_width = (monitor_width - margin * 2.0).max(min_width);
    let available_height = (monitor_height - margin * 2.0).max(min_height);
    LogicalSizePair {
        width: size.width.max(min_width).min(available_width),
        height: size.height.max(min_height).min(available_height),
    }
}

pub fn centered_origin(monitor: LogicalRect, size: LogicalSizePair) -> (f64, f64) {
    (
        monitor.x + (monitor.width - size.width) / 2.0,
        monitor.y + (monitor.height - size.height) / 2.0,
    )
}

pub fn clamp_origin_to_monitor(
    origin: (f64, f64),
    monitor: LogicalRect,
    size: LogicalSizePair,
    margin: f64,
) -> (f64, f64) {
    let min_x = monitor.x + margin;
    let min_y = monitor.y + margin;
    let max_x = monitor.x + monitor.width - margin - size.width;
    let max_y = monitor.y + monitor.height - margin - size.height;
    (
        origin.0.clamp(min_x.min(max_x), min_x.max(max_x)),
        origin.1.clamp(min_y.min(max_y), min_y.max(max_y)),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scaled_size_multiplies_base_dimensions() {
        assert_eq!(
            scaled_size(249.0, 171.0, 1.5).unwrap(),
            LogicalSizePair {
                width: 373.5,
                height: 256.5
            }
        );
    }

    #[test]
    fn scaled_size_rejects_invalid_dimensions() {
        assert!(scaled_size(0.0, 171.0, 1.0).is_err());
        assert!(scaled_size(249.0, f64::NAN, 1.0).is_err());
        assert!(scaled_size(249.0, 171.0, -1.0).is_err());
    }

    #[test]
    fn clamp_size_respects_monitor_margin_and_minimum_size() {
        let clamped = clamp_size_to_monitor(
            LogicalSizePair {
                width: 1000.0,
                height: 900.0,
            },
            360.0,
            320.0,
            800.0,
            700.0,
            WINDOW_EDGE_MARGIN,
        );
        assert_eq!(
            clamped,
            LogicalSizePair {
                width: 752.0,
                height: 652.0
            }
        );

        let minned = clamp_size_to_monitor(
            LogicalSizePair {
                width: 100.0,
                height: 100.0,
            },
            360.0,
            320.0,
            800.0,
            700.0,
            WINDOW_EDGE_MARGIN,
        );
        assert_eq!(
            minned,
            LogicalSizePair {
                width: 360.0,
                height: 320.0
            }
        );
    }

    #[test]
    fn centered_origin_places_window_in_monitor_center() {
        let origin = centered_origin(
            LogicalRect {
                x: 100.0,
                y: 50.0,
                width: 1000.0,
                height: 800.0,
            },
            LogicalSizePair {
                width: 400.0,
                height: 300.0,
            },
        );
        assert_eq!(origin, (400.0, 300.0));
    }

    #[test]
    fn clamp_origin_keeps_preserved_windows_visible() {
        let origin = clamp_origin_to_monitor(
            (900.0, 720.0),
            LogicalRect {
                x: 0.0,
                y: 0.0,
                width: 1000.0,
                height: 800.0,
            },
            LogicalSizePair {
                width: 300.0,
                height: 200.0,
            },
            WINDOW_EDGE_MARGIN,
        );
        assert_eq!(origin, (676.0, 576.0));
    }
}
