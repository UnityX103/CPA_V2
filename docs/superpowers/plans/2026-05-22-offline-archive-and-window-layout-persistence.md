# Offline Archive And Window Layout Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make archive settings recover offline or from a restored account cloud archive, and persist each app window's local position and size.

**Architecture:** Keep `userPreferencesPersistence` as the archive boundary and make `App.tsx` choose the startup archive source after a bounded account restore attempt. Add a Rust `window_layout` module that owns machine-local layout JSON, applies saved bounds before windows show, and records window move/resize events for supported labels.

**Tech Stack:** React 19, TypeScript, Zustand, Vitest/jsdom, Tauri 2 Rust, serde/serde_json, existing Tauri window APIs.

---

## File Structure

- Modify `app/src/App.tsx`: choose local or cloud archive after account restore, then subscribe to local saves.
- Modify `app/src/App.test.tsx`: cover local fallback, cloud preference, and restore timeout.
- Modify `app/src/domain/cloudAccountSync.ts`: save cloud-applied archives locally and keep logged-in changes local-first.
- Modify `app/src/domain/cloudAccountSync.test.tsx`: cover cloud pull local save and logged-in local save.
- Create `app/src-tauri/src/window_layout.rs`: validate/load/save/apply/track local window layouts.
- Modify `app/src-tauri/src/scaled_window.rs`: preserve top-left origin when scaled sizes change.
- Modify `app/src-tauri/src/lib.rs`: register layout tracking and apply saved layouts before showing hidden windows.

## Task 1: Startup Archive Source Selection

**Files:**
- Modify: `app/src/App.tsx`
- Test: `app/src/App.test.tsx`

- [ ] **Step 1: Write the failing local-fallback test**

Add this test near the existing startup hydration tests:

```tsx
it('uses local archive when account restore leaves the app as guest', async () => {
    loadPersistedUserPreferencesMock.mockResolvedValue({
        schemaVersion: 1,
        pomodoro: {
            focusDurationSeconds: 900,
            breakDurationSeconds: 120,
            totalRounds: 2,
            autoStartBreak: true,
            endActionMode: 'topWindow',
            endActionVideo: { sourceKind: 'builtin', builtinVideoId: 'qianqian', customVideoPath: '' },
        },
        settings: { uiScale: 1.25, autostartEnabled: false },
        appUpdate: { autoUpdateEnabled: false },
        network: { autoConnect: true, playerName: 'Alice' },
        bindingKey: { panelEnabled: true, entries: [], syncedKeyId: null },
        checkin: { weeklyPlan: defaultWeeklyPlan('2026-05-18'), dailyRecords: {} },
    });
    restoreAccountSession.mockImplementation(async () => {
        useNetworkStore.setState({ accountStatus: 'guest' });
    });

    render(<App />);

    await waitFor(() => expect(usePomodoroStore.getState().focusDurationSeconds).toBe(900));
    expect(useNetworkStore.getState().playerName).toBe('Alice');
    expect(savePersistedUserPreferencesMock).toHaveBeenCalledWith(expect.objectContaining({
        pomodoro: expect.objectContaining({ focusDurationSeconds: 900 }),
    }));
});
```

- [ ] **Step 2: Write the failing cloud-preferred test**

Add this test after the local-fallback test:

```tsx
it('prefers cloud archive when saved session restores successfully', async () => {
    loadPersistedUserPreferencesMock.mockResolvedValue({
        schemaVersion: 1,
        pomodoro: {
            focusDurationSeconds: 900,
            breakDurationSeconds: 120,
            totalRounds: 2,
            autoStartBreak: false,
            endActionMode: 'playVideo',
            endActionVideo: { sourceKind: 'builtin', builtinVideoId: 'default', customVideoPath: '' },
        },
        settings: { uiScale: 1.1, autostartEnabled: false },
        appUpdate: { autoUpdateEnabled: true },
        network: { autoConnect: false, playerName: 'Local' },
        bindingKey: { panelEnabled: true, entries: [], syncedKeyId: null },
        checkin: { weeklyPlan: defaultWeeklyPlan('2026-05-18'), dailyRecords: {} },
    });
    restoreAccountSession.mockImplementation(async () => {
        useNetworkStore.setState({
            accountStatus: 'loggedIn',
            accountUser: { userId: 'u1', username: 'Alice' },
            cloudSyncStatus: 'synced',
            cloudDataUpdatedAt: 10,
            cloudData: {
                schemaVersion: 1,
                updatedAt: 10,
                pomodoro: {
                    focusDurationSeconds: 1800,
                    breakDurationSeconds: 300,
                    totalRounds: 3,
                    autoStartBreak: true,
                    endActionMode: 'topWindow',
                    endActionVideo: { sourceKind: 'builtin', builtinVideoId: 'qianqian', customVideoPath: '' },
                },
                settings: { uiScale: 1.4, autostartEnabled: false },
                appUpdate: { autoUpdateEnabled: false },
                network: { autoConnect: true, playerName: 'Cloud' },
                bindingKey: { panelEnabled: false, entries: [], syncedKeyId: null },
                checkin: { weeklyPlan: defaultWeeklyPlan('2026-05-18'), dailyRecords: {} },
            },
        });
    });

    render(<App />);

    await waitFor(() => expect(usePomodoroStore.getState().focusDurationSeconds).toBe(1800));
    expect(useNetworkStore.getState().playerName).toBe('Cloud');
    expect(savePersistedUserPreferencesMock).toHaveBeenCalledWith(expect.objectContaining({
        pomodoro: expect.objectContaining({ focusDurationSeconds: 1800 }),
        network: expect.objectContaining({ playerName: 'Cloud' }),
    }));
});
```

