//! 辅助功能权限闸门：检测 → 暴露给前端 → 控制 key_counter listener 启停。
//! macOS 用 AXIsProcessTrusted；其它平台恒为 granted=true（不需要 TCC 类权限）。
//!
//! 详细设计见 docs/superpowers/specs/2026-05-16-key-counter-accessibility-permission-design.md。

use serde::Serialize;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
#[cfg(target_os = "macos")]
use std::{path::PathBuf, process::Command};
#[cfg(target_os = "macos")]
use tauri::Manager;
use tauri::{AppHandle, Emitter};

#[cfg(target_os = "macos")]
mod macos;
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
mod stub;
#[cfg(target_os = "windows")]
mod windows;

#[derive(Default)]
struct ListenerState {
    stop: Option<Arc<AtomicBool>>,
    running: bool,
    last_start_error: Option<String>,
    last_started_at_ms: Option<u64>,
    last_stopped_at_ms: Option<u64>,
}

fn listener_slot_occupied(state: &ListenerState) -> bool {
    state.running || state.stop.is_some()
}

/// Holds the current key_counter listener state. Stop flags are replaced
/// atomically when (re)spawning.
#[derive(Default)]
pub struct ListenerHandle {
    inner: Mutex<ListenerState>,
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub struct KeyCounterHealth {
    pub permission_granted: bool,
    pub platform: &'static str,
    pub listener_running: bool,
    pub last_start_error: Option<String>,
    pub last_started_at_ms: Option<u64>,
    pub last_stopped_at_ms: Option<u64>,
    pub bundle_identifier: Option<String>,
    pub executable_path: Option<String>,
    pub code_sign_identifier: Option<String>,
}

impl ListenerHandle {
    pub fn is_running(&self) -> bool {
        self.inner.lock().unwrap().running
    }

    #[allow(dead_code)]
    pub fn health_snapshot(&self) -> KeyCounterHealth {
        self.health_from_status(current_status())
    }

    #[allow(dead_code)]
    fn health_from_status(&self, status: AccessibilityStatus) -> KeyCounterHealth {
        let (listener_running, last_start_error, last_started_at_ms, last_stopped_at_ms) = {
            let state = self.inner.lock().unwrap();
            (
                state.running,
                state.last_start_error.clone(),
                state.last_started_at_ms,
                state.last_stopped_at_ms,
            )
        };

        KeyCounterHealth {
            permission_granted: status.granted,
            platform: status.platform,
            listener_running,
            last_start_error,
            last_started_at_ms,
            last_stopped_at_ms,
            bundle_identifier: bundle_identifier(),
            executable_path: executable_path(),
            code_sign_identifier: code_sign_identifier(),
        }
    }

    #[allow(dead_code)]
    fn record_start_error(&self, error: String) {
        let mut guard = self.inner.lock().unwrap();
        guard.stop = None;
        guard.running = false;
        guard.last_start_error = Some(error);
        guard.last_stopped_at_ms = Some(now_ms());
    }

    /// Spawn a listener if not already running. Idempotent.
    pub fn ensure_running(&self, app: &AppHandle) {
        // Phase 1: commit the new stop flag inside the lock and release before spawning.
        let stop = {
            let mut guard = self.inner.lock().unwrap();
            if listener_slot_occupied(&guard) {
                return;
            }
            let stop = Arc::new(AtomicBool::new(false));
            guard.stop = Some(stop.clone());
            guard.last_start_error = None;
            stop
        };
        // Phase 2: spawn outside the lock so a long thread-spawn or future re-entry
        // through the same handle cannot deadlock against this Mutex.
        let app_handle = app.clone();
        let result = crate::key_counter::spawn_listener(stop.clone(), move |payload| {
            let _ = app_handle.emit("input-pressed", &payload);
            if payload.kind == "keyboard" {
                if let Some(code) = payload.code {
                    let _ = app_handle.emit("key-pressed", code);
                }
            }
        });

        match result {
            Ok(()) => {
                let mut guard = self.inner.lock().unwrap();
                if guard
                    .stop
                    .as_ref()
                    .is_some_and(|current| Arc::ptr_eq(current, &stop))
                {
                    guard.running = true;
                    guard.last_start_error = None;
                    guard.last_started_at_ms = Some(now_ms());
                }
            }
            Err(error) => {
                eprintln!("{error}");
                let mut guard = self.inner.lock().unwrap();
                if guard
                    .stop
                    .as_ref()
                    .is_some_and(|current| Arc::ptr_eq(current, &stop))
                {
                    guard.stop = None;
                    guard.running = false;
                    guard.last_start_error = Some(error);
                    guard.last_stopped_at_ms = Some(now_ms());
                }
            }
        }

        emit_health(app, self);
    }

