# Key Counter Listener Health Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the key-counter binding flow distinguish macOS Accessibility permission from actual listener health, expose listener failures in the settings UI, and provide a safe retry path.

**Architecture:** Rust owns authoritative listener health in `accessibility::ListenerHandle`, including install success, last error, and process identity diagnostics. The frontend mirrors that health in `BindingKeyStore`, listens to `key-counter-health-changed`, and shows a settings banner only when permission is granted but the listener is not running.

**Tech Stack:** Tauri 2, Rust, React 19, TypeScript, Zustand, Vitest, jsdom.

---

## File Structure

- Modify `app/src-tauri/src/key_counter.rs`: make macOS listener startup report install success or failure synchronously, matching the existing Windows pattern.
- Modify `app/src-tauri/src/accessibility/mod.rs`: expand `ListenerHandle`, add `KeyCounterHealth`, add commands/events, and update watcher emissions.
- Modify `app/src-tauri/src/lib.rs`: register new Tauri commands.
- Modify `app/src/domain/bindingKey.ts`: add listener-health store fields, actions, startup fetch, event listener, and focus refresh/retry.
- Modify `app/src/domain/bindingKey.test.ts`: cover store health fields and listener event/focus behavior.
- Modify `app/src/ui/SettingsPanel.tsx`: fetch health in settings window and render listener-health banner.
- Modify `app/src/ui/SettingsPanel.test.tsx`: cover the new banner and retry button.

## Task 1: Frontend Store Health Contract

**Files:**
- Modify: `app/src/domain/bindingKey.ts`
- Test: `app/src/domain/bindingKey.test.ts`

- [ ] **Step 1: Write failing store tests**

Add these tests near the existing permission-state tests in `app/src/domain/bindingKey.test.ts`:

```ts
it('defaults listener health to unknown before fetch', () => {
    const store = createBindingKeyStore({ isSettingsWindow: false });
    expect(store.getState().listenerRunning).toBe(null);
    expect(store.getState().listenerError).toBe(null);
    expect(store.getState().listenerDiagnostic).toBe(null);
});

it('setListenerHealth mirrors listener status and diagnostics', () => {
    const store = createBindingKeyStore({ isSettingsWindow: false });
    store.getState().setListenerHealth({
        permissionGranted: true,
        platform: 'macos',
        listenerRunning: false,
        lastStartError: '[key_counter] CGEventTap create failed',
        lastStartedAtMs: null,
        lastStoppedAtMs: 1770000000000,
        bundleIdentifier: 'com.nanzhai.cpa',
        executablePath: '/Applications/桌宠番茄钟.app/Contents/MacOS/app',
        codeSignIdentifier: 'app-461de596266994b3',
    });

    expect(store.getState()).toEqual(expect.objectContaining({
        permissionGranted: true,
        platform: 'macos',
        listenerRunning: false,
        listenerError: '[key_counter] CGEventTap create failed',
        listenerDiagnostic: {
            bundleIdentifier: 'com.nanzhai.cpa',
            executablePath: '/Applications/桌宠番茄钟.app/Contents/MacOS/app',
            codeSignIdentifier: 'app-461de596266994b3',
        },
    }));
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
cd app && npx vitest run src/domain/bindingKey.test.ts
```

Expected: FAIL because `listenerRunning`, `listenerError`, `listenerDiagnostic`, and `setListenerHealth` do not exist.

- [ ] **Step 3: Add TypeScript health types and actions**

In `app/src/domain/bindingKey.ts`, add this interface after `AccessibilityStatus`:

```ts
export interface KeyCounterHealth {
    permissionGranted: boolean;
    platform: 'macos' | 'windows' | 'other';
    listenerRunning: boolean;
    lastStartError: string | null;
    lastStartedAtMs: number | null;
    lastStoppedAtMs: number | null;
    bundleIdentifier: string | null;
    executablePath: string | null;
    codeSignIdentifier: string | null;
}

interface ListenerDiagnostic {
    bundleIdentifier: string | null;
    executablePath: string | null;
    codeSignIdentifier: string | null;
}
```