- [ ] **Step 3: Run tests to verify red**

Run: `cd app && npx vitest run src/App.test.tsx`

Expected: the cloud-preferred test fails because current startup hydrates local preferences before account restore.

- [ ] **Step 4: Implement bounded startup archive selection**

Add this helper block in `app/src/App.tsx` near the startup helpers:

```ts
const STARTUP_ACCOUNT_RESTORE_TIMEOUT_MS = 2500;

type StartupArchiveSource = 'local' | 'cloud';

function waitForNetworkStartupResult(timeoutMs = STARTUP_ACCOUNT_RESTORE_TIMEOUT_MS): Promise<StartupArchiveSource> {
    const current = useNetworkStore.getState();
    if (current.accountStatus === 'loggedIn' && current.cloudSyncStatus === 'synced') {
        return Promise.resolve(current.cloudData ? 'cloud' : 'local');
    }
    if (current.accountStatus !== 'checking' && current.accountStatus !== 'loggingIn') {
        return Promise.resolve('local');
    }

    return new Promise((resolve) => {
        let settled = false;
        const finish = (source: StartupArchiveSource) => {
            if (settled) return;
            settled = true;
            window.clearTimeout(timer);
            unsubscribe();
            resolve(source);
        };
        const timer = window.setTimeout(() => finish('local'), timeoutMs);
        const unsubscribe = useNetworkStore.subscribe((state) => {
            if (state.accountStatus === 'loggedIn' && state.cloudSyncStatus === 'synced') {
                finish(state.cloudData ? 'cloud' : 'local');
            } else if (
                state.accountStatus === 'guest'
                || state.accountStatus === 'error'
                || state.cloudSyncStatus === 'offline'
            ) {
                finish('local');
            }
        });
    });
}
```

In `hydrateAndSubscribe`, keep loading local/legacy persistence first, call `restoreAccountSession()`, wait for `waitForNetworkStartupResult()`, and hydrate from `useNetworkStore.getState().cloudData` only when the result is `cloud`. Otherwise use the local/legacy snapshot. Save the final applied snapshot before calling `subscribeLocalPreferences`.

- [ ] **Step 5: Run tests to verify green**

