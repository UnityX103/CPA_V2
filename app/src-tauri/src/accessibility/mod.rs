//! 辅助功能权限闸门：检测 → 暴露给前端 → 控制 key_counter listener 启停。
//! macOS 用 AXIsProcessTrusted；其它平台恒为 granted=true（不需要 TCC 类权限）。
//!
//! 详细设计见 docs/superpowers/specs/2026-05-16-key-counter-accessibility-permission-design.md。

use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};

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
pub fn key_counter_listening(handle: tauri::State<'_, Arc<ListenerHandle>>) -> bool {
    handle.is_running()
}