Extend `BindingKeyState`:

```ts
listenerRunning: boolean | null;
listenerError: string | null;
listenerDiagnostic: ListenerDiagnostic | null;
```

Extend `BindingKeyActions`:

```ts
setListenerHealth: (health: KeyCounterHealth) => void;
```

Add this helper above `createBindingKeyStore`:

```ts
function listenerHealthPatch(health: KeyCounterHealth): Pick<
    BindingKeyState,
    'permissionGranted' | 'platform' | 'listenerRunning' | 'listenerError' | 'listenerDiagnostic'
> {
    return {
        permissionGranted: health.permissionGranted,
        platform: health.platform,
        listenerRunning: health.listenerRunning,
        listenerError: health.lastStartError,
        listenerDiagnostic: {
            bundleIdentifier: health.bundleIdentifier,
            executablePath: health.executablePath,
            codeSignIdentifier: health.codeSignIdentifier,
        },
    };
}
```

Add the default fields and action in both settings-window and main store creation:

```ts
listenerRunning: null,
listenerError: null,
listenerDiagnostic: null,
setListenerHealth: (health) => set(listenerHealthPatch(health)),
```

- [ ] **Step 4: Run tests to verify pass**

Run:

```bash
cd app && npx vitest run src/domain/bindingKey.test.ts
```

Expected: PASS for the new store tests and existing binding-key tests.

- [ ] **Step 5: Commit**

```bash
git add app/src/domain/bindingKey.ts app/src/domain/bindingKey.test.ts
git commit -m "feat: add key counter health store state"
```

## Task 2: Frontend Listener Lifecycle

**Files:**
- Modify: `app/src/domain/bindingKey.ts`
- Test: `app/src/domain/bindingKey.test.ts`

- [ ] **Step 1: Write failing lifecycle tests**

Add these tests inside the `useBindingKeyListener` describe block in `app/src/domain/bindingKey.test.ts`:

```ts
it('loads key counter health and reacts to health change events', async () => {
    invokeMock.mockImplementation((command: string) => {
        if (command === 'accessibility_status') {
            return Promise.resolve({ granted: true, platform: 'macos' });
        }
        if (command === 'key_counter_health') {
            return Promise.resolve({
                permissionGranted: true,
                platform: 'macos',
                listenerRunning: true,
                lastStartError: null,
                lastStartedAtMs: 1770000000000,
                lastStoppedAtMs: null,
                bundleIdentifier: 'com.nanzhai.cpa',
                executablePath: '/Applications/桌宠番茄钟.app/Contents/MacOS/app',
                codeSignIdentifier: 'app-461de596266994b3',
            });
        }
        return Promise.resolve();
    });
    const handlers: Record<string, (e: { payload: unknown }) => void> = {};
    listenMock.mockImplementation((event: string, cb: (e: { payload: unknown }) => void) => {
        handlers[event] = cb;
        return Promise.resolve(() => {});
    });

    const { useBindingKeyListener, useBindingKeyStore } = await import('./bindingKey');
    renderHook(() => useBindingKeyListener());
    await new Promise((r) => setTimeout(r, 0));

    expect(invokeMock).toHaveBeenCalledWith('key_counter_health');
    expect(useBindingKeyStore.getState().listenerRunning).toBe(true);

    handlers['key-counter-health-changed']({
        payload: {
            permissionGranted: true,
            platform: 'macos',
            listenerRunning: false,
            lastStartError: 'tap failed',
            lastStartedAtMs: null,
            lastStoppedAtMs: 1770000001000,
            bundleIdentifier: 'com.nanzhai.cpa',
            executablePath: '/Applications/桌宠番茄钟.app/Contents/MacOS/app',
            codeSignIdentifier: 'app-461de596266994b3',
        },
    });
    expect(useBindingKeyStore.getState().listenerRunning).toBe(false);
    expect(useBindingKeyStore.getState().listenerError).toBe('tap failed');
});

it('restarts the listener on window focus when permission is granted but listener is stopped', async () => {
    invokeMock.mockImplementation((command: string) => {
        if (command === 'accessibility_status') {
            return Promise.resolve({ granted: true, platform: 'macos' });
        }
        if (command === 'key_counter_health') {
            return Promise.resolve({
                permissionGranted: true,
                platform: 'macos',
                listenerRunning: false,
                lastStartError: 'tap failed',
                lastStartedAtMs: null,
                lastStoppedAtMs: 1770000001000,
                bundleIdentifier: 'com.nanzhai.cpa',
                executablePath: '/Applications/桌宠番茄钟.app/Contents/MacOS/app',
                codeSignIdentifier: 'app-461de596266994b3',
            });
        }
        if (command === 'restart_key_counter_listener') {
            return Promise.resolve({
                permissionGranted: true,
                platform: 'macos',
                listenerRunning: true,
                lastStartError: null,
                lastStartedAtMs: 1770000002000,
                lastStoppedAtMs: 1770000001000,
                bundleIdentifier: 'com.nanzhai.cpa',
                executablePath: '/Applications/桌宠番茄钟.app/Contents/MacOS/app',
                codeSignIdentifier: 'app-461de596266994b3',
            });
        }
        return Promise.resolve();
    });
    listenMock.mockResolvedValue(() => {});

    const { useBindingKeyListener, useBindingKeyStore } = await import('./bindingKey');
    renderHook(() => useBindingKeyListener());
    await new Promise((r) => setTimeout(r, 0));

    window.dispatchEvent(new Event('focus'));
    await new Promise((r) => setTimeout(r, 0));

    expect(invokeMock).toHaveBeenCalledWith('restart_key_counter_listener');
    expect(useBindingKeyStore.getState().listenerRunning).toBe(true);
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
cd app && npx vitest run src/domain/bindingKey.test.ts
```

Expected: FAIL because `useBindingKeyListener` does not call `key_counter_health`, listen to `key-counter-health-changed`, or retry on focus.

- [ ] **Step 3: Implement lifecycle helpers**

In `app/src/domain/bindingKey.ts`, add this helper before `useBindingKeyListener`:

```ts
function applyHealth(health: KeyCounterHealth) {
    useBindingKeyStore.getState().setListenerHealth(health);
}
```

Update `useBindingKeyListener`:

```ts
export function useBindingKeyListener() {
    useEffect(() => {
        let unlistenKey = () => {};
        let unlistenPerm = () => {};
        let unlistenHealth = () => {};
        let cancelled = false;

        invoke<AccessibilityStatus>('accessibility_status').then((s) => {
            if (cancelled) return;
            useBindingKeyStore.getState().setPermission(s.granted, s.platform);
        }).catch(() => { /* 非 Tauri 环境（vitest jsdom）下静默 */ });

        invoke<KeyCounterHealth>('key_counter_health').then((health) => {
            if (cancelled) return;
            applyHealth(health);
        }).catch(() => { /* 非 Tauri 环境（vitest jsdom）下静默 */ });

        listen<number>('key-pressed', (event) => {
            const store = useBindingKeyStore.getState();
            const keyCode = Number(event.payload);
            if (store.capturingId) {
                store.completeCapture(keyCode, labelForKeyCode(keyCode, store.platform));
            } else {
                store.incrementByKeyCode(keyCode);
            }
        }).then((un) => {
            unlistenKey = un;
        });

        listen<{ granted: boolean; platform: 'macos' | 'windows' | 'other' }>('accessibility-permission-changed', (event) => {
            const { granted, platform } = event.payload;
            useBindingKeyStore.getState().setPermission(granted, platform);
        }).then((un) => {
            unlistenPerm = un;
        });

        listen<KeyCounterHealth>('key-counter-health-changed', (event) => {
            applyHealth(event.payload);
        }).then((un) => {
            unlistenHealth = un;
        });

        const refreshOnFocus = () => {
            invoke<KeyCounterHealth>('key_counter_health').then((health) => {
                applyHealth(health);
                if (health.permissionGranted && !health.listenerRunning) {
                    return invoke<KeyCounterHealth>('restart_key_counter_listener');
                }
                return null;
            }).then((health) => {
                if (health) applyHealth(health);
            }).catch(() => { /* 非 Tauri 环境（vitest jsdom）下静默 */ });
        };
        window.addEventListener('focus', refreshOnFocus);

        return () => {
            cancelled = true;
            unlistenKey();
            unlistenPerm();
            unlistenHealth();
            window.removeEventListener('focus', refreshOnFocus);
        };
    }, []);
}
```