Run: `cd app && npx vitest run src/App.test.tsx`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/src/App.tsx app/src/App.test.tsx
git commit -m "feat: choose startup archive after account restore"
```

## Task 2: Cloud Pull Local Archive Update

**Files:**
- Modify: `app/src/domain/cloudAccountSync.ts`
- Test: `app/src/domain/cloudAccountSync.test.tsx`

- [ ] **Step 1: Write the failing logged-in local-save test**

Add this test:

```tsx
it('saves local archive when logged-in durable settings change before cloud debounce fires', () => {
    renderHook(() => useCloudAccountSync());

    act(() => {
        useNetworkStore.setState({ accountStatus: 'loggedIn', cloudSyncStatus: 'synced' });
        usePomodoroStore.getState().applySettings(840, 120, 4, true, false);
    });

    expect(savePersistedUserPreferencesMock).toHaveBeenCalledWith(expect.objectContaining({
        pomodoro: expect.objectContaining({ focusDurationSeconds: 840 }),
    }));
});
```

- [ ] **Step 2: Run tests to verify red**

Run: `cd app && npx vitest run src/domain/cloudAccountSync.test.tsx`

Expected: the new test fails if logged-in local changes only schedule cloud save.

- [ ] **Step 3: Implement local-first saves in cloud sync**

Inside the `useCloudAccountSync` effect, add:

```ts
const saveLocalNow = () => {
    if (hydratingRef.current) return;
    void savePersistedUserPreferences(buildCloudAccountData(stores));
};
```

Call `saveLocalNow()` before `scheduleSave()` in every durable store subscription that currently calls only `scheduleSave()`. Do not call it from the cloud hydration branch because that branch already calls `savePersistedUserPreferences(buildCloudAccountData(stores))` after applying cloud data.

- [ ] **Step 4: Run tests to verify green**

Run: `cd app && npx vitest run src/domain/cloudAccountSync.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/domain/cloudAccountSync.ts app/src/domain/cloudAccountSync.test.tsx
git commit -m "feat: save logged-in archive changes locally"
```

## Task 3: Local Window Layout Core

**Files:**
- Create: `app/src-tauri/src/window_layout.rs`
- Modify: `app/src-tauri/src/lib.rs`
- Test: `app/src-tauri/src/window_layout.rs`

- [ ] **Step 1: Write failing Rust tests with the module skeleton**

Create `app/src-tauri/src/window_layout.rs` with:

```rust
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedWindowLayout {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

pub fn is_supported_window_label(label: &str) -> bool {
    matches!(label, "main" | "settings" | "today-checkin" | "checkin-editor" | "input-counter")
}

pub fn normalize_layout(layout: SavedWindowLayout, min_width: f64, min_height: f64) -> Option<SavedWindowLayout> {
    if !layout.x.is_finite() || !layout.y.is_finite() || !layout.width.is_finite() || !layout.height.is_finite() {
        return None;
    }
    if layout.width < min_width || layout.height < min_height {
        return None;
    }
    Some(layout)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn supported_labels_are_explicit() {
        assert!(is_supported_window_label("main"));
        assert!(is_supported_window_label("settings"));
        assert!(is_supported_window_label("today-checkin"));
        assert!(is_supported_window_label("checkin-editor"));
        assert!(is_supported_window_label("input-counter"));
        assert!(!is_supported_window_label("remote-player"));
    }

    #[test]
    fn normalize_layout_rejects_bad_values() {
        assert!(normalize_layout(SavedWindowLayout { x: 0.0, y: 0.0, width: 300.0, height: 200.0 }, 100.0, 100.0).is_some());
        assert!(normalize_layout(SavedWindowLayout { x: f64::NAN, y: 0.0, width: 300.0, height: 200.0 }, 100.0, 100.0).is_none());
        assert!(normalize_layout(SavedWindowLayout { x: 0.0, y: 0.0, width: 10.0, height: 200.0 }, 100.0, 100.0).is_none());
    }
}
```

- [ ] **Step 2: Run tests to verify red**

Run: `cd app/src-tauri && cargo test window_layout`

Expected: compile failure until `mod window_layout;` is added.

- [ ] **Step 3: Implement persistence and tracking**

Expand `window_layout.rs` with serde JSON file persistence under `app.path().app_config_dir().join("window-layouts.json")`, plus:

```rust
pub fn load_layout(app: &tauri::AppHandle, label: &str, min_width: f64, min_height: f64) -> Option<SavedWindowLayout>;
pub fn save_current_layout(app: &tauri::AppHandle, window: &tauri::WebviewWindow, label: &str) -> Result<(), String>;
pub fn apply_layout(window: &tauri::WebviewWindow, layout: SavedWindowLayout) -> Result<(), String>;
pub fn install_tracking(app: tauri::AppHandle, label: &'static str);
```

`save_current_layout` should convert physical outer position and size to logical values using `window.scale_factor()`. `install_tracking` should listen for `tauri::WindowEvent::Moved(_)` and `tauri::WindowEvent::Resized(_)` and save the current layout.

- [ ] **Step 4: Run tests to verify green**

Run: `cd app/src-tauri && cargo test window_layout`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src-tauri/src/window_layout.rs app/src-tauri/src/lib.rs
git commit -m "feat: add local window layout store"
```

## Task 4: Restore Layouts During Resize And Show

**Files:**
- Modify: `app/src-tauri/src/scaled_window.rs`
- Modify: `app/src-tauri/src/lib.rs`
- Modify: `app/src/domain/scaledWindow.ts`
- Test: `app/src/domain/scaledWindow.test.tsx`, Rust tests in `app/src-tauri/src/scaled_window.rs`

- [ ] **Step 1: Write failing tests for default centering semantics**

In `scaledWindow.test.tsx`, update the settings assertion to use `defaultCenter: true`:

```tsx
expect(invokeMock).toHaveBeenCalledWith('resize_scaled_window', {
    args: {
        label: 'settings',
        baseWidth: 460,
        baseHeight: 440,
        minWidth: 360,
        minHeight: 320,
        scale: 2,
        defaultCenter: true,
    },
});
```

In `scaled_window.rs`, add:

```rust
#[test]
fn resize_origin_prefers_existing_origin_over_default_center() {
    let monitor = LogicalRect { x: 0.0, y: 0.0, width: 1000.0, height: 800.0 };
    let size = LogicalSizePair { width: 400.0, height: 300.0 };
    let origin = origin_for_resize(Some((50.0, 60.0)), true, monitor, size);
    assert_eq!(origin, (50.0, 60.0));
}
```

- [ ] **Step 2: Run tests to verify red**

Run:

```bash
cd app && npx vitest run src/domain/scaledWindow.test.tsx
cd app/src-tauri && cargo test scaled_window
```

Expected: FAIL because `defaultCenter` and `origin_for_resize` do not exist.

- [ ] **Step 3: Implement layout-aware resize and show**

In `app/src/domain/scaledWindow.ts`, rename the invoke payload field from `center` to `defaultCenter`.

In `scaled_window.rs`, change the args struct to:

```rust
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResizeScaledWindowArgs {
    pub label: String,
    pub base_width: f64,
    pub base_height: f64,
    pub scale: f64,
    pub min_width: f64,
    pub min_height: f64,
    #[serde(default, alias = "center")]
    pub default_center: bool,
}
```

Add:

```rust
pub fn origin_for_resize(
    existing_origin: Option<(f64, f64)>,
    default_center: bool,
    monitor: LogicalRect,
    size: LogicalSizePair,
) -> (f64, f64) {
    let origin = existing_origin.unwrap_or_else(|| {
        if default_center {
            centered_origin(monitor, size)
        } else {
            (monitor.x + WINDOW_EDGE_MARGIN, monitor.y + WINDOW_EDGE_MARGIN)
        }
    });
    clamp_origin_to_monitor(origin, monitor, size, WINDOW_EDGE_MARGIN)
}
```

Use `window_layout::load_layout` to prefer a saved origin. If there is no saved layout, use the current origin for non-centered windows and centered origin for default-centered windows. After setting size/position, call `window_layout::save_current_layout`.

In `lib.rs`, add `mod window_layout;`, call `window_layout::install_tracking` for all supported labels after hidden windows are built, and update `open_settings_window_impl` so saved settings layout is applied instead of unconditional `settings_center_position`.

- [ ] **Step 4: Run tests to verify green**

Run:

```bash
cd app && npx vitest run src/domain/scaledWindow.test.tsx src/checkinWindowConfig.test.ts src/inputCounterWindowConfig.test.ts src/windowLayoutConfig.test.ts
cd app/src-tauri && cargo test scaled_window window_layout
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/domain/scaledWindow.ts app/src/domain/scaledWindow.test.tsx app/src-tauri/src/scaled_window.rs app/src-tauri/src/lib.rs app/src-tauri/src/window_layout.rs app/src/checkinWindowConfig.test.ts app/src/inputCounterWindowConfig.test.ts app/src/windowLayoutConfig.test.ts
git commit -m "feat: restore local window layouts"
```

## Task 5: Full Verification

**Files:**
- No new implementation files unless verification exposes a missed integration.

- [ ] **Step 1: Run frontend suite**

Run: `cd app && npm test`

Expected: PASS.

- [ ] **Step 2: Run Rust suite**

Run: `cd app/src-tauri && cargo test`

Expected: PASS.

- [ ] **Step 3: Run build**

Run: `cd app && npm run build`

Expected: PASS.

- [ ] **Step 4: Confirm window layout is not in cloud/archive data**

Run: `rg -n "window|layout|position|width|height" app/src/domain/userPreferences.ts app/src/domain/cloudAccountData.ts app/src-tauri/src/window_layout.rs`

Expected: only `window_layout.rs` contains persisted window layout concepts; `UserPreferencesSnapshot` and `CloudAccountData` do not include window position or size.

- [ ] **Step 5: Commit verification fixes if needed**

```bash
git add app docs/superpowers/plans/2026-05-22-offline-archive-and-window-layout-persistence.md
git commit -m "test: verify offline archive and window layout persistence"
```