    /// Signal the running listener to stop (no-op if not running).
    /// `is_running()` returns false immediately, but the listener thread may
    /// remain alive for up to ~100ms (the CGEventTap polling slice). Callers
    /// that re-spawn via `ensure_running` right after `stop()` can briefly
    /// have two ListenOnly taps installed; both emit `key-pressed`, so any
    /// keys pressed in that window may double-count.
    pub fn stop(&self) {
        let mut guard = self.inner.lock().unwrap();
        if let Some(stop) = guard.stop.take() {
            stop.store(true, Ordering::Relaxed);
            guard.running = false;
            guard.last_stopped_at_ms = Some(now_ms());
        } else if guard.running {
            guard.running = false;
            guard.last_stopped_at_ms = Some(now_ms());
        }
    }
}

fn emit_health(app: &AppHandle, handle: &ListenerHandle) {
    let _ = app.emit("key-counter-health-changed", handle.health_snapshot());
}

#[cfg(test)]
impl ListenerHandle {
    fn record_start_error_for_test(&self, error: String) {
        self.record_start_error(error);
    }

    fn mark_running_for_test(&self) {
        let mut guard = self.inner.lock().unwrap();
        guard.stop = Some(Arc::new(AtomicBool::new(false)));
        guard.running = true;
        guard.last_start_error = None;
        guard.last_started_at_ms = Some(now_ms());
    }

    fn mark_starting_for_test(&self) {
        let mut guard = self.inner.lock().unwrap();
        guard.stop = Some(Arc::new(AtomicBool::new(false)));
        guard.running = false;
        guard.last_start_error = None;
    }

    fn listener_slot_occupied_for_test(&self) -> bool {
        let guard = self.inner.lock().unwrap();
        listener_slot_occupied(&guard)
    }

    fn health_snapshot_for_test(&self, status: AccessibilityStatus) -> KeyCounterHealth {
        self.health_from_status(status)
    }
}

#[cfg(target_os = "macos")]
#[allow(dead_code)]
fn app_bundle_root() -> Option<PathBuf> {
    let current_exe = std::env::current_exe().ok()?;
    current_exe
        .ancestors()
        .find(|path| path.extension().is_some_and(|extension| extension == "app"))
        .map(|path| path.to_path_buf())
}

#[cfg(not(target_os = "macos"))]
#[allow(dead_code)]
fn app_bundle_root() -> Option<std::path::PathBuf> {
    None
}

#[cfg(target_os = "macos")]
#[allow(dead_code)]
fn bundle_identifier() -> Option<String> {
    let info_plist = app_bundle_root()?.join("Contents").join("Info.plist");
    let output = Command::new("/usr/libexec/PlistBuddy")
        .args(["-c", "Print :CFBundleIdentifier"])
        .arg(info_plist)
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let identifier = String::from_utf8(output.stdout).ok()?.trim().to_string();
    (!identifier.is_empty()).then_some(identifier)
}

#[cfg(not(target_os = "macos"))]
#[allow(dead_code)]
fn bundle_identifier() -> Option<String> {
    None
}

#[cfg(target_os = "macos")]
#[allow(dead_code)]
fn executable_path() -> Option<String> {
    std::env::current_exe()
        .ok()
        .and_then(|path| path.into_os_string().into_string().ok())
}

#[cfg(not(target_os = "macos"))]
#[allow(dead_code)]
fn executable_path() -> Option<String> {
    None
}

#[cfg(target_os = "macos")]
#[allow(dead_code)]
fn code_sign_identifier() -> Option<String> {
    let current_exe = std::env::current_exe().ok()?;
    let output = Command::new("codesign")
        .args(["-dv", "--verbose=4"])
        .arg(current_exe)
        .output()
        .ok()?;
    let stderr = String::from_utf8(output.stderr).ok()?;
    stderr.lines().find_map(|line| {
        line.trim()
            .strip_prefix("Identifier=")
            .map(str::trim)
            .filter(|identifier| !identifier.is_empty())
            .map(ToOwned::to_owned)
    })
}

#[cfg(not(target_os = "macos"))]
#[allow(dead_code)]
fn code_sign_identifier() -> Option<String> {
    None
}

#[derive(Clone, Copy, Debug, Serialize)]
pub struct AccessibilityStatus {
    pub granted: bool,
    pub platform: &'static str,
}

pub fn current_status() -> AccessibilityStatus {
    #[cfg(target_os = "macos")]
    {
        AccessibilityStatus {
            granted: macos::is_trusted(),
            platform: "macos",
        }
    }
    #[cfg(target_os = "windows")]
    {
        AccessibilityStatus {
            granted: true,
            platform: "windows",
        }
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        AccessibilityStatus {
            granted: true,
            platform: "other",
        }
    }
}

#[tauri::command]
pub fn accessibility_status() -> AccessibilityStatus {
    current_status()
}

#[tauri::command]
#[allow(unreachable_code)]
pub fn open_accessibility_settings(app: AppHandle) -> Result<(), String> {
    #[cfg(not(target_os = "macos"))]
    let _ = &app;

    #[cfg(target_os = "macos")]
    {
        let app_for_yield = app.clone();
        app.run_on_main_thread(move || {
            set_permission_windows_always_on_top(&app_for_yield, false);
            macos::deactivate_app();
            if let Err(e) = macos::open_settings() {
                eprintln!("[accessibility] open settings failed: {e}");
            }
        })
        .map_err(|e| e.to_string())?;
        restore_permission_windows_when_done(app);
        return Ok(());
    }
    #[cfg(target_os = "windows")]
    return windows::open_settings();
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    return stub::open_settings();
}

#[tauri::command]
pub fn key_counter_listening(handle: tauri::State<'_, Arc<ListenerHandle>>) -> bool {
    handle.is_running()
}

#[tauri::command]
pub fn key_counter_health(handle: tauri::State<'_, Arc<ListenerHandle>>) -> KeyCounterHealth {
    handle.health_snapshot()
}

#[tauri::command]
pub fn restart_key_counter_listener(
    app: AppHandle,
    handle: tauri::State<'_, Arc<ListenerHandle>>,
) -> KeyCounterHealth {
    if !current_status().granted {
        return handle.health_snapshot();
    }
    handle.ensure_running(&app);
    handle.health_snapshot()
}

use std::time::Duration;

#[cfg(target_os = "macos")]
const PERMISSION_UI_WINDOW_LABELS: &[&str] = &["main", "settings"];

#[cfg(target_os = "macos")]
fn set_permission_window_always_on_top(app: &AppHandle, label: &str, on_top: bool) {
    if let Some(window) = app.get_webview_window(label) {
        if let Err(e) = window.set_always_on_top(on_top) {
            eprintln!("[accessibility] set_always_on_top({on_top}) for {label} failed: {e}");
        }
    }
}

#[cfg(target_os = "macos")]
fn set_permission_windows_always_on_top(app: &AppHandle, on_top: bool) {
    for label in PERMISSION_UI_WINDOW_LABELS {
        set_permission_window_always_on_top(app, label, on_top);
    }
}

#[cfg(target_os = "macos")]
fn restore_permission_windows_when_done(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let deadline = std::time::Instant::now() + Duration::from_secs(30);
        loop {
            // AXIsProcessTrusted is thread-safe (no state mutation, no UI interaction);
            // safe to poll from this tokio worker thread.
            if current_status().granted {
                break;
            }
            if std::time::Instant::now() >= deadline {
                break;
            }
            tokio::time::sleep(Duration::from_millis(200)).await;
        }
        set_permission_windows_always_on_top(&app, true);
        PROMPT_IN_FLIGHT.store(false, Ordering::Release);
    });
}