- [ ] **Step 4: Run tests to verify pass**

Run:

```bash
cd app && npx vitest run src/domain/bindingKey.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/domain/bindingKey.ts app/src/domain/bindingKey.test.ts
git commit -m "feat: refresh key counter health in listener hook"
```

## Task 3: Rust Listener Health State

**Files:**
- Modify: `app/src-tauri/src/accessibility/mod.rs`
- Modify: `app/src-tauri/src/key_counter.rs`

- [ ] **Step 1: Write failing Rust tests for `ListenerHandle` state**

Add these tests in `app/src-tauri/src/accessibility/mod.rs` under the existing `mod tests`:

```rust
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
```

- [ ] **Step 2: Run Rust tests to verify failure**

Run:

```bash
cd app/src-tauri && cargo test accessibility
```

Expected: FAIL because the test helper methods and health fields do not exist.

- [ ] **Step 3: Implement health state**

In `app/src-tauri/src/accessibility/mod.rs`, replace `ListenerHandle` with state-backed storage:

```rust
#[derive(Default)]
struct ListenerState {
    stop: Option<Arc<AtomicBool>>,
    running: bool,
    last_start_error: Option<String>,
    last_started_at_ms: Option<u64>,
    last_stopped_at_ms: Option<u64>,
}

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
```

Add `KeyCounterHealth`:

```rust
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
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
```

Implement these methods:

```rust
impl ListenerHandle {
    pub fn is_running(&self) -> bool {
        self.inner.lock().unwrap().running
    }

    pub fn health_snapshot(&self) -> KeyCounterHealth {
        self.health_from_status(current_status())
    }

    fn health_from_status(&self, status: AccessibilityStatus) -> KeyCounterHealth {
        let guard = self.inner.lock().unwrap();
        KeyCounterHealth {
            permission_granted: status.granted,
            platform: status.platform,
            listener_running: guard.running,
            last_start_error: guard.last_start_error.clone(),
            last_started_at_ms: guard.last_started_at_ms,
            last_stopped_at_ms: guard.last_stopped_at_ms,
            bundle_identifier: bundle_identifier(),
            executable_path: executable_path(),
            code_sign_identifier: code_sign_identifier(),
        }
    }

    fn record_start_error(&self, stop: &Arc<AtomicBool>, error: String) {
        let mut guard = self.inner.lock().unwrap();
        if guard.stop.as_ref().is_some_and(|current| Arc::ptr_eq(current, stop)) {
            guard.stop = None;
            guard.running = false;
            guard.last_start_error = Some(error);
            guard.last_stopped_at_ms = Some(now_ms());
        }
    }

    pub fn stop(&self) {
        let mut guard = self.inner.lock().unwrap();
        if let Some(stop) = guard.stop.take() {
            stop.store(true, Ordering::Relaxed);
        }
        guard.running = false;
        guard.last_stopped_at_ms = Some(now_ms());
    }
}
```

Add macOS-friendly diagnostics:

