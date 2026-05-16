# key_counter Accessibility Permission Gate — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Drive the macOS Accessibility permission flow from in-app — show a non-blocking banner, let users explicitly trigger the system prompt with the overlay temporarily yielding focus, and auto-spawn the CGEventTap listener as soon as permission flips on.

**Architecture:** New `accessibility/` Rust module (mirroring `passthrough/` layout) owns permission state. A 1Hz watcher thread emits `accessibility-permission-changed` events and starts/stops the `key_counter` listener. A new `request_accessibility_permission` command lowers `always_on_top` and deactivates the app before calling `AXIsProcessTrustedWithOptions(prompt:true)`. Frontend `bindingKey` store gains `permissionGranted`/`platform` fields and renders a banner inside the global settings tab.

**Tech Stack:** Rust + Tauri 2 + objc2 + core-foundation; React + TypeScript + Zustand + Vitest.

**Spec:** `docs/superpowers/specs/2026-05-16-key-counter-accessibility-permission-design.md`

---

## File Structure

**Created:**
- `app/src-tauri/src/accessibility/mod.rs` — command surface, watcher thread, listener-handle coordinator
- `app/src-tauri/src/accessibility/macos.rs` — `AXIsProcessTrusted`, `AXIsProcessTrustedWithOptions`, `NSApp.deactivate()`, open URL
- `app/src-tauri/src/accessibility/windows.rs` — `granted=true` always, opens `ms-settings:privacy-accessibility`
- `app/src-tauri/src/accessibility/stub.rs` — other-OS noop returning `granted=true`

**Modified:**
- `app/src-tauri/src/lib.rs` — register 4 new commands; replace direct `key_counter::spawn_listener` with `accessibility::start_watcher`; route `RunEvent::Exit` stop signal to watcher
- `app/src-tauri/src/key_counter.rs:9-10` — delete obsolete comment
- `app/src-tauri/Cargo.toml` — add `NSApplication` feature to `objc2-app-kit`
- `app/src/domain/bindingKey.ts` — add `permissionGranted`/`platform` to state, hook fetches initial status + subscribes to event
- `app/src/domain/bindingKey.test.ts` — banner-state tests
- `app/src/ui/SettingsPanel.tsx` — render banner inside `gspBindingKey` card when `!permissionGranted`
- `app/src/ui/SettingsPanel.css` — `.bk-perm-banner` reusing `--online-reconnect-*` tokens

---

## Task 1: Rust accessibility module skeleton + `accessibility_status` command

**Files:**
- Create: `app/src-tauri/src/accessibility/mod.rs`
- Create: `app/src-tauri/src/accessibility/macos.rs`
- Create: `app/src-tauri/src/accessibility/windows.rs`
- Create: `app/src-tauri/src/accessibility/stub.rs`
- Modify: `app/src-tauri/src/lib.rs:1-3,160-169`

This task only adds the no-prompt status query (`AXIsProcessTrusted` on macOS, hard-coded `true` elsewhere). The watcher thread, listener coordination, and other commands come in later tasks. Rust unit tests skipped per spec — no AX-API stub.

- [ ] **Step 1: Create `accessibility/mod.rs` with status struct and platform dispatch**

```rust
//! 辅助功能权限闸门：检测 → 暴露给前端 → 控制 key_counter listener 启停。
//! macOS 用 AXIsProcessTrusted；其它平台恒为 granted=true（不需要 TCC 类权限）。
//!
//! 详细设计见 docs/superpowers/specs/2026-05-16-key-counter-accessibility-permission-design.md。

use serde::Serialize;

#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "windows")]
mod windows;
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
mod stub;

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
```

- [ ] **Step 2: Create `accessibility/macos.rs` with stubbed `is_trusted` (real impl in Task 3)**

```rust
//! macOS 实现：AXIsProcessTrusted（不弹窗）+ AXIsProcessTrustedWithOptions（弹窗）+ 让位 + 打开系统设置。
//! 真正的 AX 调用在后续 task 接上，这一步只占位返回 false 让 watcher / 前端流程可以先打通。

pub fn is_trusted() -> bool {
    false // TASK 3 will replace with real AXIsProcessTrusted call
}
```

> Note: the `false` return is a deliberate scaffold so the rest of the wiring works end-to-end before macOS-specific code lands. Task 3 replaces this single function body — do not leave it.

- [ ] **Step 3: Create `accessibility/windows.rs` and `accessibility/stub.rs`**

`app/src-tauri/src/accessibility/windows.rs`:
```rust
//! Windows: low-level keyboard hook 不需要 TCC 类权限；granted 永真。
//! open_accessibility_settings 跳到 ms-settings:privacy-accessibility（Task 5）。
```

`app/src-tauri/src/accessibility/stub.rs`:
```rust
//! 其它平台 noop。
```

(Both files intentionally hold only doc comments at this point — items get added in later tasks.)

- [ ] **Step 4: Wire module into `lib.rs` and register the command**