/// Spawn the 1Hz watcher thread. Emits `accessibility-permission-changed`
/// on every state flip and starts/stops the listener through `handle`.
pub fn start_watcher(app: AppHandle, handle: Arc<ListenerHandle>, stop: Arc<AtomicBool>) {
    std::thread::spawn(move || {
        let mut last = current_status().granted;
        loop {
            // 拆成 10×100ms：让 stop 信号最多 100ms 内被观察到（沿用 active_app 同款模式）
            for _ in 0..10 {
                if stop.load(Ordering::Relaxed) {
                    return;
                }
                std::thread::sleep(Duration::from_millis(100));
            }
            let status = current_status();
            if status.granted != last {
                let _ = app.emit(
                    "accessibility-permission-changed",
                    AccessibilityChangedPayload {
                        granted: status.granted,
                        platform: status.platform,
                    },
                );
                if status.granted {
                    handle.ensure_running(&app);
                } else {
                    handle.stop();
                    emit_health(&app, &handle);
                }
                last = status.granted;
            }
        }
    });
}

#[derive(Clone, Copy, Debug, Serialize)]
struct AccessibilityChangedPayload {
    granted: bool,
    platform: &'static str,
}

/// 防抖：同一时刻只允许一次 prompt 飞行；第二次点击直接 Ok(()) 返回，避免 restore 任务堆叠
/// 与 always_on_top 抖动。请求结束（granted=true 翻转或 30s 超时）后重置为 false。
#[cfg(target_os = "macos")]
static PROMPT_IN_FLIGHT: AtomicBool = AtomicBool::new(false);
static MAIN_PIN_GENERATION: AtomicU64 = AtomicU64::new(0);

pub(crate) fn mark_main_pin_succeeded() -> u64 {
    MAIN_PIN_GENERATION.fetch_add(1, Ordering::AcqRel) + 1
}

#[cfg(target_os = "macos")]
fn main_pin_generation() -> u64 {
    MAIN_PIN_GENERATION.load(Ordering::Acquire)
}

