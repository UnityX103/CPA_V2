use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, fs, path::PathBuf};
use tauri::{LogicalPosition, LogicalSize, Manager};

const STORE_FILE: &str = "window-layouts.json";

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedWindowLayout {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WindowLayoutSnapshot {
    schema_version: u32,
    windows: BTreeMap<String, SavedWindowLayout>,
}

pub fn is_supported_window_label(label: &str) -> bool {
    matches!(label, "main" | "settings" | "input-counter")
}

pub fn normalize_layout(
    layout: SavedWindowLayout,
    min_width: f64,
    min_height: f64,
) -> Option<SavedWindowLayout> {
    if !layout.x.is_finite()
        || !layout.y.is_finite()
        || !layout.width.is_finite()
        || !layout.height.is_finite()
    {
        return None;
    }
    if layout.width < min_width || layout.height < min_height {
        return None;
    }
    Some(layout)
}

fn empty_snapshot() -> WindowLayoutSnapshot {
    WindowLayoutSnapshot {
        schema_version: 1,
        windows: BTreeMap::new(),
    }
}

fn store_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join(STORE_FILE))
}

fn read_snapshot(app: &tauri::AppHandle) -> WindowLayoutSnapshot {
    let Ok(path) = store_path(app) else {
        return empty_snapshot();
    };
    let Ok(raw) = fs::read_to_string(path) else {
        return empty_snapshot();
    };
    serde_json::from_str(&raw).unwrap_or_else(|_| empty_snapshot())
}

fn write_snapshot(app: &tauri::AppHandle, snapshot: &WindowLayoutSnapshot) -> Result<(), String> {
    let path = store_path(app)?;
    let raw = serde_json::to_string_pretty(snapshot).map_err(|e| e.to_string())?;
    fs::write(path, raw).map_err(|e| e.to_string())
}

pub fn load_layout(
    app: &tauri::AppHandle,
    label: &str,
    min_width: f64,
    min_height: f64,
) -> Option<SavedWindowLayout> {
    if !is_supported_window_label(label) {
        return None;
    }
    read_snapshot(app)
        .windows
        .get(label)
        .copied()
        .and_then(|layout| normalize_layout(layout, min_width, min_height))
}

pub fn save_current_layout(
    app: &tauri::AppHandle,
    window: &tauri::WebviewWindow,
    label: &str,
) -> Result<(), String> {
    if !is_supported_window_label(label) {
        return Ok(());
    }
    let position = window.outer_position().map_err(|e| e.to_string())?;
    let size = window.outer_size().map_err(|e| e.to_string())?;
    let scale = window.scale_factor().map_err(|e| e.to_string())?;
    let mut snapshot = read_snapshot(app);
    snapshot.schema_version = 1;
    snapshot.windows.insert(
        label.to_string(),
        SavedWindowLayout {
            x: position.x as f64 / scale,
            y: position.y as f64 / scale,
            width: size.width as f64 / scale,
            height: size.height as f64 / scale,
        },
    );
    write_snapshot(app, &snapshot)
}

pub fn apply_layout(
    window: &tauri::WebviewWindow,
    layout: SavedWindowLayout,
) -> Result<(), String> {
    window
        .set_size(LogicalSize::new(layout.width, layout.height))
        .map_err(|e| e.to_string())?;
    window
        .set_position(LogicalPosition::new(layout.x, layout.y))
        .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn install_tracking(app: tauri::AppHandle, label: &'static str) {
    let Some(window) = app.get_webview_window(label) else {
        return;
    };
    let tracked_window = window.clone();
    window.on_window_event(move |event| {
        if matches!(
            event,
            tauri::WindowEvent::Moved(_) | tauri::WindowEvent::Resized(_)
        ) {
            if let Err(e) = save_current_layout(&app, &tracked_window, label) {
                eprintln!("[window_layout] save {label} failed: {e}");
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn supported_labels_are_explicit() {
        assert!(is_supported_window_label("main"));
        assert!(is_supported_window_label("settings"));
        assert!(is_supported_window_label("input-counter"));
        assert!(!is_supported_window_label("remote-player"));
    }

    #[test]
    fn normalize_layout_rejects_bad_values() {
        assert!(normalize_layout(
            SavedWindowLayout {
                x: 0.0,
                y: 0.0,
                width: 300.0,
                height: 200.0,
            },
            100.0,
            100.0,
        )
        .is_some());
        assert!(normalize_layout(
            SavedWindowLayout {
                x: f64::NAN,
                y: 0.0,
                width: 300.0,
                height: 200.0,
            },
            100.0,
            100.0,
        )
        .is_none());
        assert!(normalize_layout(
            SavedWindowLayout {
                x: 0.0,
                y: 0.0,
                width: 10.0,
                height: 200.0,
            },
            100.0,
            100.0,
        )
        .is_none());
    }
}