```rust
fn app_bundle_root() -> Option<std::path::PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let mut cursor = exe.as_path();
    while let Some(parent) = cursor.parent() {
        if parent.file_name().is_some_and(|name| name == "Contents") {
            return parent.parent().map(std::path::Path::to_path_buf);
        }
        cursor = parent;
    }
    None
}

fn bundle_identifier() -> Option<String> {
    #[cfg(target_os = "macos")]
    {
        let info_plist = app_bundle_root()?.join("Contents/Info.plist");
        let output = std::process::Command::new("/usr/libexec/PlistBuddy")
            .arg("-c")
            .arg("Print :CFBundleIdentifier")
            .arg(info_plist)
            .output()
            .ok()?;
        if !output.status.success() {
            return None;
        }
        let value = String::from_utf8_lossy(&output.stdout).trim().to_string();
        return (!value.is_empty()).then_some(value);
    }
    #[cfg(not(target_os = "macos"))]
    {
        None
    }
}

fn executable_path() -> Option<String> {
    std::env::current_exe()
        .ok()
        .map(|path| path.to_string_lossy().into_owned())
}

fn code_sign_identifier() -> Option<String> {
    #[cfg(target_os = "macos")]
    {
        let exe = std::env::current_exe().ok()?;
        let output = std::process::Command::new("codesign")
            .arg("-dv")
            .arg("--verbose=4")
            .arg(exe)
            .output()
            .ok()?;
        let text = String::from_utf8_lossy(&output.stderr);
        return text.lines()
            .find_map(|line| line.strip_prefix("Identifier=").map(str::to_string));
    }
    #[cfg(not(target_os = "macos"))]
    {
        None
    }
}
```

For tests, expose helper methods inside `impl ListenerHandle` under `#[cfg(test)]`:

```rust
#[cfg(test)]
impl ListenerHandle {
    fn record_start_error_for_test(&self, error: String) {
        let stop = Arc::new(AtomicBool::new(false));
        {
            let mut guard = self.inner.lock().unwrap();
            guard.stop = Some(stop.clone());
            guard.running = true;
        }
        self.record_start_error(&stop, error);
    }

    fn mark_running_for_test(&self) {
        let mut guard = self.inner.lock().unwrap();
        guard.stop = Some(Arc::new(AtomicBool::new(false)));
        guard.running = true;
        guard.last_started_at_ms = Some(now_ms());
    }

    fn health_snapshot_for_test(&self, status: AccessibilityStatus) -> KeyCounterHealth {
        self.health_from_status(status)
    }
}
```

- [ ] **Step 4: Run Rust tests to verify pass**

Run:

```bash
cd app/src-tauri && cargo test accessibility
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src-tauri/src/accessibility/mod.rs
git commit -m "feat: track key counter listener health"
```

## Task 4: Rust Startup Result and Commands

**Files:**
- Modify: `app/src-tauri/src/key_counter.rs`
- Modify: `app/src-tauri/src/accessibility/mod.rs`
- Modify: `app/src-tauri/src/lib.rs`

- [ ] **Step 1: Update macOS `spawn_listener` to report install result**

In `app/src-tauri/src/key_counter.rs`, change the macOS function to use an install channel:

```rust
#[cfg(target_os = "macos")]
pub fn spawn_listener<F>(stop: Arc<AtomicBool>, on_key: F) -> Result<(), String>
where
    F: Fn(i64) + Send + Sync + 'static,
{
    use core_foundation::runloop::{
        kCFRunLoopCommonModes, kCFRunLoopDefaultMode, CFRunLoop, CFRunLoopRunInMode,
    };
    use core_graphics::event::{
        CGEvent, CGEventTap, CGEventTapLocation, CGEventTapOptions, CGEventTapPlacement,
        CGEventType, CallbackResult, EventField,
    };
    use std::sync::mpsc;

    let (install_tx, install_rx) = mpsc::channel::<Result<(), String>>();
    std::thread::spawn(move || {
        let tap = match CGEventTap::new(
            CGEventTapLocation::HID,
            CGEventTapPlacement::HeadInsertEventTap,
            CGEventTapOptions::ListenOnly,
            vec![CGEventType::KeyDown],
            move |_proxy, _event_type, event: &CGEvent| -> CallbackResult {
                let keycode = event.get_integer_value_field(EventField::KEYBOARD_EVENT_KEYCODE);
                on_key(keycode);
                CallbackResult::Keep
            },
        ) {
            Ok(tap) => tap,
            Err(_) => {
                let message = "[key_counter] CGEventTap create failed; Accessibility permission may be missing".to_string();
                let _ = install_tx.send(Err(message.clone()));
                eprintln!("{message}");
                return;
            }
        };

        let loop_source = match tap.mach_port().create_runloop_source(0) {
            Ok(src) => src,
            Err(_) => {
                let message = "[key_counter] failed to create CFRunLoop source".to_string();
                let _ = install_tx.send(Err(message.clone()));
                eprintln!("{message}");
                return;
            }
        };

        unsafe {
            let run_loop = CFRunLoop::get_current();
            run_loop.add_source(&loop_source, kCFRunLoopCommonModes);
            tap.enable();
        }
        let _ = install_tx.send(Ok(()));

        while !stop.load(Ordering::Relaxed) {
            unsafe {
                let _ = CFRunLoopRunInMode(kCFRunLoopDefaultMode, 0.1, 0);
            }
        }

        let _ = loop_source;
        let _ = tap;
    });

    install_rx.recv().map_err(|err| {
        format!("[key_counter] macOS event tap install status channel closed: {err}")
    })?
}
```

- [ ] **Step 2: Update `ensure_running` and emit health**

In `app/src-tauri/src/accessibility/mod.rs`, update `ensure_running` so it marks running only after `spawn_listener` succeeds:

```rust
pub fn ensure_running(&self, app: &AppHandle) {
    let stop = {
        let mut guard = self.inner.lock().unwrap();
        if guard.running {
            return;
        }
        let stop = Arc::new(AtomicBool::new(false));
        guard.stop = Some(stop.clone());
        guard.last_start_error = None;
        stop
    };

    let app_handle = app.clone();
    match crate::key_counter::spawn_listener(stop.clone(), move |keycode| {
        let _ = app_handle.emit("key-pressed", keycode);
    }) {
        Ok(()) => {
            let mut guard = self.inner.lock().unwrap();
            if guard.stop.as_ref().is_some_and(|current| Arc::ptr_eq(current, &stop)) {
                guard.running = true;
                guard.last_start_error = None;
                guard.last_started_at_ms = Some(now_ms());
            }
            emit_health(app, self);
        }
        Err(error) => {
            eprintln!("{error}");
            self.record_start_error(&stop, error);
            emit_health(app, self);
        }
    }
}
```

Add this helper:

```rust
fn emit_health(app: &AppHandle, handle: &ListenerHandle) {
    let _ = app.emit("key-counter-health-changed", handle.health_snapshot());
}
```

Update `start_watcher` so both permission branches call `emit_health(&app, &handle)` after start/stop.

- [ ] **Step 3: Add commands**

In `app/src-tauri/src/accessibility/mod.rs`, add:

```rust
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
    handle.stop();
    handle.ensure_running(&app);
    handle.health_snapshot()
}
```

In `app/src-tauri/src/lib.rs`, register the commands:

```rust
accessibility::key_counter_health,
accessibility::restart_key_counter_listener,
```

Keep the existing `accessibility::key_counter_listening` command for compatibility.

- [ ] **Step 4: Run Rust checks**

Run:

```bash
cd app/src-tauri && cargo test accessibility
cd app/src-tauri && cargo check
```

