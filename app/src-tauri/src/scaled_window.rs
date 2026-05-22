use serde::Deserialize;
use tauri::{LogicalPosition, LogicalSize, Manager};

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
    #[serde(default, alias = "center")]
    pub default_center: bool,
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

pub fn size_for_monitor(
    target: LogicalSizePair,
    min_width: f64,
    min_height: f64,
    monitor_rect: Option<LogicalRect>,
) -> LogicalSizePair {
    if let Some(monitor) = monitor_rect {
        clamp_size_to_monitor(
            target,
            min_width,
            min_height,
            monitor.width,
            monitor.height,
            WINDOW_EDGE_MARGIN,
        )
    } else {
        LogicalSizePair {
            width: target.width.max(min_width),
            height: target.height.max(min_height),
        }
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

fn monitor_logical_rect(monitor: &tauri::Monitor) -> LogicalRect {
    let scale = monitor.scale_factor();
    let position = monitor.position();
    let size = monitor.size();
    LogicalRect {
        x: position.x as f64 / scale,
        y: position.y as f64 / scale,
        width: size.width as f64 / scale,
        height: size.height as f64 / scale,
    }
}

fn window_logical_origin(window: &tauri::WebviewWindow) -> Result<(f64, f64), String> {
    let position = window.outer_position().map_err(|e| e.to_string())?;
    let scale = window.scale_factor().map_err(|e| e.to_string())?;
    Ok((position.x as f64 / scale, position.y as f64 / scale))
}

fn monitor_for_window(
    app: &tauri::AppHandle,
    window: &tauri::WebviewWindow,
    default_center: bool,
) -> Result<Option<tauri::Monitor>, String> {
    if default_center {
        if let Some(main) = app.get_webview_window("main") {
            return main.current_monitor().map_err(|e| e.to_string());
        }
    }
    window.current_monitor().map_err(|e| e.to_string())
}

pub fn origin_for_resize(
    existing_origin: Option<(f64, f64)>,
    default_center: bool,
    monitor: LogicalRect,
    size: LogicalSizePair,
) -> (f64, f64) {
    let origin = existing_origin.unwrap_or_else(|| {
        if default_center {
            centered_origin(monitor, size)
        } else {
            (monitor.x + WINDOW_EDGE_MARGIN, monitor.y + WINDOW_EDGE_MARGIN)
        }
    });
    clamp_origin_to_monitor(origin, monitor, size, WINDOW_EDGE_MARGIN)
}

pub fn resize_scaled_window(
    app: tauri::AppHandle,
    args: ResizeScaledWindowArgs,
) -> Result<(), String> {
    let Some(window) = app.get_webview_window(&args.label) else {
        return Ok(());
    };

    let target = scaled_size(args.base_width, args.base_height, args.scale)?;
    let monitor = monitor_for_window(&app, &window, args.default_center).unwrap_or(None);
    let logical_monitor = monitor.as_ref().map(monitor_logical_rect);
    let saved_layout =
        crate::window_layout::load_layout(&app, &args.label, args.min_width, args.min_height);
    let preferred_size = if args.label == "settings" {
        saved_layout
            .map(|layout| LogicalSizePair {
                width: layout.width,
                height: layout.height,
            })
            .unwrap_or(target)
    } else {
        target
    };
    let target = size_for_monitor(
        preferred_size,
        args.min_width,
        args.min_height,
        logical_monitor,
    );

    window
        .set_size(LogicalSize::new(target.width, target.height))
        .map_err(|e| e.to_string())?;

    let Some(logical_monitor) = logical_monitor else {
        let _ = crate::window_layout::save_current_layout(&app, &window, &args.label);
        return Ok(());
    };
    let existing_origin = if let Some(layout) = saved_layout {
        Some((layout.x, layout.y))
    } else if args.default_center {
        None
    } else {
        Some(window_logical_origin(&window)?)
    };
    let origin = origin_for_resize(
        existing_origin,
        args.default_center,
        logical_monitor,
        target,
    );
    window
        .set_position(LogicalPosition::new(origin.0, origin.1))
        .map_err(|e| e.to_string())?;
    let _ = crate::window_layout::save_current_layout(&app, &window, &args.label);
    Ok(())
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
    fn size_for_missing_monitor_uses_min_clamped_target_without_screen_bounds() {
        let size = size_for_monitor(
            LogicalSizePair {
                width: 1000.0,
                height: 100.0,
            },
            360.0,
            320.0,
            None,
        );

        assert_eq!(
            size,
            LogicalSizePair {
                width: 1000.0,
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

    #[test]
    fn resize_origin_prefers_existing_origin_over_default_center() {
        let monitor = LogicalRect {
            x: 0.0,
            y: 0.0,
            width: 1000.0,
            height: 800.0,
        };
        let size = LogicalSizePair {
            width: 400.0,
            height: 300.0,
        };
        let origin = origin_for_resize(Some((50.0, 60.0)), true, monitor, size);
        assert_eq!(origin, (50.0, 60.0));
    }
}