Edit `app/src-tauri/src/lib.rs`. Change line 1-3 from:
```rust
mod active_app;
mod key_counter;
mod passthrough;
```
to:
```rust
mod accessibility;
mod active_app;
mod key_counter;
mod passthrough;
```

Edit the `invoke_handler!` block (around `lib.rs:160-169`). Change:
```rust
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
```
to:
```rust
        .invoke_handler(tauri::generate_handler![
            set_click_through,
            set_always_on_top,
            get_active_app,
            open_settings_window,
            close_settings_window,
            accessibility::accessibility_status,
            passthrough::register_hit_region,
            passthrough::unregister_hit_region,
            passthrough::clear_hit_regions,
        ])
```

- [ ] **Step 5: Verify build**

Run: `cd app && npm run tauri -- info >/dev/null && cargo check --manifest-path src-tauri/Cargo.toml`
Expected: clean cargo check, no warnings about unused module.

- [ ] **Step 6: Commit**

```bash
git add app/src-tauri/src/accessibility app/src-tauri/src/lib.rs
git commit -m "$(cat <<'EOF'
Add accessibility module skeleton + accessibility_status command

Mirrors passthrough/ layout. macOS impl is a stub returning false;
real AXIsProcessTrusted call lands in a follow-up task.

via [HAPI](https://hapi.run)

Co-Authored-By: HAPI <noreply@hapi.run>
EOF
)"
```

---

## Task 2: Add listener-handle coordinator + `key_counter_listening` command

**Files:**
- Modify: `app/src-tauri/src/accessibility/mod.rs`
- Modify: `app/src-tauri/src/lib.rs:100-160`

Replaces direct `key_counter::spawn_listener` call in `setup` with conditional spawn driven by current permission status. Watcher thread and event emission come in Task 4.

- [ ] **Step 1: Extend `accessibility/mod.rs` with the listener handle and conditional spawn helper**

Add at the top of `accessibility/mod.rs` (after the imports, before `AccessibilityStatus`):
```rust
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};

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
        let mut guard = self.inner.lock().unwrap();
        if guard.is_some() {
            return;
        }
        let stop = Arc::new(AtomicBool::new(false));
        let stop_for_listener = stop.clone();
        let app_handle = app.clone();
        crate::key_counter::spawn_listener(stop_for_listener, move |keycode| {
            let _ = app_handle.emit("key-pressed", keycode);
        });
        *guard = Some(stop);
    }

    /// Signal the running listener to stop (no-op if not running).
    pub fn stop(&self) {
        let mut guard = self.inner.lock().unwrap();
        if let Some(stop) = guard.take() {
            stop.store(true, Ordering::Relaxed);
        }
    }
}
```

Then add this command at the bottom of the file:
```rust
#[tauri::command]
pub fn key_counter_listening(handle: tauri::State<'_, Arc<ListenerHandle>>) -> bool {
    handle.is_running()
}
```

- [ ] **Step 2: Replace direct `spawn_listener` in `lib.rs::setup` with `ListenerHandle::ensure_running`**

In `lib.rs::run`, replace:
```rust
    let key_counter_stop = Arc::new(AtomicBool::new(false));
    let key_counter_stop_for_setup = key_counter_stop.clone();
    let key_counter_stop_for_exit = key_counter_stop.clone();
```
with:
```rust
    let listener_handle = Arc::new(accessibility::ListenerHandle::default());
    let listener_handle_for_setup = listener_handle.clone();
    let listener_handle_for_manage = listener_handle.clone();
    let listener_handle_for_exit = listener_handle.clone();
```

Add `.manage(...)` for the handle (next to the existing `passthrough::HitRegionStore` line near `lib.rs:116`):
```rust
        .manage::<std::sync::Arc<passthrough::HitRegionStore>>(hit_store_for_manage)
        .manage::<std::sync::Arc<accessibility::ListenerHandle>>(listener_handle_for_manage)
```

Inside `setup(move |app| { ... })`, replace the trailing `key_counter` block (currently at `lib.rs:152-156`):
```rust
            // 全局按键监听：CGEventTap → 主线程 emit；用户必须授予辅助功能权限
            let key_handle = app.handle().clone();
            key_counter::spawn_listener(key_counter_stop_for_setup.clone(), move |keycode| {
                let _ = key_handle.emit("key-pressed", keycode);
            });
```
with:
```rust
            // 按键监听由 accessibility 模块按权限状态启停 —— 启动时若已授权立即起，否则等用户授权后由 watcher 自动起。
            if accessibility::current_status().granted {
                listener_handle_for_setup.ensure_running(&app.handle());
            }
```

In `app.run(move |handle, event| { ... })` block (`lib.rs:173-181`), replace:
```rust
            active_app_stop_for_exit.store(true, Ordering::Relaxed);
            key_counter_stop_for_exit.store(true, Ordering::Relaxed);
```
with:
```rust
            active_app_stop_for_exit.store(true, Ordering::Relaxed);
            listener_handle_for_exit.stop();
```

Register the new command in the `invoke_handler!` block:
```rust
            accessibility::accessibility_status,
            accessibility::key_counter_listening,
```

- [ ] **Step 3: Verify build**