Expected: both commands PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src-tauri/src/key_counter.rs app/src-tauri/src/accessibility/mod.rs app/src-tauri/src/lib.rs
git commit -m "feat: expose key counter listener health"
```

## Task 5: Settings UI Health Banner

**Files:**
- Modify: `app/src/ui/SettingsPanel.tsx`
- Modify: `app/src/ui/SettingsPanel.test.tsx`
- Modify: `app/src/ui/SettingsPanel.css`

- [ ] **Step 1: Write failing UI tests**

Add these tests after the existing accessibility banner test in `app/src/ui/SettingsPanel.test.tsx`:

```tsx
it('shows listener health banner when permission is granted but listener is stopped', async () => {
    invokeMock.mockImplementation((command: string) => {
        if (command === 'accessibility_status') {
            return Promise.resolve({ granted: true, platform: 'macos' });
        }
        if (command === 'key_counter_health') {
            return Promise.resolve({
                permissionGranted: true,
                platform: 'macos',
                listenerRunning: false,
                lastStartError: '[key_counter] CGEventTap create failed',
                lastStartedAtMs: null,
                lastStoppedAtMs: 1770000001000,
                bundleIdentifier: 'com.nanzhai.cpa',
                executablePath: '/Applications/桌宠番茄钟.app/Contents/MacOS/app',
                codeSignIdentifier: 'app-461de596266994b3',
            });
        }
        return Promise.resolve();
    });
    useBindingKeyStore.setState({
        permissionGranted: true,
        platform: 'macos',
        listenerRunning: false,
        listenerError: '[key_counter] CGEventTap create failed',
        listenerDiagnostic: {
            bundleIdentifier: 'com.nanzhai.cpa',
            executablePath: '/Applications/桌宠番茄钟.app/Contents/MacOS/app',
            codeSignIdentifier: 'app-461de596266994b3',
        },
    });

    await act(async () => {
        render(<SettingsPanel />);
    });

    expect(screen.getByText('已授予权限，但监听器未启动')).toBeTruthy();
    expect(screen.getByText('[key_counter] CGEventTap create failed')).toBeTruthy();
    expect(screen.getByText(/app-461de596266994b3/)).toBeTruthy();
    expect(screen.getByRole('button', { name: '重试监听' })).toBeTruthy();
});

