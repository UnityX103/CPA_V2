mod accessibility;
mod active_app;
mod key_counter;
mod scaled_window;
mod video_files;
mod window_helpers;

use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tauri::{
    Emitter, LogicalSize, Manager, PhysicalPosition, RunEvent, WebviewUrl, WebviewWindowBuilder,
};

#[tauri::command]
fn set_main_window_pinned(app: tauri::AppHandle, on_top: bool) -> Result<(), String> {
    let main = app
        .get_webview_window("main")
        .ok_or_else(|| "main window not found".to_string())?;
    let (tx, rx) = std::sync::mpsc::channel();
    app.run_on_main_thread(move || {
        let result = main
            .set_always_on_top(on_top)
            .map_err(|e| e.to_string())
            .and_then(|()| window_helpers::set_always_on_top_native(&main, on_top));
        if result.is_ok() {
            accessibility::mark_main_pin_succeeded();
        }
        let _ = tx.send(result);
    })
    .map_err(|e| e.to_string())?;
    rx.recv()
        .map_err(|e| format!("main window pin command did not complete: {e}"))?
}

#[tauri::command]
fn reassert_window_always_on_top(app: tauri::AppHandle, label: String) -> Result<(), String> {
    let window = app
        .get_webview_window(&label)
        .ok_or_else(|| format!("{label} window not found"))?;
    let (tx, rx) = std::sync::mpsc::channel();
    app.run_on_main_thread(move || {
        let result = window_helpers::set_always_on_top_native(&window, true);
        let _ = tx.send(result);
    })
    .map_err(|e| e.to_string())?;
    rx.recv()
        .map_err(|e| format!("window always-on-top reassert command did not complete: {e}"))?
}

#[tauri::command]
fn set_input_counter_window_pinned(app: tauri::AppHandle, on_top: bool) -> Result<(), String> {
    let window = app
        .get_webview_window("input-counter")
        .ok_or_else(|| "input-counter window not found".to_string())?;
    let (tx, rx) = std::sync::mpsc::channel();
    app.run_on_main_thread(move || {
        let result = window
            .set_always_on_top(on_top)
            .map_err(|e| e.to_string())
            .and_then(|()| window_helpers::set_always_on_top_native(&window, on_top));
        let _ = tx.send(result);
    })
    .map_err(|e| e.to_string())?;
    rx.recv()
        .map_err(|e| format!("input-counter pin command did not complete: {e}"))?
}

#[tauri::command]
fn get_active_app() -> Option<active_app::ActiveAppInfo> {
    active_app::current_active_app()
}

#[derive(Debug, Serialize, Clone, Copy)]
#[serde(rename_all = "camelCase")]
struct VideoScreenRect {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

#[derive(Debug, Clone, Copy)]
struct MatchRect {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

impl MatchRect {
    fn from_video_rect(rect: VideoScreenRect) -> Self {
        Self {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
        }
    }