#[cfg(target_os = "macos")]
fn snapshot_main_pin_state(app: &AppHandle) -> (u64, bool) {
    loop {
        let before = main_pin_generation();
        let was_main_on_top = if let Some(main) = app.get_webview_window("main") {
            main.is_always_on_top().unwrap_or(false)
        } else {
            false
        };
        let after = main_pin_generation();
        if before == after {
            return (before, was_main_on_top);
        }
        std::hint::spin_loop();
    }
}

#[tauri::command]
pub async fn request_accessibility_permission(app: AppHandle) -> Result<(), String> {
    #[cfg(not(target_os = "macos"))]
    {
        drop(app);
        return Ok(());
    }

    #[cfg(target_os = "macos")]
    {
        if PROMPT_IN_FLIGHT.swap(true, Ordering::AcqRel) {
            return Ok(());
        }

        // 让位 + prompt 全部在同一 run_on_main_thread 闭包内执行，保证顺序：
        // main/settings set_always_on_top(false) → deactivate → prompt，
        // 避免权限弹窗或系统设置被当前置顶窗口挡住，同时不覆盖用户在等待期间
        // 对 HApJ0 置顶状态的后续切换。
        let (pin_generation, was_main_on_top) = snapshot_main_pin_state(&app);
        let app_for_yield = app.clone();
        if let Err(e) = app.run_on_main_thread(move || {
            if main_pin_generation() == pin_generation {
                if let Some(main) = app_for_yield.get_webview_window("main") {
                    if let Err(e) = main.set_always_on_top(false) {
                        eprintln!("[accessibility] set_always_on_top(false) 失败：{e}");
                    }
                }
            }
            set_permission_window_always_on_top(&app_for_yield, "settings", false);
            macos::deactivate_app();
            macos::prompt();
        }) {
            PROMPT_IN_FLIGHT.store(false, Ordering::Release);
            return Err(e.to_string());
        }

        // 30s 倒计时 或 granted 翻转，先到先恢复
        let restore_app = app.clone();
        tauri::async_runtime::spawn(async move {
            let deadline = std::time::Instant::now() + Duration::from_secs(30);
            loop {
                // AXIsProcessTrusted is thread-safe (no state mutation, no UI interaction);
                // safe to poll from this tokio worker thread.
                if current_status().granted {
                    break;
                }
                if std::time::Instant::now() >= deadline {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(200)).await;
            }
            let restore_app_for_main = restore_app.clone();
            if let Err(e) = restore_app.run_on_main_thread(move || {
                if main_pin_generation() == pin_generation {
                    if let Some(main) = restore_app_for_main.get_webview_window("main") {
                        if let Err(e) = main.set_always_on_top(was_main_on_top) {
                            eprintln!(
                                "[accessibility] set_always_on_top({was_main_on_top}) 恢复失败：{e}"
                            );
                        }
                    }
                }
                set_permission_window_always_on_top(&restore_app_for_main, "settings", true);
                PROMPT_IN_FLIGHT.store(false, Ordering::Release);
            }) {
                eprintln!("[accessibility] restore enqueue failed: {e}");
                PROMPT_IN_FLIGHT.store(false, Ordering::Release);
            }
        });

        Ok(())
    }
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::PERMISSION_UI_WINDOW_LABELS;

    #[test]
    fn permission_ui_yield_covers_settings_window() {
        assert!(PERMISSION_UI_WINDOW_LABELS.contains(&"main"));
        assert!(PERMISSION_UI_WINDOW_LABELS.contains(&"settings"));
    }

    #[test]
    fn listener_handle_records_start_failure() {
        let handle = super::ListenerHandle::default();
        handle.record_start_error_for_test("tap failed".to_string());
        let health = handle.health_snapshot_for_test(super::AccessibilityStatus {
            granted: true,
            platform: "macos",
        });

        assert!(!health.listener_running);
        assert_eq!(health.last_start_error.as_deref(), Some("tap failed"));
        assert!(health.last_stopped_at_ms.is_some());
    }

    #[test]
    fn listener_handle_stop_marks_not_running() {
        let handle = super::ListenerHandle::default();
        handle.mark_running_for_test();
        assert!(handle.is_running());

        handle.stop();

        assert!(!handle.is_running());
        let health = handle.health_snapshot_for_test(super::AccessibilityStatus {
            granted: true,
            platform: "macos",
        });
        assert!(!health.listener_running);
        assert!(health.last_stopped_at_ms.is_some());
    }

    #[test]
    fn listener_handle_treats_starting_stop_token_as_occupied() {
        let handle = super::ListenerHandle::default();
        assert!(!handle.listener_slot_occupied_for_test());

        handle.mark_starting_for_test();

        assert!(!handle.is_running());
        assert!(handle.listener_slot_occupied_for_test());
    }
}
