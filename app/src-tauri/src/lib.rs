mod accessibility;
mod active_app;
mod key_counter;
mod passthrough;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tauri::{
    Emitter, Manager, PhysicalPosition, RunEvent, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
};

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

const SETTINGS_W: f64 = 460.0;
const SETTINGS_H: f64 = 440.0;

/// 计算设置窗口在主窗口所在 monitor 的中心位置（物理像素）。
/// 多显示器下保证设置窗弹在用户当前屏，而非系统主屏。
fn settings_center_position(app: &tauri::AppHandle) -> Result<PhysicalPosition<i32>, String> {
    let main = app
        .get_webview_window("main")
        .ok_or_else(|| "main window not found".to_string())?;
    let monitor = main
        .current_monitor()
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "main window has no current_monitor".to_string())?;
    let mpos = monitor.position();
    let msize = monitor.size();
    let scale = monitor.scale_factor();
    let win_w = (SETTINGS_W * scale).round() as u32;
    let win_h = (SETTINGS_H * scale).round() as u32;
    let (x, y) = passthrough::compute_centered_origin(
        (mpos.x, mpos.y),
        (msize.width, msize.height),
        (win_w, win_h),
    );
    Ok(PhysicalPosition::new(x, y))
}

#[tauri::command]
async fn open_settings_window(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window("settings") {
        // 已存在的设置窗口：复用 → 重新对齐到主窗口所在屏中心 → 显示 → 抢焦点。
        // first-mouse subclass 是一次性安装，无需重装。
        if let Ok(pos) = settings_center_position(&app) {
            let _ = w.set_position(pos);
        }
        w.show().map_err(|e| e.to_string())?;
        w.set_focus().map_err(|e| e.to_string())?;
        return Ok(());
    }

    // 首次创建：先 invisible 建窗 → 计算位置 → 装 first-mouse hook → show。
    // 顺序保证用户看到的是已经摆好的窗口，避免闪烁。
    let url = WebviewUrl::App("index.html?window=settings".into());
    let w = WebviewWindowBuilder::new(&app, "settings", url)
        .title("设置")
        .inner_size(SETTINGS_W, SETTINGS_H)
        .resizable(false)
        .transparent(true)
        .decorations(false)
        .always_on_top(true)
        .shadow(false)
        .skip_taskbar(true)
        .visible(false)
        .build()
        .map_err(|e| e.to_string())?;

    if let Ok(pos) = settings_center_position(&app) {
        let _ = w.set_position(pos);
    }
    passthrough::install_first_mouse_only(&w);
    w.show().map_err(|e| e.to_string())?;
    w.set_focus().map_err(|e| e.to_string())?;
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

    let accessibility_stop = Arc::new(AtomicBool::new(false));
    let accessibility_stop_for_setup = accessibility_stop.clone();
    let accessibility_stop_for_exit = accessibility_stop.clone();

    let listener_handle = Arc::new(accessibility::ListenerHandle::default());
    let listener_handle_for_setup = listener_handle.clone();
    let listener_handle_for_manage = listener_handle.clone();
    let listener_handle_for_exit = listener_handle.clone();

    let hit_store = std::sync::Arc::new(passthrough::HitRegionStore::new());
    let hit_store_for_setup = hit_store.clone();
    let hit_store_for_manage = hit_store.clone();

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .manage::<std::sync::Arc<passthrough::HitRegionStore>>(hit_store_for_manage)
        .manage::<std::sync::Arc<accessibility::ListenerHandle>>(listener_handle_for_manage)
        .setup(move |app| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_always_on_top(true);
            }
            if let Some(window) = app.get_webview_window("main") {
                passthrough::install(&window, hit_store_for_setup.clone());
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

            // 按键监听由 accessibility 模块按权限状态启停 —— 启动时若已授权立即起，否则等用户授权后由 watcher 自动起。
            if accessibility::current_status().granted {
                listener_handle_for_setup.ensure_running(app.handle());
            }
            // 1Hz 权限轮询：状态翻转时 emit + 启停 listener；ExitRequested 通过 stop 信号退出
            accessibility::start_watcher(
                app.handle().clone(),
                listener_handle_for_setup.clone(),
                accessibility_stop_for_setup.clone(),
            );

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            set_click_through,
            set_always_on_top,
            get_active_app,
            open_settings_window,
            close_settings_window,
            accessibility::accessibility_status,
            accessibility::key_counter_listening,
            passthrough::register_hit_region,
            passthrough::unregister_hit_region,
            passthrough::clear_hit_regions,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(move |handle, event| {
        if matches!(event, RunEvent::ExitRequested { .. } | RunEvent::Exit) {
            active_app_stop_for_exit.store(true, Ordering::Relaxed);
            accessibility_stop_for_exit.store(true, Ordering::Relaxed);
            listener_handle_for_exit.stop();
            if let Some(window) = handle.get_webview_window("main") {
                passthrough::uninstall(&window);
            }
        }
    });
}