    fn center(&self) -> (f64, f64) {
        (self.x + self.width / 2.0, self.y + self.height / 2.0)
    }
}

fn overlap_area(a: MatchRect, b: MatchRect) -> f64 {
    let left = a.x.max(b.x);
    let top = a.y.max(b.y);
    let right = (a.x + a.width).min(b.x + b.width);
    let bottom = (a.y + a.height).min(b.y + b.height);
    let width = (right - left).max(0.0);
    let height = (bottom - top).max(0.0);
    width * height
}

fn contains_point(rect: MatchRect, point: (f64, f64)) -> bool {
    point.0 >= rect.x
        && point.0 <= rect.x + rect.width
        && point.1 >= rect.y
        && point.1 <= rect.y + rect.height
}

fn monitor_video_rect(monitor: &tauri::Monitor) -> VideoScreenRect {
    let position = monitor.position();
    let size = monitor.size();
    let scale = monitor.scale_factor();
    VideoScreenRect {
        x: position.x as f64 / scale,
        y: position.y as f64 / scale,
        width: size.width as f64 / scale,
        height: size.height as f64 / scale,
    }
}

fn monitor_physical_rect(monitor: &tauri::Monitor) -> MatchRect {
    let position = monitor.position();
    let size = monitor.size();
    MatchRect {
        x: position.x as f64,
        y: position.y as f64,
        width: size.width as f64,
        height: size.height as f64,
    }
}

fn best_monitor_rect_for_bounds(
    bounds: active_app::AppWindowBounds,
    monitors: &[tauri::Monitor],
) -> Option<VideoScreenRect> {
    let target = MatchRect {
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
    };
    let target_center = target.center();

    monitors
        .iter()
        .map(|monitor| {
            let physical = monitor_physical_rect(monitor);
            let logical = MatchRect::from_video_rect(monitor_video_rect(monitor));
            let physical_score = overlap_area(target, physical)
                + if contains_point(physical, target_center) {
                    1.0
                } else {
                    0.0
                };
            let logical_score = overlap_area(target, logical)
                + if contains_point(logical, target_center) {
                    1.0
                } else {
                    0.0
                };
            (
                physical_score.max(logical_score),
                monitor_video_rect(monitor),
            )
        })
        .max_by(|(a, _), (b, _)| a.total_cmp(b))
        .filter(|(score, _)| *score > 0.0)
        .map(|(_, rect)| rect)
}

fn fallback_video_screen_rect(app: &tauri::AppHandle) -> Result<VideoScreenRect, String> {
    if let Some(main) = app.get_webview_window("main") {
        if let Some(monitor) = main.current_monitor().map_err(|e| e.to_string())? {
            return Ok(monitor_video_rect(&monitor));
        }
    }
    let monitor = app
        .primary_monitor()
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "no monitor available".to_string())?;
    Ok(monitor_video_rect(&monitor))
}

#[tauri::command]
fn pomodoro_video_screen_rect(app: tauri::AppHandle) -> Result<VideoScreenRect, String> {
    let monitors = app.available_monitors().map_err(|e| e.to_string())?;
    if let Some(bounds) = active_app::current_active_app_window_bounds() {
        if let Some(rect) = best_monitor_rect_for_bounds(bounds, &monitors) {
            return Ok(rect);
        }
    }
    fallback_video_screen_rect(&app)
}

const SETTINGS_W: f64 = 460.0;
const SETTINGS_H: f64 = 440.0;
const SETTINGS_MIN_W: f64 = 360.0;
const SETTINGS_MIN_H: f64 = 320.0;
const INPUT_COUNTER_W: f64 = 128.0;
const INPUT_COUNTER_H: f64 = 84.0;
const TODAY_CHECKIN_W: f64 = 278.0;
const TODAY_CHECKIN_H: f64 = 289.0;
const CHECKIN_EDITOR_W: f64 = 460.0;
const CHECKIN_EDITOR_H: f64 = 898.0;

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
    let (x, y) = window_helpers::compute_centered_origin(
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
        .min_inner_size(SETTINGS_MIN_W, SETTINGS_MIN_H)
        .resizable(true)
        .transparent(true)
        .decorations(false)
        .shadow(false)
        .skip_taskbar(true)
        .visible(false)
        .build()?;
    window_helpers::install_first_mouse_only(&w);

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

fn build_input_counter_window_hidden(
    app: &tauri::AppHandle,
) -> Result<tauri::WebviewWindow, tauri::Error> {
    let url = WebviewUrl::App("index.html?window=input-counter".into());
    let w = WebviewWindowBuilder::new(app, "input-counter", url)
        .title("按键统计")
        .inner_size(INPUT_COUNTER_W, INPUT_COUNTER_H)
        .resizable(false)
        .transparent(true)
        .decorations(false)
        .shadow(false)
        .skip_taskbar(true)
        .visible(false)
        .always_on_top(false)
        .build()?;
    window_helpers::install_first_mouse_only(&w);

    let w_for_hide = w.clone();
    w.on_window_event(move |event| {
        if let tauri::WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            let _ = w_for_hide.hide();
        }
    });

    Ok(w)
}

fn build_today_checkin_window_hidden(
    app: &tauri::AppHandle,
) -> Result<tauri::WebviewWindow, tauri::Error> {
    let url = WebviewUrl::App("index.html?window=today-checkin".into());
    let w = WebviewWindowBuilder::new(app, "today-checkin", url)
        .title("今日打卡")
        .inner_size(TODAY_CHECKIN_W, TODAY_CHECKIN_H)
        .resizable(false)
        .transparent(true)
        .decorations(false)
        .shadow(false)
        .skip_taskbar(true)
        .visible(false)
        .always_on_top(true)
        .build()?;
    window_helpers::install_first_mouse_only(&w);
    let _ = window_helpers::set_always_on_top_native(&w, true);

    let w_for_hide = w.clone();
    w.on_window_event(move |event| {
        if let tauri::WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            let _ = w_for_hide.hide();
        }
    });

    Ok(w)
}

