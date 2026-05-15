mod active_app;

use std::time::Duration;
use tauri::{Emitter, Manager, WebviewWindow};

#[tauri::command]
fn set_click_through(window: WebviewWindow, ignore: bool) -> Result<(), String> {
    window.set_ignore_cursor_events(ignore).map_err(|e| e.to_string())
}

#[tauri::command]
fn set_always_on_top(window: WebviewWindow, on_top: bool) -> Result<(), String> {
    window.set_always_on_top(on_top).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_active_app() -> Option<active_app::ActiveAppInfo> {
    active_app::current_active_app()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_always_on_top(true);
            }
            // 1Hz 推送当前前台 App
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                let mut last: Option<active_app::ActiveAppInfo> = None;
                loop {
                    let current = active_app::current_active_app();
                    let changed = match (&current, &last) {
                        (Some(a), Some(b)) => a.name != b.name || a.bundle_id != b.bundle_id,
                        (Some(_), None) | (None, Some(_)) => true,
                        (None, None) => false,
                    };
                    if changed {
                        let _ = handle.emit("active-app-changed", &current);
                        last = current;
                    }
                    std::thread::sleep(Duration::from_secs(1));
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            set_click_through,
            set_always_on_top,
            get_active_app
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