Run: `cd app/src-tauri && cargo check`
Expected: clean compile, no warnings about unused `key_counter_stop`.

- [ ] **Step 4: Manual smoke check (build only, no run)**

Run: `cd app/src-tauri && cargo build --release 2>&1 | tail -5`
Expected: "Finished `release` profile" line. The macOS `is_trusted` stub returns `false`, so the listener will not spawn — that's expected at this checkpoint; Task 4 wires up auto-spawn.

- [ ] **Step 5: Commit**

```bash
git add app/src-tauri/src/accessibility/mod.rs app/src-tauri/src/lib.rs
git commit -m "$(cat <<'EOF'
Move key_counter spawn behind ListenerHandle; gate on accessibility status

ListenerHandle owns the stop flag and offers idempotent ensure_running/stop.
Setup now spawns only if current_status().granted is true; the 1Hz watcher
in the next task takes over after-startup transitions.

via [HAPI](https://hapi.run)

Co-Authored-By: HAPI <noreply@hapi.run>
EOF
)"
```

---

## Task 3: Real macOS `AXIsProcessTrusted` implementation

**Files:**
- Modify: `app/src-tauri/src/accessibility/macos.rs`

Replaces the `false` stub with a real call. No tests (would need a mac-only AX environment).

- [ ] **Step 1: Replace stub with `extern "C"` declaration and call**

Replace the entire body of `app/src-tauri/src/accessibility/macos.rs` with:
```rust
//! macOS 实现：AXIsProcessTrusted（不弹窗）+ AXIsProcessTrustedWithOptions（弹窗）+ 让位 + 打开系统设置。

use std::os::raw::c_void;

#[link(name = "ApplicationServices", kind = "framework")]
extern "C" {
    /// `Boolean AXIsProcessTrusted(void)` — 不弹窗，纯查询。返回 1=已授权 / 0=未授权。
    fn AXIsProcessTrusted() -> u8;
    /// `Boolean AXIsProcessTrustedWithOptions(CFDictionaryRef options)` — 当 options 含
    /// `kAXTrustedCheckOptionPrompt = kCFBooleanTrue` 时，未授权情况下系统会弹出 TCC 对话框。
    /// 函数本身**立即返回**，弹窗由 system server 异步显示。
    fn AXIsProcessTrustedWithOptions(options: *const c_void) -> u8;
}

pub fn is_trusted() -> bool {
    // Safety: 无副作用，无参数；被 framework 标注为线程安全。
    unsafe { AXIsProcessTrusted() != 0 }
}
```

- [ ] **Step 2: Verify build (still cargo check — no new symbols referenced yet)**

Run: `cd app/src-tauri && cargo check`
Expected: clean compile. `AXIsProcessTrustedWithOptions` is currently unused — that's fine (Task 6 uses it). If cargo warns about it, prepend with `#[allow(dead_code)]` temporarily; the warning will go away after Task 6.

- [ ] **Step 3: Commit**

```bash
git add app/src-tauri/src/accessibility/macos.rs
git commit -m "$(cat <<'EOF'
Wire AXIsProcessTrusted into accessibility::macos::is_trusted

Replaces the scaffold false-return stub with a real ApplicationServices
framework call. AXIsProcessTrustedWithOptions extern is declared now;
called by request_accessibility_permission in a later task.

via [HAPI](https://hapi.run)

Co-Authored-By: HAPI <noreply@hapi.run>
EOF
)"
```

---

## Task 4: 1Hz watcher thread + `accessibility-permission-changed` event + listener auto-respawn

**Files:**
- Modify: `app/src-tauri/src/accessibility/mod.rs`
- Modify: `app/src-tauri/src/lib.rs:117-159,173-181`

