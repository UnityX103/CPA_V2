mod active_app;
mod key_counter;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tauri::{Emitter, Manager, RunEvent, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

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

#[tauri::command]
async fn open_settings_window(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window("settings") {
        w.show().map_err(|e| e.to_string())?;
        w.set_focus().map_err(|e| e.to_string())?;
        return Ok(());
    }
    let url = WebviewUrl::App("index.html?window=settings".into());
    WebviewWindowBuilder::new(&app, "settings", url)
        .title("设置")
        .inner_size(460.0, 440.0)
        .resizable(false)
        .transparent(true)
        .decorations(false)
        .always_on_top(true)
        .shadow(false)
        .skip_taskbar(true)
        .visible(true)
        .center()
        .build()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn close_settings_window(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window("settings") {
        w.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let active_app_stop = Arc::new(AtomicBool::new(false));
    let active_app_stop_for_setup = active_app_stop.clone();
    let active_app_stop_for_exit = active_app_stop.clone();

    let key_counter_stop = Arc::new(AtomicBool::new(false));
    let key_counter_stop_for_setup = key_counter_stop.clone();
    let key_counter_stop_for_exit = key_counter_stop.clone();

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .setup(move |app| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_always_on_top(true);
            }
            // 1Hz 前台 App 推送：用 AtomicBool 让 App 退出时线程能跳出循环
            // adversarial-review #6 的修复要点；NSWorkspace.frontmostApplication 在
            // 后台线程访问目前在实测上稳定，但仍标注为「需要后续移到主线程」
            let handle = app.handle().clone();
            let stop = active_app_stop_for_setup.clone();
            std::thread::spawn(move || {
                let mut last: Option<active_app::ActiveAppInfo> = None;
                while !stop.load(Ordering::Relaxed) {
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
                    // 拆成 10×100ms：让 stop 信号最多 100ms 内被观察到
                    for _ in 0..10 {
                        if stop.load(Ordering::Relaxed) {
                            return;
                        }
                        std::thread::sleep(Duration::from_millis(100));
                    }
                }
            });

            // 全局按键监听：CGEventTap → 主线程 emit；用户必须授予辅助功能权限
            let key_handle = app.handle().clone();
            key_counter::spawn_listener(key_counter_stop_for_setup.clone(), move |keycode| {
                let _ = key_handle.emit("key-pressed", keycode);
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            set_click_through,
            set_always_on_top,
            get_active_app,
            open_settings_window,
            close_settings_window
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(move |_handle, event| {
        if matches!(event, RunEvent::ExitRequested { .. } | RunEvent::Exit) {
            active_app_stop_for_exit.store(true, Ordering::Relaxed);
            key_counter_stop_for_exit.store(true, Ordering::Relaxed);
        }
    });
}