it('retries listener from the settings banner', async () => {
    invokeMock.mockImplementation((command: string) => {
        if (command === 'restart_key_counter_listener') {
            return Promise.resolve({
                permissionGranted: true,
                platform: 'macos',
                listenerRunning: true,
                lastStartError: null,
                lastStartedAtMs: 1770000002000,
                lastStoppedAtMs: 1770000001000,
                bundleIdentifier: 'com.nanzhai.cpa',
                executablePath: '/Applications/桌宠番茄钟.app/Contents/MacOS/app',
                codeSignIdentifier: 'app-461de596266994b3',
            });
        }
        return Promise.resolve({ granted: true, platform: 'macos' });
    });
    useBindingKeyStore.setState({
        permissionGranted: true,
        platform: 'macos',
        listenerRunning: false,
        listenerError: 'tap failed',
        listenerDiagnostic: null,
    });

    await act(async () => {
        render(<SettingsPanel />);
    });
    await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: '重试监听' }));
    });

    expect(invokeMock).toHaveBeenCalledWith('restart_key_counter_listener');
    expect(useBindingKeyStore.getState().listenerRunning).toBe(true);
});
```

- [ ] **Step 2: Run UI tests to verify failure**

Run:

```bash
cd app && npx vitest run src/ui/SettingsPanel.test.tsx
```

Expected: FAIL because the new banner and retry behavior do not exist.

- [ ] **Step 3: Implement settings-window health fetch**

In `app/src/ui/SettingsPanel.tsx`, import `type KeyCounterHealth`:

```ts
import { labelForKeyCode, useBindingKeyStore, type KeyCounterHealth } from '../domain/bindingKey';
```

In `GlobalTab`'s existing permission `useEffect`, add a `key_counter_health` fetch:

```ts
const health = invoke<KeyCounterHealth>('key_counter_health');
if (health && typeof health.then === 'function') {
    health.then((h) => {
        if (cancelled) return;
        useBindingKeyStore.getState().setListenerHealth(h);
    }).catch(() => { /* non-Tauri env (vitest jsdom) — swallow */ });
}
```

Add listener subscription:

```ts
let unlistenHealth = () => {};
listen<KeyCounterHealth>('key-counter-health-changed', (e) => {
    useBindingKeyStore.getState().setListenerHealth(e.payload);
}).then((u) => {
    if (cancelled) u();
    else unlistenHealth = u;
}).catch(() => { /* swallow */ });
```

Call `unlistenHealth()` in cleanup.

- [ ] **Step 4: Render listener banner**

In `GlobalTab`, add:

```ts
const showListenerBanner = bk.permissionGranted && bk.listenerRunning === false;
const retryListener = () => {
    void invoke<KeyCounterHealth>('restart_key_counter_listener')
        .then((health) => {
            useBindingKeyStore.getState().setListenerHealth(health);
        })
        .catch(() => {});
};
```

Under the existing permission banner, render:

```tsx
{showListenerBanner && (
    <div className="bk-perm-banner bk-health-banner" role="status">
        <span className="bk-perm-msg">已授予权限，但监听器未启动</span>
        <button onClick={retryListener}>重试监听</button>
        <button onClick={() => { void invoke('open_accessibility_settings'); }}>
            打开系统设置
        </button>
        {bk.listenerError && (
            <span className="bk-health-detail">{bk.listenerError}</span>
        )}
        {bk.listenerDiagnostic?.codeSignIdentifier && (
            <span className="bk-health-detail">
                签名：{bk.listenerDiagnostic.codeSignIdentifier}
            </span>
        )}
    </div>
)}
```

In `app/src/ui/SettingsPanel.css`, add:

```css
.bk-health-banner {
    align-items: flex-start;
    flex-wrap: wrap;
}

.bk-health-detail {
    width: 100%;
    color: var(--text-muted);
    font-size: 11px;
    line-height: 1.35;
    word-break: break-all;
}
```

- [ ] **Step 5: Run UI tests to verify pass**

Run:

```bash
cd app && npx vitest run src/ui/SettingsPanel.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/src/ui/SettingsPanel.tsx app/src/ui/SettingsPanel.test.tsx app/src/ui/SettingsPanel.css
git commit -m "feat: show key counter listener health"
```

## Task 6: Full Verification

**Files:**
- No source changes expected.

- [ ] **Step 1: Run focused frontend tests**

Run:

```bash
cd app && npx vitest run src/domain/bindingKey.test.ts src/ui/SettingsPanel.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run all frontend tests**

Run:

```bash
cd app && npm test
```

Expected: PASS.

- [ ] **Step 3: Run frontend build**

Run:

```bash
cd app && npm run build
```

Expected: PASS with Vite build output in `app/dist`.

- [ ] **Step 4: Run Rust tests and check**

Run:

```bash
cd app/src-tauri && cargo test && cargo check
```

Expected: PASS.

- [ ] **Step 5: Manual macOS smoke check**

Run the installed or dev app. In the settings page:

1. If Accessibility is revoked, the existing permission banner appears.
2. After granting permission, the listener banner disappears once listener starts.
3. If listener startup fails, the UI shows `已授予权限，但监听器未启动` plus the last error and signature identifier.
4. Click `重试监听`, press a key while a binding is listening, and confirm the binding completes.

- [ ] **Step 6: Commit verification fixes if a previous verification step fails**

If a verification step fails, return to the task that owns the failing file, make the smallest fix there, rerun that task's focused command, then commit the exact file set from that task. For example, if only the settings banner test fails after Task 5:

```bash
git add app/src/ui/SettingsPanel.tsx app/src/ui/SettingsPanel.test.tsx app/src/ui/SettingsPanel.css
git commit -m "fix: stabilize key counter listener health"
```
