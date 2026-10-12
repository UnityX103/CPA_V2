use serde::Deserialize;
use std::sync::Mutex;
use tauri::{Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

#[cfg(target_os = "windows")]
mod windows;
#[cfg(target_os = "macos")]
mod macos;

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HitRegion {
    pub x: f64, pub y: f64, pub width: f64, pub height: f64, pub radius: f64,
}
#[derive(Default)]
struct HitMap { width: f64, height: f64, regions: Vec<HitRegion> }
static HIT_MAP: Mutex<HitMap> = Mutex::new(HitMap { width: 1.0, height: 1.0, regions: Vec::new() });

fn contains(x: f64, y: f64, width: f64, height: f64) -> bool {
    let Ok(map) = HIT_MAP.lock() else { return false; };
    if width <= 0.0 || height <= 0.0 { return false; }
    let x = x * map.width / width;
    let y = y * map.height / height;
    map.regions.iter().any(|r| crate::window_helpers::point_in_rounded_rect(
        r.width, r.height, r.radius, x - r.x, y - r.y,
    ))
}

#[tauri::command]
pub fn update_kegel_hit_regions(window: tauri::WebviewWindow, width: f64, height: f64, regions: Vec<HitRegion>) -> Result<(), String> {
    if window.label() != "kegel" { return Err("only the kegel window may update its hit regions".into()); }
    if !width.is_finite() || !height.is_finite() || width <= 0.0 || height <= 0.0 || regions.len() > 16
        || regions.iter().any(|r| [r.x, r.y, r.width, r.height, r.radius].iter().any(|n| !n.is_finite())) {
        return Err("invalid hit regions".into());
    }
    *HIT_MAP.lock().map_err(|_| "hit regions unavailable")? = HitMap { width, height, regions };
    Ok(())
}

#[tauri::command]
pub async fn set_kegel_window_visible(app: tauri::AppHandle, visible: bool) -> Result<(), String> {
    let _guard = crate::extension_packs::LIFECYCLE_LOCK.lock().await;
    if visible && !crate::extension_packs::pack_is_enabled(&app, crate::extension_packs::KEGEL_ID)? {
        return Err("凯格尔模块未安装或已停用".into());
    }
    let (tx, rx) = std::sync::mpsc::channel();
    let handle = app.clone();
    app.run_on_main_thread(move || {
        let result = (|| -> Result<(), String> {
            if !visible {
                if let Some(w) = handle.get_webview_window("kegel") { w.hide().map_err(|e| e.to_string())?; }
                return Ok(());
            }
            let monitor = handle.get_webview_window("main")
                .and_then(|w| w.current_monitor().ok().flatten())
                .or_else(|| handle.primary_monitor().ok().flatten()).ok_or("no monitor available")?;
            if handle.get_webview_window("kegel").is_none() { build_hidden(&handle)?; }
            let window = handle.get_webview_window("kegel").ok_or("凯格尔窗口创建失败")?;
            window.set_size(tauri::PhysicalSize::new(monitor.size().width, monitor.size().height)).map_err(|e| e.to_string())?;
            window.set_position(tauri::PhysicalPosition::new(monitor.position().x, monitor.position().y)).map_err(|e| e.to_string())?;
            window.show().map_err(|e| e.to_string())?;
            crate::window_helpers::set_always_on_top_native(&window, true)?;
            window.set_focus().map_err(|e| e.to_string())
        })();
        let _ = tx.send(result);
    }).map_err(|e| e.to_string())?;
    rx.recv().map_err(|e| e.to_string())?
}

/// Called on the main thread only after native installation/enablement checks.
pub fn build_hidden(app: &tauri::AppHandle) -> Result<(), String> {
    if !crate::extension_packs::pack_is_enabled(app, crate::extension_packs::KEGEL_ID)? {
        return Err("凯格尔模块未安装或已停用".into());
    }
    let url = "cpa-module://localhost/wellness.kegel/index.html".parse().map_err(|e| format!("模块入口无效：{e}"))?;
    let w = WebviewWindowBuilder::new(app, "kegel", WebviewUrl::CustomProtocol(url))
        .title("凯格尔运动").inner_size(800.0, 600.0).visible(false)
        .transparent(true).decorations(false).shadow(false).resizable(false)
        .skip_taskbar(true).always_on_top(true).build().map_err(|e| e.to_string())?;
    #[cfg(target_os = "windows")]
    if let Err(error) = windows::install(&w) { let _ = w.close(); return Err(error); }
    #[cfg(target_os = "macos")]
    if let Err(error) = macos::install(&w) { let _ = w.close(); return Err(error); }
    let handle = app.clone();
    w.on_window_event(move |event| {
        if let tauri::WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            let _ = handle.emit_to("main", "break-activity:release", serde_json::json!({ "ownerId": crate::extension_packs::KEGEL_ID }));
        }
    });
    Ok(())
}

pub fn stop_feature(app: &tauri::AppHandle) -> Result<(), String> {
    crate::kegel_module::stop_audio(app);
    // Lifecycle commands call this from a blocking worker. Destruction must run
    // on the UI thread and be confirmed before persisting disabled state.
    let (tx, rx) = std::sync::mpsc::channel();
    let handle = app.clone();
    app.run_on_main_thread(move || {
        let result = (|| -> Result<(), String> {
            if let Some(window) = handle.get_webview_window("kegel") {
                window.hide().map_err(|e| e.to_string())?;
                window.destroy().map_err(|e| e.to_string())?;
            }
            Ok(())
        })();
        let _ = tx.send(result);
    }).map_err(|e| e.to_string())?;
    rx.recv_timeout(std::time::Duration::from_secs(3)).map_err(|e| format!("关闭凯格尔窗口超时：{e}"))??;
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(3);
    while app.get_webview_window("kegel").is_some() {
        if std::time::Instant::now() >= deadline { return Err("凯格尔窗口尚未关闭，未更改模块状态".into()); }
        std::thread::sleep(std::time::Duration::from_millis(20));
    }
    // Invalidate requests that raced the first stop while the window was still
    // installed and enabled. No window can submit a new session after removal.
    crate::kegel_module::stop_audio(app);
    *HIT_MAP.lock().map_err(|_| "hit regions unavailable")? = HitMap::default();
    app.emit_to("main", "break-activity:release", serde_json::json!({ "ownerId": crate::extension_packs::KEGEL_ID })).map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn transparent_corners_and_scaled_circle_pass_through() {
        *HIT_MAP.lock().unwrap() = HitMap { width: 100.0, height: 100.0, regions: vec![HitRegion {
            x: 10.0, y: 10.0, width: 80.0, height: 80.0, radius: 40.0,
        }] };
        assert!(contains(100.0, 100.0, 200.0, 200.0));
        assert!(!contains(22.0, 22.0, 200.0, 200.0));
        assert!(!contains(1.0, 1.0, 200.0, 200.0));
    }
}