fn build_checkin_editor_window_hidden(
    app: &tauri::AppHandle,
) -> Result<tauri::WebviewWindow, tauri::Error> {
    let url = WebviewUrl::App("index.html?window=checkin-editor".into());
    let w = WebviewWindowBuilder::new(app, "checkin-editor", url)
        .title("打卡计划")
        .inner_size(CHECKIN_EDITOR_W, CHECKIN_EDITOR_H)
        .resizable(false)
        .transparent(true)
        .decorations(false)
        .shadow(false)
        .skip_taskbar(true)
        .visible(false)
        .always_on_top(true)
        .build()?;
    window_helpers::install_first_mouse_only(&w);
    let _ = window_helpers::set_always_on_top_native(&w, true);

    let w_for_hide = w.clone();
    w.on_window_event(move |event| {
        if let tauri::WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            let _ = w_for_hide.hide();
        }
    });

    Ok(w)
}

fn install_main_window_exit_on_close(app: tauri::AppHandle) {
    let Some(main) = app.get_webview_window("main") else {
        return;
    };
    let app_for_close = app.clone();
    main.on_window_event(move |event| {
        if let tauri::WindowEvent::CloseRequested { .. } = event {
            app_for_close.exit(0);
        }
    });
}

pub(crate) async fn open_settings_window_impl(app: tauri::AppHandle) -> Result<(), String> {
    let w = app.get_webview_window("settings").ok_or_else(|| {
        "settings window not built — setup() probably failed; check stderr".to_string()
    })?;
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

#[tauri::command]
async fn show_input_counter_window(app: tauri::AppHandle) -> Result<(), String> {
    let w = app.get_webview_window("input-counter").ok_or_else(|| {
        "input-counter window not built — setup() probably failed; check stderr".to_string()
    })?;
    w.show().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn hide_input_counter_window(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window("input-counter") {
        w.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn resize_input_counter_window(app: tauri::AppHandle, height: f64) -> Result<(), String> {
    let Some(w) = app.get_webview_window("input-counter") else {
        return Ok(());
    };
    let height = height.max(INPUT_COUNTER_H);
    w.set_size(LogicalSize::new(INPUT_COUNTER_W, height))
        .map_err(|e| e.to_string())?;
    Ok(())
}

fn show_existing_window(app: tauri::AppHandle, label: &str) -> Result<(), String> {
    let w = app.get_webview_window(label).ok_or_else(|| {
        format!("{label} window not built — setup() probably failed; check stderr")
    })?;
    let _ = window_helpers::set_always_on_top_native(&w, true);
    w.show().map_err(|e| e.to_string())?;
    w.set_focus().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn open_today_checkin_window(app: tauri::AppHandle) -> Result<(), String> {
    show_existing_window(app, "today-checkin")
}

#[tauri::command]
async fn open_checkin_editor_window(app: tauri::AppHandle) -> Result<(), String> {
    show_existing_window(app, "checkin-editor")
}

#[tauri::command]
async fn close_today_checkin_window(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window("today-checkin") {
        w.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn close_checkin_editor_window(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window("checkin-editor") {
        w.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn resize_scaled_window(
    app: tauri::AppHandle,
    args: scaled_window::ResizeScaledWindowArgs,
) -> Result<(), String> {
    scaled_window::resize_scaled_window(app, args)
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

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_persisted_scope::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .manage::<std::sync::Arc<accessibility::ListenerHandle>>(listener_handle_for_manage)
        .setup(move |app| {
            // 在主线程构建隐藏的设置窗口 + 装 first-mouse hook。点齿轮时只做
            // 重定位 + show + focus（Tauri-marshaled，线程安全）。失败仅打日志。
            if let Err(e) = build_settings_window_hidden(app.handle()) {
                eprintln!("[setup] build_settings_window_hidden failed: {e}");
            }
            if let Err(e) = build_input_counter_window_hidden(app.handle()) {
                eprintln!("[setup] build_input_counter_window_hidden failed: {e}");
            }
            if let Err(e) = build_today_checkin_window_hidden(app.handle()) {
                eprintln!("[setup] build_today_checkin_window_hidden failed: {e}");
            }
            if let Err(e) = build_checkin_editor_window_hidden(app.handle()) {
                eprintln!("[setup] build_checkin_editor_window_hidden failed: {e}");
            }
            install_main_window_exit_on_close(app.handle().clone());
            // Focus restorer: 主窗口拖/resize 末尾把 key 还回 settings (若可见)。
            // 配合 build_settings_window_hidden 一起完成 settings 窗口的 lifecycle 闭环。
            if let Some(window) = app.get_webview_window("main") {
                window_helpers::install_focus_restorer(&window, app.handle().clone());
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
                        (Some(a), Some(b)) => a != b,
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
                            window_helpers::install_first_mouse_only(&w);
                        }
                        Err(e) => eprintln!(
                            "[e2e stub] WebviewWindowBuilder::build failed; \
                             regression net is not hot, test will pass vacuously: {e}"
                        ),
                    }
                });
            }

            // Focus-restore E2E 触发桩：仅在集成测试通过 CPA_E2E_TRIGGER_FOCUS_RESTORE=1
            // 启动二进制时进入。
            //
            // 注：macOS 不会让 cargo-test 派生的子进程拿前台焦点（is_focused() 在 bg
            // 进程里永远 false），所以测试不能用 is_focused 验证状态转移。改为让 fix
            // 在 observer 回调内 eprintln 一个 marker，集成测试以 marker 出现/缺失为信号。
            //
            // 桩职责很轻：show settings（observer 需要 settings 可见才动作） → 程序性地
            // 移动主窗口 1 像素（触发 NSWindowDidMoveNotification）→ 给 observer 留时间
            // 跑回调。tests/focus_restore_regression.rs 解析 stderr。
            if std::env::var("CPA_E2E_TRIGGER_FOCUS_RESTORE").is_ok() {
                let handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    std::thread::sleep(Duration::from_millis(1500));
                    eprintln!("[e2e focus] setup-complete");

                    let Some(main) = handle.get_webview_window("main") else {
                        eprintln!("[e2e focus] main window not found; aborting");
                        return;
                    };
                    let Some(settings) = handle.get_webview_window("settings") else {
                        eprintln!("[e2e focus] settings window not found; aborting");
                        return;
                    };

                    // observer 只在 settings 可见时还焦；先让 settings 可见
                    let _ = settings.show();
                    std::thread::sleep(Duration::from_millis(200));
                    eprintln!("[e2e focus] settings-shown");

                    // 程序性移动主窗口，然后手动 post NSWindowDidMoveNotification。
                    // Tao 的 set_position 底层调用 setFrameTopLeftPoint:，该方法不触发
                    // NSWindowDelegate.windowDidMove:，因此 Tauri 不派发 WindowEvent::Moved。
                    // 我们的 install_focus_restorer_impl 监听 NSNotificationCenter，
                    // 所以手动 post 是触发 observer 的可靠方式。
                    if let Ok(pos) = main.outer_position() {
                        let _ = main.set_position(PhysicalPosition::new(pos.x + 1, pos.y));
                    }
                    // Post NSWindowDidMoveNotification so the observer fires.
                    // This dispatches to the main thread asynchronously (via dispatch_async_f),
                    // so we wait 300ms before logging main-moved to give the main queue
                    // time to process the notification and run the observer block.
                    #[cfg(target_os = "macos")]
                    window_helpers::post_did_move_notification_for_testing(&main);
                    #[cfg(target_os = "macos")]
                    std::thread::sleep(Duration::from_millis(300));
                    eprintln!("[e2e focus] main-moved");

                    // 给 observer 回调留时间跑（500ms 足够）
                    std::thread::sleep(Duration::from_millis(500));
                    eprintln!("[e2e focus] done");
                });
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            set_main_window_pinned,
            reassert_window_always_on_top,
            set_input_counter_window_pinned,
            get_active_app,
            pomodoro_video_screen_rect,
            open_settings_window,
            close_settings_window,
            show_input_counter_window,
            hide_input_counter_window,
            resize_input_counter_window,
            open_today_checkin_window,
            open_checkin_editor_window,
            close_today_checkin_window,
            close_checkin_editor_window,
            resize_scaled_window,
            accessibility::accessibility_status,
            accessibility::open_accessibility_settings,
            accessibility::key_counter_listening,
            accessibility::key_counter_health,
            accessibility::restart_key_counter_listener,
            accessibility::request_accessibility_permission,
            video_files::validate_custom_video_path,
            video_files::prepare_custom_alpha_video_path,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(move |_handle, event| {
        if matches!(event, RunEvent::ExitRequested { .. } | RunEvent::Exit) {
            active_app_stop_for_exit.store(true, Ordering::Relaxed);
            accessibility_stop_for_exit.store(true, Ordering::Relaxed);
            listener_handle_for_exit.stop();
        }
    });
}