The watcher mirrors the existing `active_app` 1Hz loop in `lib.rs:127-150`: same `AtomicBool + 10×100ms` pattern (per CLAUDE.md / adversarial-review #6). On `false → true`, it spawns the listener via `ListenerHandle::ensure_running`; on `true → false`, it calls `stop()`.

- [ ] **Step 1: Add `start_watcher` to `accessibility/mod.rs`**

Append below `key_counter_listening`:
```rust
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
            let now = current_status().granted;
            if now != last {
                let _ = app.emit("accessibility-permission-changed", AccessibilityChangedPayload { granted: now });
                if now {
                    handle.ensure_running(&app);
                } else {
                    handle.stop();
                }
                last = now;
            }
        }
    });
}

#[derive(Clone, Copy, Debug, Serialize)]
struct AccessibilityChangedPayload {
    granted: bool,
}
```

- [ ] **Step 2: Wire watcher start + stop into `lib.rs::run`**

Add a stop flag near the existing ones at the top of `run()`:
```rust
    let accessibility_stop = Arc::new(AtomicBool::new(false));
    let accessibility_stop_for_setup = accessibility_stop.clone();
    let accessibility_stop_for_exit = accessibility_stop.clone();
```

Inside `setup(move |app| { ... })`, after the existing `if accessibility::current_status().granted { listener_handle_for_setup.ensure_running(&app.handle()); }` line, add:
```rust
            // 1Hz 权限轮询：状态翻转时 emit + 启停 listener；ExitRequested 通过 stop 信号退出
            accessibility::start_watcher(
                app.handle().clone(),
                listener_handle_for_setup.clone(),
                accessibility_stop_for_setup.clone(),
            );
```

Inside the `app.run(move |handle, event| { ... })` exit branch, add:
```rust
            accessibility_stop_for_exit.store(true, Ordering::Relaxed);
```
right next to the existing `active_app_stop_for_exit.store(true, ...)` line.

- [ ] **Step 3: Verify build**

Run: `cd app/src-tauri && cargo check`
Expected: clean compile.

- [ ] **Step 4: Commit**

```bash
git add app/src-tauri/src/accessibility/mod.rs app/src-tauri/src/lib.rs
git commit -m "$(cat <<'EOF'
Add 1Hz accessibility watcher with auto listener (re)spawn

Watcher emits accessibility-permission-changed on flip and toggles the
key_counter listener via ListenerHandle. Reuses the active_app 10×100ms
stop-signal pattern so ExitRequested is observed within 100ms.

via [HAPI](https://hapi.run)

Co-Authored-By: HAPI <noreply@hapi.run>
EOF
)"
```

---

## Task 5: `open_accessibility_settings` command

**Files:**
- Modify: `app/src-tauri/src/accessibility/mod.rs`
- Modify: `app/src-tauri/src/accessibility/macos.rs`
- Modify: `app/src-tauri/src/accessibility/windows.rs`
- Modify: `app/src-tauri/src/accessibility/stub.rs`
- Modify: `app/src-tauri/src/lib.rs` (invoke_handler list)

Uses `std::process::Command::new("open" | "cmd")` directly — no plugin dependency.

- [ ] **Step 1: Add `open_settings` to each platform impl**

`app/src-tauri/src/accessibility/macos.rs` — append at the bottom:
```rust
pub fn open_settings() -> Result<(), String> {
    std::process::Command::new("open")
        .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility")
        .spawn()
        .map_err(|e| format!("open failed: {e}"))?;
    Ok(())
}
```

`app/src-tauri/src/accessibility/windows.rs` — replace its current contents with:
```rust
//! Windows: low-level keyboard hook 不需要 TCC 类权限；granted 永真。
//! open_settings 跳到 ms-settings:privacy 的 Accessibility 子页（最接近的入口）。

pub fn open_settings() -> Result<(), String> {
    std::process::Command::new("cmd")
        .args(["/c", "start", "ms-settings:privacy-accessibility"])
        .spawn()
        .map_err(|e| format!("start failed: {e}"))?;
    Ok(())
}
```

`app/src-tauri/src/accessibility/stub.rs` — replace its current contents with:
```rust
//! 其它平台 noop。

pub fn open_settings() -> Result<(), String> {
    Ok(())
}
```

- [ ] **Step 2: Add `open_accessibility_settings` command in `mod.rs`**

Append:
```rust
#[tauri::command]
pub fn open_accessibility_settings() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    return macos::open_settings();
    #[cfg(target_os = "windows")]
    return windows::open_settings();
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    return stub::open_settings();
}
```

- [ ] **Step 3: Register command in `lib.rs`**

Add to the `invoke_handler!` list (next to `accessibility_status`):
```rust
            accessibility::open_accessibility_settings,
```

- [ ] **Step 4: Verify build**

Run: `cd app/src-tauri && cargo check`
Expected: clean compile.

- [ ] **Step 5: Commit**

```bash
git add app/src-tauri/src/accessibility app/src-tauri/src/lib.rs
git commit -m "$(cat <<'EOF'
Add open_accessibility_settings command

macOS: x-apple.systempreferences URL via 'open'.
Windows: ms-settings:privacy-accessibility via 'start'.
Other: noop (kept for command-surface symmetry).

via [HAPI](https://hapi.run)

Co-Authored-By: HAPI <noreply@hapi.run>
EOF
)"
```

---

## Task 6: `request_accessibility_permission` command + yield/restore + debounce

**Files:**
- Modify: `app/src-tauri/Cargo.toml` (add `NSApplication` feature)
- Modify: `app/src-tauri/src/accessibility/macos.rs`
- Modify: `app/src-tauri/src/accessibility/mod.rs`
- Modify: `app/src-tauri/src/lib.rs` (invoke_handler list)

Yield = drop `always_on_top` + `NSApp.deactivate()`. Restore = re-enable `always_on_top` after 30s OR earlier when watcher signals granted=true. Debounce via a single `AtomicBool`.

- [ ] **Step 1: Extend `objc2-app-kit` features**

Edit `app/src-tauri/Cargo.toml`. Find the line:
```toml
objc2-app-kit = { version = "0.3", features = ["NSWorkspace", "NSRunningApplication", "NSView", "NSWindow", "NSResponder", "NSEvent"] }
```
Change to:
```toml
objc2-app-kit = { version = "0.3", features = ["NSApplication", "NSWorkspace", "NSRunningApplication", "NSView", "NSWindow", "NSResponder", "NSEvent"] }
```

- [ ] **Step 2: Add yield + prompt helpers to `accessibility/macos.rs`**

Append:
```rust
use core_foundation::base::TCFType;
use core_foundation::boolean::CFBoolean;
use core_foundation::dictionary::CFDictionary;
use core_foundation::string::CFString;
use objc2::msg_send;
use objc2_app_kit::NSApplication;
use objc2_foundation::MainThreadMarker;

/// 调用 AXIsProcessTrustedWithOptions(prompt: true)。**必须在主线程调用**：
/// 调用方应在 Tauri 命令的 main-thread executor 内或通过 `tauri::async_runtime::spawn_blocking + run_on_main_thread` 触发。
pub fn prompt() {
    // kAXTrustedCheckOptionPrompt 是 framework 导出的字符串常量；用 CFString 字面量绕开链接复杂度。
    let key = CFString::from_static_string("AXTrustedCheckOptionPrompt");
    let value = CFBoolean::true_value();
    let opts = CFDictionary::from_CFType_pairs(&[(key, value)]);
    // Safety: AXIsProcessTrustedWithOptions 接受 CFDictionaryRef；CFDictionary as_concrete_TypeRef 返回正确类型。
    unsafe {
        AXIsProcessTrustedWithOptions(opts.as_concrete_TypeRef() as *const _);
    }
}

/// 让 App 失去 key application 状态，使刚弹出的系统对话框能拿到焦点。**必须在主线程**。
pub fn deactivate_app() {
    let mtm = match MainThreadMarker::new() {
        Some(m) => m,
        None => return, // 调用方失误也不 panic
    };
    let app = NSApplication::sharedApplication(mtm);
    // Safety: deactivate is documented as main-thread-only; mtm above guarantees that.
    unsafe {
        let _: () = msg_send![&*app, deactivate];
    }
}
```

- [ ] **Step 3: Add `request_accessibility_permission` command in `mod.rs`**

Append:
```rust
/// 防抖：同一时刻只允许一次 prompt 飞行；第二次点击直接 Ok(()) 返回，避免 restore 任务堆叠
/// 与 always_on_top 抖动。请求结束（granted=true 翻转或 30s 超时）后重置为 false。
static PROMPT_IN_FLIGHT: AtomicBool = AtomicBool::new(false);

#[tauri::command]
pub async fn request_accessibility_permission(app: AppHandle) -> Result<(), String> {
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        return Ok(());
    }

    #[cfg(target_os = "macos")]
    {
        if PROMPT_IN_FLIGHT.swap(true, Ordering::AcqRel) {
            return Ok(());
        }

        // 让位：set_always_on_top(false) + NSApp.deactivate()。失败不致命，仍继续 prompt。
        if let Some(main) = app.get_webview_window("main") {
            if let Err(e) = main.set_always_on_top(false) {
                eprintln!("[accessibility] set_always_on_top(false) 失败：{e}");
            }
        }
        // run_on_main_thread 保证 prompt + deactivate 都在主线程执行
        let _ = app.run_on_main_thread(|| {
            macos::deactivate_app();
            macos::prompt();
        });

        // 30s 倒计时 或 granted 翻转，先到先恢复
        let restore_app = app.clone();
        tauri::async_runtime::spawn(async move {
            let deadline = std::time::Instant::now() + Duration::from_secs(30);
            loop {
                if current_status().granted {
                    break;
                }
                if std::time::Instant::now() >= deadline {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(200)).await;
            }
            if let Some(main) = restore_app.get_webview_window("main") {
                if let Err(e) = main.set_always_on_top(true) {
                    eprintln!("[accessibility] set_always_on_top(true) 恢复失败：{e}");
                }
            }
            PROMPT_IN_FLIGHT.store(false, Ordering::Release);
        });

        Ok(())
    }
}
```

Add the missing import at the top of `mod.rs` (next to `tauri::AppHandle`):
```rust
use tauri::Manager;
```

- [ ] **Step 4: Register command in `lib.rs`**

Add to the `invoke_handler!` list:
```rust
            accessibility::request_accessibility_permission,
```

- [ ] **Step 5: Verify build**

Run: `cd app/src-tauri && cargo check`
Expected: clean compile. If `tokio::time::sleep` is unresolved, Tauri 2 ships tokio; ensure it's accessible via `tauri::async_runtime` instead — fall back to:
```rust
                tauri::async_runtime::spawn(async move {
                    // ...
                    let _ = tokio::time::sleep(Duration::from_millis(200));
                    // or:
                    std::thread::sleep(Duration::from_millis(200));
                });
```
The fallback `std::thread::sleep` inside `spawn(async {...})` blocks the runtime — DO NOT use it. Real fix if tokio isn't visible: add `tokio = { version = "1", features = ["time"] }` to `[dependencies]` of `Cargo.toml`. Verify with `cargo tree -p tokio --manifest-path src-tauri/Cargo.toml` — Tauri 2 already pulls it transitively.

- [ ] **Step 6: Commit**

```bash
git add app/src-tauri
git commit -m "$(cat <<'EOF'
Add request_accessibility_permission with overlay yield + restore

Drops always_on_top, deactivates the app, then calls
AXIsProcessTrustedWithOptions(prompt:true) so the system TCC dialog
becomes key window. A spawned task restores always_on_top after 30s
or as soon as granted flips true, whichever comes first. PROMPT_IN_FLIGHT
debounces concurrent clicks.

via [HAPI](https://hapi.run)

Co-Authored-By: HAPI <noreply@hapi.run>
EOF
)"
```

---

## Task 7: Frontend `bindingKey` store extensions + initial status fetch

**Files:**
- Modify: `app/src/domain/bindingKey.ts`
- Modify: `app/src/domain/bindingKey.test.ts`

- [ ] **Step 1: Write the failing test for store-extension defaults**

Append to `app/src/domain/bindingKey.test.ts`:
```typescript
import { createBindingKeyStore } from './bindingKey';

describe('createBindingKeyStore — permission state', () => {
    it('defaults permissionGranted to true and platform to null before fetch', () => {
        const store = createBindingKeyStore({ isSettingsWindow: false });
        expect(store.getState().permissionGranted).toBe(true);
        expect(store.getState().platform).toBe(null);
    });

    it('setPermission updates both fields', () => {
        const store = createBindingKeyStore({ isSettingsWindow: false });
        store.getState().setPermission(false, 'macos');
        expect(store.getState().permissionGranted).toBe(false);
        expect(store.getState().platform).toBe('macos');
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run src/domain/bindingKey.test.ts -t "permission state"`
Expected: FAIL with "permissionGranted is undefined" / "setPermission is not a function".

- [ ] **Step 3: Add fields and action to the store**

Edit `app/src/domain/bindingKey.ts`. In `BindingKeyState` (around line 15), add:
```typescript
    permissionGranted: boolean;
    platform: 'macos' | 'windows' | 'other' | null;
```

In `BindingKeyActions` (around line 21), add:
```typescript
    setPermission: (granted: boolean, platform: 'macos' | 'windows' | 'other') => void;
```

In the **non-settings** branch of `createBindingKeyStore` (the `return create<...>((set, get) => ({` block at line 79), add to the initial state:
```typescript
        permissionGranted: true,
        platform: null,
```
and add the action:
```typescript
        setPermission: (granted, platform) => set({ permissionGranted: granted, platform }),
```

In the **settings-window** branch (line 55), add the same initial fields and a no-op `setPermission` (settings window is read-only over the bridge — permission state is owned by main window):
```typescript
            permissionGranted: true,
            platform: null,
            setPermission: () => {},
```

> Default `permissionGranted: true` (not `false`) avoids a flash of "Permission needed" banner during the brief window between mount and the initial `invoke()` resolving. Tests in Task 9 verify the post-fetch banner state, not pre-fetch.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npx vitest run src/domain/bindingKey.test.ts -t "permission state"`
Expected: PASS, 2/2.

- [ ] **Step 5: Add initial-fetch logic to `useBindingKeyListener`**

Edit `useBindingKeyListener` in `app/src/domain/bindingKey.ts`. Replace the function with:
```typescript
import { invoke } from '@tauri-apps/api/core';

interface AccessibilityStatus {
    granted: boolean;
    platform: 'macos' | 'windows' | 'other';
}

export function useBindingKeyListener() {
    useEffect(() => {
        let unlistenKey = () => {};
        let cancelled = false;

        // 启动时拉一次状态；后续翻转走 accessibility-permission-changed 事件
        invoke<AccessibilityStatus>('accessibility_status').then((s) => {
            if (cancelled) return;
            useBindingKeyStore.getState().setPermission(s.granted, s.platform);
        }).catch(() => { /* 非 Tauri 环境（vitest jsdom）下静默 */ });

        listen<number>('key-pressed', (event) => {
            const store = useBindingKeyStore.getState();
            const keyCode = Number(event.payload);
            if (store.capturingId) {
                store.completeCapture(keyCode, labelForKeyCode(keyCode));
            } else {
                store.incrementByKeyCode(keyCode);
            }
        }).then((un) => {
            unlistenKey = un;
        });

        return () => {
            cancelled = true;
            unlistenKey();
        };
    }, []);
}
```

- [ ] **Step 6: Run all bindingKey tests to confirm no regression**

Run: `cd app && npx vitest run src/domain/bindingKey.test.ts`
Expected: all green (existing 2 + new 2).

- [ ] **Step 7: Commit**

```bash
git add app/src/domain/bindingKey.ts app/src/domain/bindingKey.test.ts
git commit -m "$(cat <<'EOF'
Add permissionGranted/platform fields + initial status fetch

useBindingKeyListener now pulls accessibility_status on mount and
stores it via setPermission. Default permissionGranted=true avoids
banner flash during the fetch.

via [HAPI](https://hapi.run)

Co-Authored-By: HAPI <noreply@hapi.run>
EOF
)"
```

---

## Task 8: Frontend `accessibility-permission-changed` event subscription

**Files:**
- Modify: `app/src/domain/bindingKey.ts`
- Modify: `app/src/domain/bindingKey.test.ts`

- [ ] **Step 1: Write the failing test for event-driven flip**

Append to `app/src/domain/bindingKey.test.ts`:
```typescript
import { renderHook } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';

const listenMock = vi.fn();
const invokeMock = vi.fn();

vi.mock('@tauri-apps/api/event', () => ({ listen: listenMock }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));

describe('useBindingKeyListener — permission event', () => {
    beforeEach(() => {
        listenMock.mockReset();
        invokeMock.mockReset();
    });

    it('flips permissionGranted when accessibility-permission-changed fires', async () => {
        invokeMock.mockResolvedValue({ granted: true, platform: 'macos' });
        const handlers: Record<string, (e: { payload: unknown }) => void> = {};
        listenMock.mockImplementation((event: string, cb: (e: { payload: unknown }) => void) => {
            handlers[event] = cb;
            return Promise.resolve(() => {});
        });

        const { useBindingKeyListener, useBindingKeyStore } = await import('./bindingKey');
        renderHook(() => useBindingKeyListener());

        // Wait for mount-time invoke + listen calls to settle
        await new Promise((r) => setTimeout(r, 0));
        expect(useBindingKeyStore.getState().permissionGranted).toBe(true);

        // Simulate event flip false
        handlers['accessibility-permission-changed']({ payload: { granted: false } });
        expect(useBindingKeyStore.getState().permissionGranted).toBe(false);

        // And back true
        handlers['accessibility-permission-changed']({ payload: { granted: true } });
        expect(useBindingKeyStore.getState().permissionGranted).toBe(true);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run src/domain/bindingKey.test.ts -t "permission event"`
Expected: FAIL — `handlers['accessibility-permission-changed']` undefined (the listener for that event doesn't exist yet).

- [ ] **Step 3: Add subscription in the hook**

Edit `useBindingKeyListener` (in `app/src/domain/bindingKey.ts`). Insert this block after the `listen<number>('key-pressed', ...)` call but before the `return () => { ... }`:
```typescript
        let unlistenPerm = () => {};
        listen<{ granted: boolean }>('accessibility-permission-changed', (event) => {
            const { granted } = event.payload;
            const platform = useBindingKeyStore.getState().platform ?? 'macos';
            useBindingKeyStore.getState().setPermission(granted, platform);
        }).then((un) => {
            unlistenPerm = un;
        });
```

Update the cleanup function:
```typescript
        return () => {
            cancelled = true;
            unlistenKey();
            unlistenPerm();
        };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npx vitest run src/domain/bindingKey.test.ts -t "permission event"`
Expected: PASS. If `@testing-library/react` is missing, install it as dev: `cd app && npm i -D @testing-library/react @testing-library/dom`. Verify with `cd app && npx vitest run` — full suite green.

- [ ] **Step 5: Commit**

```bash
git add app/src/domain/bindingKey.ts app/src/domain/bindingKey.test.ts app/package.json app/package-lock.json
git commit -m "$(cat <<'EOF'
Subscribe to accessibility-permission-changed in useBindingKeyListener

Event payload { granted } drives setPermission; platform is preserved
from the initial fetch (or defaults to 'macos').

via [HAPI](https://hapi.run)

Co-Authored-By: HAPI <noreply@hapi.run>
EOF
)"
```

---

## Task 9: Banner UI in `SettingsPanel`

**Files:**
- Modify: `app/src/ui/SettingsPanel.tsx:347-393`
- Modify: `app/src/ui/SettingsPanel.css` (append new rules)

Banner sits inside the existing `gspBindingKey` card, above the description text. Visible only when `!permissionGranted`. Reuses `--online-reconnect-bg/text` tokens (already used by `.online-reconnect` at `SettingsPanel.css:407`).

- [ ] **Step 1: Add CSS rules to `SettingsPanel.css`**

Append at the end of `app/src/ui/SettingsPanel.css`:
```css
/* ===== Accessibility 权限 banner（gspBindingKey 内） ===== */
.bk-perm-banner {
    background: var(--online-reconnect-bg);
    color: var(--online-reconnect-text);
    border-radius: 12px;
    padding: 10px 12px;
    margin-bottom: 10px;
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    font-size: 12px;
}
.bk-perm-banner .bk-perm-msg {
    flex: 1 1 auto;
    min-width: 160px;
}
.bk-perm-banner button {
    background: transparent;
    border: 1px solid currentColor;
    border-radius: 999px;
    padding: 4px 10px;
    color: inherit;
    font-size: 12px;
    cursor: pointer;
}
.bk-perm-banner button:hover { opacity: 0.85; }
```

- [ ] **Step 2: Render banner in `GlobalTab`**

Edit `app/src/ui/SettingsPanel.tsx`. At the top, import `invoke`:
```typescript
import { invoke } from '@tauri-apps/api/core';
```
(Skip if already present.)

Inside the `gspBindingKey` card (at `SettingsPanel.tsx:348`), insert immediately after the opening `<div className="card">`:
```tsx
                    {!bk.permissionGranted && (
                        <div className="bk-perm-banner" role="status">
                            <span className="bk-perm-msg">需要辅助功能权限才能统计按键</span>
                            <button onClick={() => { void invoke('request_accessibility_permission'); }}>
                                申请权限
                            </button>
                            <button onClick={() => { void invoke('open_accessibility_settings'); }}>
                                打开系统设置
                            </button>
                        </div>
                    )}
```

- [ ] **Step 3: Sanity-check the type**

Run: `cd app && npx tsc --noEmit`
Expected: no errors. (If `bk.permissionGranted` is unknown, the type extension from Task 7 didn't take effect — re-check `BindingKeyState`.)

- [ ] **Step 4: Run the full test suite**

Run: `cd app && npm test`
Expected: all green (existing + 4 new bindingKey tests).

- [ ] **Step 5: Commit**

```bash
git add app/src/ui/SettingsPanel.tsx app/src/ui/SettingsPanel.css
git commit -m "$(cat <<'EOF'
Render accessibility permission banner inside gspBindingKey card

Banner reuses --online-reconnect-* tokens, exposes 申请权限 + 打开系统设置.
Visible only when bk.permissionGranted is false.

via [HAPI](https://hapi.run)

Co-Authored-By: HAPI <noreply@hapi.run>
EOF
)"
```

---

## Task 10: Cleanup obsolete comment + manual verification

**Files:**
- Modify: `app/src-tauri/src/key_counter.rs:9-10`

- [ ] **Step 1: Update the misleading comment**

Edit `app/src-tauri/src/key_counter.rs`. Replace lines 9-10:
```rust
//! 安全前提：用户必须在「系统设置 → 隐私与安全 → 辅助功能」里授予此 App。
//! 没有权限时 `CGEventTap::new` 仍会成功但事件不会送达；前端通过 1Hz 探测能否拿到
//! 任何事件来判断是否需要弹引导。
```
with:
```rust
//! 安全前提：用户必须在「系统设置 → 隐私与安全 → 辅助功能」里授予此 App。
//! 没有权限时 `CGEventTap::new` 直接返回 Err；本模块不主动检测权限，
//! 由 `accessibility` 模块在权限翻转时调用 `spawn_listener`。
```

- [ ] **Step 2: Verify build**

Run: `cd app/src-tauri && cargo check`
Expected: clean.

- [ ] **Step 3: Manual verification (macOS)**

Pre-conditions: revoke this app's Accessibility permission first — System Settings → Privacy & Security → Accessibility → toggle off (or remove).

Run: `cd app && npm run tauri dev`

Expected behaviors, in order:
- App launches; main pet window appears transparent + on-top.
- Open Settings (existing entry point) → 全局 tab → "按键计数" card shows the yellow banner with "需要辅助功能权限…" + two buttons.
- Click "申请权限": main window briefly drops below the foreground (no longer floating-on-top); macOS shows a TCC dialog. The dialog should be **fully clickable and focusable**. Approve via Touch ID / password.
- Within ≤1 second of approval, the banner disappears and pressing a bound key updates its count.
- Within ≤30 seconds, main window returns to always-on-top.
- Revoke permission again from System Settings: within ≤1 second the banner reappears.
- Click "打开系统设置": Settings.app opens directly on the Privacy & Security → Accessibility pane.

If any step fails, debug before committing. Note in commit message which steps were verified.

- [ ] **Step 4: Commit**

```bash
git add app/src-tauri/src/key_counter.rs
git commit -m "$(cat <<'EOF'
Update key_counter doc comment to reflect Err-on-no-permission behavior

The previous comment claimed CGEventTap::new succeeded silently without
permission; in fact it returns Err. Permission detection now lives in
the accessibility module.

via [HAPI](https://hapi.run)

Co-Authored-By: HAPI <noreply@hapi.run>
EOF
)"
```

---

## Self-Review Notes

1. **Spec coverage:** Each spec section has a task: status command (T1), listener coordinator (T2), `AXIsProcessTrusted` (T3), 1Hz watcher + event + auto-respawn (T4), open settings (T5), prompt with yield + debounce (T6), frontend store fields + initial fetch (T7), event subscription (T8), banner UI (T9), comment cleanup + manual verification (T10). Windows path covered by T1 default + T5 stub.
2. **Type consistency:** `AccessibilityStatus { granted, platform }` is used identically in Rust (T1), TypeScript (T7), event payload uses `{ granted }` only (T4 emits, T8 reads). `ListenerHandle` methods (`is_running`, `ensure_running`, `stop`) are referenced consistently across T2 / T4. `setPermission(granted, platform)` matches in test (T7) and hook (T8).
3. **No placeholders left:** All steps have concrete code; the deliberate `false` scaffold in T1 macos.rs is replaced in T3 (called out in the step body). The `cargo` fallback note in T6 step 5 is a debugging hint, not a placeholder.
4. **Frequent commits:** 10 tasks → 10 commits, each independently verifiable.
