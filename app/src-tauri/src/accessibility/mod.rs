//! 辅助功能权限闸门：检测 → 暴露给前端 → 控制 key_counter listener 启停。
//! macOS 用 AXIsProcessTrusted；其它平台恒为 granted=true（不需要 TCC 类权限）。
//!
//! 详细设计见 docs/superpowers/specs/2026-05-16-key-counter-accessibility-permission-design.md。

use serde::Serialize;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager};

#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "windows")]
mod windows;
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
mod stub;

/// Holds the current key_counter listener's stop flag (None = listener not running).
/// Replaced atomically when (re)spawning.
#[derive(Default)]
pub struct ListenerHandle {
    inner: Mutex<Option<Arc<AtomicBool>>>,
}

impl ListenerHandle {
    pub fn is_running(&self) -> bool {
        self.inner.lock().unwrap().is_some()
    }

    /// Spawn a listener if not already running. Idempotent.
    pub fn ensure_running(&self, app: &AppHandle) {
        // Phase 1: commit the new stop flag inside the lock and release before spawning.
        let stop = {
            let mut guard = self.inner.lock().unwrap();
            if guard.is_some() {
                return;
            }
            let stop = Arc::new(AtomicBool::new(false));
            *guard = Some(stop.clone());
            stop
        };
        // Phase 2: spawn outside the lock so a long thread-spawn or future re-entry
        // through the same handle cannot deadlock against this Mutex.
        let app_handle = app.clone();
        crate::key_counter::spawn_listener(stop, move |keycode| {
            let _ = app_handle.emit("key-pressed", keycode);
        });
    }

    /// Signal the running listener to stop (no-op if not running).
    /// `is_running()` returns false immediately, but the listener thread may
    /// remain alive for up to ~100ms (the CGEventTap polling slice). Callers
    /// that re-spawn via `ensure_running` right after `stop()` can briefly
    /// have two ListenOnly taps installed; both emit `key-pressed`, so any
    /// keys pressed in that window may double-count.
    pub fn stop(&self) {
        let mut guard = self.inner.lock().unwrap();
        if let Some(stop) = guard.take() {
            stop.store(true, Ordering::Relaxed);
        }
    }
}

#[derive(Clone, Copy, Debug, Serialize)]
pub struct AccessibilityStatus {
    pub granted: bool,
    pub platform: &'static str,
}

pub fn current_status() -> AccessibilityStatus {
    #[cfg(target_os = "macos")]
    {
        AccessibilityStatus { granted: macos::is_trusted(), platform: "macos" }
    }
    #[cfg(target_os = "windows")]
    {
        AccessibilityStatus { granted: true, platform: "windows" }
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        AccessibilityStatus { granted: true, platform: "other" }
    }
}

#[tauri::command]
pub fn accessibility_status() -> AccessibilityStatus {
    current_status()
}

#[tauri::command]
#[allow(unreachable_code)]
pub fn open_accessibility_settings() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    return macos::open_settings();
    #[cfg(target_os = "windows")]
    return windows::open_settings();
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    return stub::open_settings();
}

#[tauri::command]
pub fn key_counter_listening(handle: tauri::State<'_, Arc<ListenerHandle>>) -> bool {
    handle.is_running()
}

use std::time::Duration;

/// Spawn the 1Hz watcher thread. Emits `accessibility-permission-changed`
/// on every state flip and starts/stops the listener through `handle`.
pub fn start_watcher(
    app: AppHandle,
    handle: Arc<ListenerHandle>,
    stop: Arc<AtomicBool>,
) {
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
                let _ = app.emit("accessibility-permission-changed", AccessibilityChangedPayload {
                    granted: status.granted,
                    platform: status.platform,
                });
                if status.granted {
                    handle.ensure_running(&app);
                } else {
                    handle.stop();
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
static PROMPT_IN_FLIGHT: AtomicBool = AtomicBool::new(false);
static MAIN_PIN_GENERATION: AtomicU64 = AtomicU64::new(0);

pub(crate) fn mark_main_pin_succeeded() -> u64 {
    MAIN_PIN_GENERATION.fetch_add(1, Ordering::AcqRel) + 1
}

fn main_pin_generation() -> u64 {
    MAIN_PIN_GENERATION.load(Ordering::Acquire)
}

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
        // set_always_on_top(false) → deactivate → prompt，避免依赖跨 dispatcher 的 FIFO 假设。
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
                PROMPT_IN_FLIGHT.store(false, Ordering::Release);
            }) {
                eprintln!("[accessibility] restore enqueue failed: {e}");
                PROMPT_IN_FLIGHT.store(false, Ordering::Release);
            }
        });

        Ok(())
    }
}
