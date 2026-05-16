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

/// 在 setup() 内同步构建（隐藏的）设置窗口并装好 first-mouse hook。
/// 调用者必须在主线程（典型上下文：`setup` 闭包内）。失败仅 eprintln，
/// 让主流程能继续；用户点齿轮时 open_settings_window_impl 会返回明确 Err。
fn build_settings_window_hidden(
    app: &tauri::AppHandle,
) -> Result<tauri::WebviewWindow, tauri::Error> {
    let url = WebviewUrl::App("index.html?window=settings".into());
    let w = WebviewWindowBuilder::new(app, "settings", url)
        .title("设置")
        .inner_size(SETTINGS_W, SETTINGS_H)
        .resizable(false)
        .transparent(true)
        .decorations(false)
        .always_on_top(true)
        .shadow(false)
        .skip_taskbar(true)
        .visible(false)
        .build()?;
    passthrough::install_first_mouse_only(&w);

    // 拦截关闭事件：macOS Cmd-W / 应用菜单 / 任何 performClose: 路径默认会真正销毁
    // NSWindow，之后 get_webview_window("settings") 永远返回 None，齿轮按钮变成死按钮。
    // prevent_close + hide 让窗口对象在 Tauri 的窗口管理器里永生，open_settings_window_impl
    // 始终能拿到。
    let w_for_hide = w.clone();
    w.on_window_event(move |event| {
        if let tauri::WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            let _ = w_for_hide.hide();
        }
    });

    Ok(w)
}

pub(crate) async fn open_settings_window_impl(
    app: tauri::AppHandle,
) -> Result<(), String> {
    let w = app
        .get_webview_window("settings")
        .ok_or_else(|| "settings window not built — setup() probably failed; check stderr".to_string())?;
    if let Ok(pos) = settings_center_position(&app) {
        let _ = w.set_position(pos);
    }
    w.show().map_err(|e| e.to_string())?;
    w.set_focus().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn open_settings_window(app: tauri::AppHandle) -> Result<(), String> {
    open_settings_window_impl(app).await
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

    let hit_store = std::sync::Arc::new(passthrough::HitRegionStore::new());
    let hit_store_for_setup = hit_store.clone();
    let hit_store_for_manage = hit_store.clone();

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .manage::<std::sync::Arc<passthrough::HitRegionStore>>(hit_store_for_manage)
        .setup(move |app| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_always_on_top(true);
            }
            if let Some(window) = app.get_webview_window("main") {
                passthrough::install(&window, hit_store_for_setup.clone());
            }
            // 在主线程构建隐藏的设置窗口 + 装 first-mouse hook。点齿轮时只做
            // 重定位 + show + focus（Tauri-marshaled，线程安全）。失败仅打日志。
            if let Err(e) = build_settings_window_hidden(app.handle()) {
                eprintln!("[setup] build_settings_window_hidden failed: {e}");
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

            // E2E 触发桩：仅在集成测试通过 CPA_E2E_TRIGGER_SETTINGS=1 启动二进制时进入。
            // 复现"在 tokio worker 上直接调 install_first_mouse_only"这条 pre-fix 崩溃路径。
            // 故意不依赖 open_settings_window_impl —— 那条路在 Commit B 后已绕开 AppKit；
            // 此桩测的是"若未来有人再误把 AppKit 调用拿到非主线程"的失效模式：
            //   pre-fix (new_unchecked)  → WebKit BREAKPOINT → 整个进程 SIGTRAP
            //   post-fix (new().expect) → tokio 任务 panic 被截获 → 进程存活
            if std::env::var("CPA_E2E_TRIGGER_SETTINGS").is_ok() {
                let handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    let url = WebviewUrl::App("index.html?window=settings-e2e".into());
                    match WebviewWindowBuilder::new(&handle, "settings-e2e", url)
                        .visible(false)
                        .build()
                    {
                        Ok(w) => {
                            // Marker BEFORE the install call — install panics via .expect() on
                            // tokio worker post-fix, so anything after the call is unreachable.
                            // Test harness asserts this marker appears in stderr; absence means
                            // the trigger桩 short-circuited before exercising the crash path.
                            eprintln!("[e2e stub] reached install_first_mouse_only call site");
                            passthrough::install_first_mouse_only(&w);
                        }
                        Err(e) => eprintln!(
                            "[e2e stub] WebviewWindowBuilder::build failed; \
                             regression net is not hot, test will pass vacuously: {e}"
                        ),
                    }
                });
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            set_click_through,
            set_always_on_top,
            get_active_app,
            open_settings_window,
            close_settings_window,
            passthrough::register_hit_region,
            passthrough::unregister_hit_region,
            passthrough::clear_hit_regions,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(move |handle, event| {
        if matches!(event, RunEvent::ExitRequested { .. } | RunEvent::Exit) {
            active_app_stop_for_exit.store(true, Ordering::Relaxed);
            key_counter_stop_for_exit.store(true, Ordering::Relaxed);
            if let Some(window) = handle.get_webview_window("main") {
                passthrough::uninstall(&window);
            }
        }
    });
}
