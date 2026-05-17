# Pomodoro Main Window Fit-Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Pomodoro main window the same size as the Pomodoro panel host and remove obsolete main-window transparent hit-test passthrough.

**Architecture:** The main Tauri window becomes a fixed-size host for `PomodoroPanel` only. The old DOM hit-region registry and native main-window passthrough are removed; settings-window first-mouse and focus-restoration helpers are preserved under a clearer native helper module.

**Tech Stack:** Tauri 2, Rust, React 19, TypeScript, Vitest, jsdom, native CSS.

---

## File Structure

- Create: `app/src/App.test.tsx`
  - Static/render regression test that the main React app renders `PomodoroPanel` and not `RemoteRoster`.
- Create: `app/src/windowLayoutConfig.test.ts`
  - Static config tests for main-window sizing, `.app-root` sizing, and deletion of hit-region command wiring.
- Modify: `app/src/App.tsx`
  - Remove `RemoteRoster` from the main window.
- Modify: `app/src/main.tsx`
  - Remove `clearHitRegions()` import and boot-time call.
- Modify: `app/src/ui/PomodoroPanel.tsx`
  - Remove `useHitRegion`.
- Modify: `app/src/ui/RemoteRoster.tsx`
  - Remove `useHitRegion`; leave component usable by its separate window path.
- Modify: `app/src/styles/global.css`
  - Make root and `.app-root` fit content instead of filling the whole Tauri window.
- Delete: `app/src/domain/passthrough.ts`
- Delete: `app/src/domain/passthrough.test.tsx`
- Modify: `app/src-tauri/tauri.conf.json`
  - Resize the main window to `249 x 171`, disable resizing.
- Rename: `app/src-tauri/src/passthrough/` -> `app/src-tauri/src/window_helpers/`
  - Preserve settings first-mouse/focus helpers.
  - Remove main-window hit-region store and native passthrough.
- Modify: `app/src-tauri/src/lib.rs`
  - Replace `passthrough` references with `window_helpers`.
  - Remove `set_click_through`, hit-store management, main-window `install`, and hit-region commands.
- Modify: `app/src-tauri/tests/settings_crash_regression.rs`
  - Update comments from `passthrough::install_first_mouse_only_impl` to `window_helpers::install_first_mouse_only_impl`.
- Modify: `app/src-tauri/tests/focus_restore_regression.rs`
  - Update comments if they refer to the old module name.

## Constants

- Pomodoro panel size: `233 x 155`
- Host padding: `8px` on each edge
- Main window inner size: `249 x 171`

---

### Task 1: Lock Main-Window React Ownership

**Files:**
- Create: `app/src/App.test.tsx`
- Modify: `app/src/App.tsx`

- [ ] **Step 1: Write the failing test**

Create `app/src/App.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const { useStateSync, useActiveAppListener, useBindingKeyListener, useBridgeHost } = vi.hoisted(() => ({
    useStateSync: vi.fn(),
    useActiveAppListener: vi.fn(),
    useBindingKeyListener: vi.fn(),
    useBridgeHost: vi.fn(),
}));

vi.mock('./domain/stateSync', () => ({ useStateSync }));
vi.mock('./domain/activeApp', () => ({ useActiveAppListener }));
vi.mock('./domain/bindingKey', () => ({ useBindingKeyListener }));
vi.mock('./domain/bridge/host', () => ({ useBridgeHost }));
vi.mock('./ui/PomodoroPanel', () => ({
    PomodoroPanel: () => <div data-testid="pomodoro-panel" />,
}));
vi.mock('./ui/RemoteRoster', () => ({
    RemoteRoster: () => <div data-testid="remote-roster" />,
}));

const { default: App } = await import('./App');

describe('main App window composition', () => {
    it('renders only the Pomodoro panel in the main window', () => {
        render(<App />);

        expect(screen.getByTestId('pomodoro-panel')).toBeInTheDocument();
        expect(screen.queryByTestId('remote-roster')).toBeNull();
        expect(useStateSync).toHaveBeenCalledTimes(1);
        expect(useActiveAppListener).toHaveBeenCalledTimes(1);
        expect(useBindingKeyListener).toHaveBeenCalledTimes(1);
        expect(useBridgeHost).toHaveBeenCalledTimes(1);
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
cd app && npx vitest run src/App.test.tsx
```

Expected: FAIL because `remote-roster` is still rendered by `App.tsx`.

- [ ] **Step 3: Remove RemoteRoster from the main app**

Replace `app/src/App.tsx` with:

```tsx
import { PomodoroPanel } from './ui/PomodoroPanel';
import { useStateSync } from './domain/stateSync';
import { useActiveAppListener } from './domain/activeApp';
import { useBindingKeyListener } from './domain/bindingKey';
import { useBridgeHost } from './domain/bridge/host';

export default function App() {
    useStateSync();
    useActiveAppListener();
    useBindingKeyListener();
    useBridgeHost();
    return (
        <div className="app-root">
            <PomodoroPanel />
        </div>
    );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run:

```bash
cd app && npx vitest run src/App.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/App.tsx app/src/App.test.tsx
git commit -m "test: lock main window to pomodoro panel"
```

---

### Task 2: Remove Frontend Hit-Region Lifecycle

**Files:**
- Modify: `app/src/ui/PomodoroPanel.test.tsx`
- Modify: `app/src/ui/PomodoroPanel.tsx`
- Modify: `app/src/ui/RemoteRoster.tsx`
- Modify: `app/src/main.tsx`
- Delete: `app/src/domain/passthrough.ts`
- Delete: `app/src/domain/passthrough.test.tsx`

- [ ] **Step 1: Add a failing regression test for obsolete hit-region calls**

Append this test inside `describe('PomodoroPanel HApJ0 pin behaviour', ...)` in `app/src/ui/PomodoroPanel.test.tsx`:

```tsx
    it('does not register obsolete transparent hit regions', async () => {
        render(<PomodoroPanel />);

        await waitFor(() => {
            expect(pinCalls()).toContainEqual(['set_main_window_pinned', { onTop: false }]);
        });

        const obsoleteCommands = invokeMock.mock.calls
            .map(([cmd]) => cmd)
            .filter((cmd) => cmd === 'register_hit_region' || cmd === 'unregister_hit_region' || cmd === 'clear_hit_regions');

        expect(obsoleteCommands).toEqual([]);
    });
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
cd app && npx vitest run src/ui/PomodoroPanel.test.tsx
```

Expected: FAIL because `PomodoroPanel` still uses `useHitRegion('pomodoro-panel')`.

- [ ] **Step 3: Remove `useHitRegion` from PomodoroPanel**

In `app/src/ui/PomodoroPanel.tsx`, delete:

```tsx
import { useHitRegion } from '../domain/passthrough';
```

Delete this line inside `PomodoroPanel()`:

```tsx
    const hitRef = useHitRegion('pomodoro-panel');
```

Change the root element from:

```tsx
        <div ref={hitRef} className="pomo-panel" data-clock-state={clockState}>
```

to:

```tsx
        <div className="pomo-panel" data-clock-state={clockState}>
```

- [ ] **Step 4: Remove `useHitRegion` from RemoteRoster**

In `app/src/ui/RemoteRoster.tsx`, delete:

```tsx
import { useHitRegion } from '../domain/passthrough';
```

Delete this line inside `RemoteRoster()`:

```tsx
    const hitRef = useHitRegion('remote-roster');
```

Change the root element from:

```tsx
        <div ref={hitRef} className="remote-roster">
```

to:

```tsx
        <div className="remote-roster">
```

- [ ] **Step 5: Remove boot-time hit-region clearing**

In `app/src/main.tsx`, delete:

```tsx
import { clearHitRegions } from "./domain/passthrough";
```

Delete:

```tsx
// 仅主窗口需要重置透传命中表；子窗口（设置 / dev-align）有自己的窗体，不参与 passthrough。
if (!which) {
    void clearHitRegions();
}
```

The remaining file should be:

```tsx
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import SettingsApp from "./SettingsApp";
import DevAlignApp from "./DevAlignApp";
import "./styles/global.css";

const which = new URLSearchParams(window.location.search).get("window");
const Root = which === "settings" ? SettingsApp : which === "devalign" ? DevAlignApp : App;

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
        <Root />
    </React.StrictMode>,
);
```

- [ ] **Step 6: Delete the frontend passthrough module and tests**

Run:

```bash
rm app/src/domain/passthrough.ts app/src/domain/passthrough.test.tsx
```

- [ ] **Step 7: Verify no frontend hit-region references remain**

Run:

```bash
rg -n "passthrough|useHitRegion|register_hit_region|unregister_hit_region|clear_hit_regions" app/src
```

Expected: no output.

- [ ] **Step 8: Run focused frontend tests**

Run:

```bash
cd app && npx vitest run src/ui/PomodoroPanel.test.tsx src/App.test.tsx
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add app/src/ui/PomodoroPanel.test.tsx app/src/ui/PomodoroPanel.tsx app/src/ui/RemoteRoster.tsx app/src/main.tsx app/src/domain/passthrough.ts app/src/domain/passthrough.test.tsx
git commit -m "refactor: remove frontend hit region lifecycle"
```

---

### Task 3: Shrink Main Window and Root Layout

**Files:**
- Create: `app/src/windowLayoutConfig.test.ts`
- Modify: `app/src/styles/global.css`
- Modify: `app/src-tauri/tauri.conf.json`

- [ ] **Step 1: Write failing static configuration tests**

Create `app/src/windowLayoutConfig.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const tauriConfPath = path.join(here, '../src-tauri/tauri.conf.json');
const globalCssPath = path.join(here, 'styles/global.css');
const libRsPath = path.join(here, '../src-tauri/src/lib.rs');

function blockAfter(source: string, selector: string): string {
    const index = source.indexOf(selector);
    expect(index, `${selector} should exist`).toBeGreaterThanOrEqual(0);
    const start = source.indexOf('{', index);
    expect(start, `${selector} should have a block`).toBeGreaterThanOrEqual(0);
    let depth = 0;
    for (let i = start; i < source.length; i += 1) {
        if (source[i] === '{') depth += 1;
        if (source[i] === '}') {
            depth -= 1;
            if (depth === 0) return source.slice(start + 1, i);
        }
    }
    throw new Error(`${selector} block did not close`);
}

describe('main window fit-panel layout', () => {
    it('sizes the main Tauri window to the Pomodoro panel host', () => {
        const conf = JSON.parse(readFileSync(tauriConfPath, 'utf8'));
        const main = conf.app.windows.find((w: { label?: string }) => w.label === 'main');

        expect(main).toBeTruthy();
        expect(main.width).toBe(249);
        expect(main.height).toBe(171);
        expect(main.minWidth).toBe(249);
        expect(main.minHeight).toBe(171);
        expect(main.resizable).toBe(false);
    });

    it('does not force the root layout to fill a large transparent viewport', () => {
        const css = readFileSync(globalCssPath, 'utf8');
        const rootBlock = blockAfter(css, 'html, body, #root');
        const appRootBlock = blockAfter(css, '.app-root');

        expect(rootBlock).not.toMatch(/\bheight\s*:\s*100%\s*;/);
        expect(appRootBlock).not.toMatch(/\bwidth\s*:\s*100vw\s*;/);
        expect(appRootBlock).not.toMatch(/\bheight\s*:\s*100vh\s*;/);
        expect(appRootBlock).toMatch(/\bwidth\s*:\s*fit-content\s*;/);
        expect(appRootBlock).toMatch(/\bheight\s*:\s*fit-content\s*;/);
        expect(appRootBlock).toMatch(/\bpadding\s*:\s*8px\s*;/);
    });

    it('does not expose obsolete hit-region commands in the Tauri invoke surface', () => {
        const source = readFileSync(libRsPath, 'utf8');

        expect(source).not.toMatch(/\bset_click_through\b/);
        expect(source).not.toMatch(/\bregister_hit_region\b/);
        expect(source).not.toMatch(/\bunregister_hit_region\b/);
        expect(source).not.toMatch(/\bclear_hit_regions\b/);
    });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
cd app && npx vitest run src/windowLayoutConfig.test.ts
```

Expected: FAIL because the main window is still `1100 x 680`, `.app-root` still uses `100vw/100vh`, and Rust still exposes hit-region commands.

- [ ] **Step 3: Update global CSS**

In `app/src/styles/global.css`, change:

```css
html, body, #root {
    height: 100%;
    margin: 0;
    padding: 0;
    background: transparent !important;
    font-family: var(--font-cn);
    color: var(--text-primary);
    user-select: none;
    -webkit-user-select: none;
    overflow: hidden;
}
```

to:

```css
html, body, #root {
    margin: 0;
    padding: 0;
    background: transparent !important;
    font-family: var(--font-cn);
    color: var(--text-primary);
    user-select: none;
    -webkit-user-select: none;
    overflow: hidden;
}
```

Change `.app-root` from:

```css
.app-root {
    width: 100vw;
    height: 100vh;
    display: flex;
    align-items: flex-start;
    justify-content: flex-start;
    padding: 8px;
}
```

to:

```css
.app-root {
    width: fit-content;
    height: fit-content;
    display: flex;
    align-items: flex-start;
    justify-content: flex-start;
    padding: 8px;
}
```

- [ ] **Step 4: Update Tauri main window config**

In `app/src-tauri/tauri.conf.json`, update the main window block values:

```json
        "width": 249,
        "height": 171,
        "minWidth": 249,
        "minHeight": 171,
        "transparent": true,
        "decorations": false,
        "shadow": false,
        "resizable": false,
```

- [ ] **Step 5: Run partial tests**

Run:

```bash
cd app && npx vitest run src/windowLayoutConfig.test.ts
```

Expected: still FAIL on the Rust hit-region command assertions until Task 4 removes native command wiring. The size and CSS assertions should pass.

- [ ] **Step 6: Commit the layout/config part**

```bash
git add app/src/windowLayoutConfig.test.ts app/src/styles/global.css app/src-tauri/tauri.conf.json
git commit -m "fix: shrink main window to pomodoro panel host"
```

---

### Task 4: Remove Native Main-Window Passthrough and Preserve Window Helpers

**Files:**
- Rename: `app/src-tauri/src/passthrough/` -> `app/src-tauri/src/window_helpers/`
- Modify: `app/src-tauri/src/window_helpers/mod.rs`
- Modify: `app/src-tauri/src/window_helpers/macos.rs`
- Modify: `app/src-tauri/src/window_helpers/windows.rs`
- Modify: `app/src-tauri/src/window_helpers/stub.rs`
- Modify: `app/src-tauri/src/lib.rs`
- Modify: `app/src-tauri/tests/settings_crash_regression.rs`
- Modify: `app/src-tauri/tests/focus_restore_regression.rs`

- [ ] **Step 1: Rename the native helper module**

Run:

```bash
git mv app/src-tauri/src/passthrough app/src-tauri/src/window_helpers
```

- [ ] **Step 2: Replace the platform-neutral helper module**

Replace `app/src-tauri/src/window_helpers/mod.rs` with:

```rust
//! Window helper utilities that are not app-domain state:
//! - settings-window first-mouse support
//! - settings focus restoration after main-window moves/resizes
//! - monitor-centered window positioning math

use tauri::WebviewWindow;

#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "windows")]
mod windows;
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
mod stub;

/// 计算 window 在 monitor 上水平 + 垂直居中时的左上角原点（logical pixel）。
/// 不对结果做 clamp —— 若 window 比 monitor 大，结果可能小于 monitor 起点，
/// OS 自行处理（多数情况下会自动移到可见区）。
pub fn compute_centered_origin(
    monitor_pos: (i32, i32),
    monitor_size: (u32, u32),
    window_size: (u32, u32),
) -> (i32, i32) {
    let x = monitor_pos.0 + (monitor_size.0 as i32 - window_size.0 as i32) / 2;
    let y = monitor_pos.1 + (monitor_size.1 as i32 - window_size.1 as i32) / 2;
    (x, y)
}

/// 给一个 webview 窗口装上「接受 first-mouse」原生 hook（只解决首次点击不送 mouseDown
/// 的问题，不带 hit-test 透传逻辑）。用于设置窗口等不参与穿透的子窗。
pub fn install_first_mouse_only(window: &WebviewWindow) {
    #[cfg(target_os = "macos")]
    macos::install_first_mouse_only_impl(window);
    #[cfg(target_os = "windows")]
    windows::install_first_mouse_only_impl(window);
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    stub::install_first_mouse_only_impl(window);
}

/// 在主窗口上安装「用户拖/resize 结束后把 key 还给 settings」的监听。
/// macOS: NSWindowDidMoveNotification observer。Windows: Tauri moved/resized events。
/// Stub: no-op。失败仅打日志，不阻断启动。
pub fn install_focus_restorer(main_window: &WebviewWindow, app: tauri::AppHandle) {
    #[cfg(target_os = "macos")]
    macos::install_focus_restorer_impl(main_window, app);
    #[cfg(target_os = "windows")]
    windows::install_focus_restorer_impl(main_window, app);
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    stub::install_focus_restorer_impl(main_window, app);
}

/// 仅用于集成测试触发桩：向 NSNotificationCenter 手动 post NSWindowDidMoveNotification，
/// 使得 install_focus_restorer 装的 observer 能在测试里可靠触发。
#[cfg(target_os = "macos")]
pub fn post_did_move_notification_for_testing(window: &WebviewWindow) {
    macos::post_did_move_notification_for_testing_impl(window);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn centered_origin_on_primary_monitor() {
        assert_eq!(
            compute_centered_origin((0, 0), (1920, 1080), (460, 440)),
            (730, 320),
        );
    }

    #[test]
    fn centered_origin_on_secondary_monitor() {
        assert_eq!(
            compute_centered_origin((1920, 0), (2560, 1440), (460, 440)),
            (2970, 500),
        );
    }

    #[test]
    fn centered_origin_negative_monitor() {
        assert_eq!(
            compute_centered_origin((-1280, -800), (1280, 800), (460, 440)),
            (-870, -620),
        );
    }

    #[test]
    fn centered_origin_window_bigger_than_monitor() {
        assert_eq!(
            compute_centered_origin((0, 0), (400, 300), (460, 440)),
            (-30, -70),
        );
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn main_thread_marker_returns_none_off_thread() {
        use objc2_foundation::MainThreadMarker;
        let from_test_thread = MainThreadMarker::new();
        assert!(
            from_test_thread.is_none(),
            "cargo test thread should not register as AppKit main thread"
        );

        let handle = std::thread::spawn(|| MainThreadMarker::new().is_none());
        assert!(
            handle.join().expect("thread joined"),
            "spawned thread must not see itself as main thread"
        );
    }
}
```

- [ ] **Step 3: Remove passthrough-only macOS code**

In `app/src-tauri/src/window_helpers/macos.rs`:

Delete the top passthrough comment and replace it with:

```rust
//! macOS window helpers for first-mouse and settings focus restoration.
```

Remove these imports:

```rust
use super::HitRegionStore;
use objc2::{rc::Retained, runtime::AnyObject, DefinedClass, MainThreadOnly};
use objc2_foundation::{MainThreadMarker, NSPoint, NSRect};
use std::ptr::null_mut;
use std::sync::Arc;
```

Use this import set:

```rust
use objc2::{define_class, msg_send, rc::Retained, runtime::AnyObject, MainThreadOnly};
use objc2_app_kit::{NSAutoresizingMaskOptions, NSView, NSWindow};
use objc2_foundation::MainThreadMarker;
use tauri::{Manager, WebviewWindow};
```

Delete these definitions entirely:

```rust
struct PassthroughIvars {
    store: *const HitRegionStore,
}

unsafe impl Send for PassthroughIvars {}
unsafe impl Sync for PassthroughIvars {}
```

Also delete the entire `define_class!` block whose class name is:

```rust
#[name = "CPAPassthroughView"]
```

Delete the entire functions with these signatures:

```rust
pub fn install_impl(window: &WebviewWindow, store: Arc<HitRegionStore>)
pub fn uninstall_impl(_window: &WebviewWindow)
```

Keep the functions whose signatures begin with `install_first_mouse_only_impl`, `post_did_move_notification_for_testing_impl`, and `install_focus_restorer_impl`. In those kept functions, change log prefixes from `passthrough/macos` to `window_helpers/macos`.

- [ ] **Step 4: Replace Windows helper file**

Replace `app/src-tauri/src/window_helpers/windows.rs` with:

```rust
//! Windows window helpers for first-mouse and settings focus restoration.

use tauri::{Manager, WebviewWindow};
use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
use windows::Win32::UI::Controls::{DefSubclassProc, SetWindowSubclass};
use windows::Win32::UI::WindowsAndMessaging::{MA_ACTIVATE, WM_MOUSEACTIVATE};

const FIRST_MOUSE_SUBCLASS_ID: usize = 0xCA0_FA11;

unsafe extern "system" fn first_mouse_subclass_proc(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
    _id_subclass: usize,
    _ref_data: usize,
) -> LRESULT {
    if msg == WM_MOUSEACTIVATE {
        return LRESULT(MA_ACTIVATE as isize);
    }
    unsafe { DefSubclassProc(hwnd, msg, wparam, lparam) }
}

/// 给一个 webview 窗口装上仅处理 WM_MOUSEACTIVATE 的 subclass。用于设置窗口等
/// 不需要 hit-test 穿透的子窗。
pub fn install_first_mouse_only_impl(window: &WebviewWindow) {
    let hwnd = match window.hwnd() {
        Ok(h) => HWND(h.0 as *mut _),
        Err(_) => {
            eprintln!("[window_helpers/windows] hwnd() returned Err on first-mouse-only install; skipping");
            return;
        }
    };
    let ok = unsafe {
        SetWindowSubclass(hwnd, Some(first_mouse_subclass_proc), FIRST_MOUSE_SUBCLASS_ID, 0)
    }
    .as_bool();
    if !ok {
        eprintln!("[window_helpers/windows] SetWindowSubclass failed on first-mouse-only install");
    }
}

/// 监听主窗口的 Tauri WindowEvent::Moved 和 WindowEvent::Resized。
/// 回调里若 settings 可见 → set_focus 把 key 还回去。
pub fn install_focus_restorer_impl(main_window: &WebviewWindow, app: tauri::AppHandle) {
    main_window.on_window_event(move |event| {
        let triggered = matches!(event, tauri::WindowEvent::Moved(_))
            || matches!(event, tauri::WindowEvent::Resized(_));
        if !triggered {
            return;
        }
        if let Some(settings) = app.get_webview_window("settings") {
            if settings.is_visible().unwrap_or(false) {
                match settings.set_focus() {
                    Ok(()) => eprintln!("[focus_restorer] focus restored to settings"),
                    Err(e) => eprintln!("[focus_restorer] set_focus failed: {e}"),
                }
            }
        }
    });
}
```

- [ ] **Step 5: Replace stub helper file**

Replace `app/src-tauri/src/window_helpers/stub.rs` with:

```rust
use tauri::WebviewWindow;

pub fn install_first_mouse_only_impl(_w: &WebviewWindow) {}
pub fn install_focus_restorer_impl(_w: &WebviewWindow, _app: tauri::AppHandle) {}
```

- [ ] **Step 6: Update lib.rs module and command wiring**

In `app/src-tauri/src/lib.rs`, change:

```rust
mod passthrough;
```

to:

```rust
mod window_helpers;
```

Delete the whole command:

```rust
#[tauri::command]
fn set_click_through(window: WebviewWindow, ignore: bool) -> Result<(), String> {
    window.set_ignore_cursor_events(ignore).map_err(|e| e.to_string())
}
```

Change every preserved helper reference:

```rust
passthrough::compute_centered_origin
passthrough::install_first_mouse_only
passthrough::install_focus_restorer
passthrough::post_did_move_notification_for_testing
```

to:

```rust
window_helpers::compute_centered_origin
window_helpers::install_first_mouse_only
window_helpers::install_focus_restorer
window_helpers::post_did_move_notification_for_testing
```

Delete these setup-level values:

```rust
    let hit_store = std::sync::Arc::new(passthrough::HitRegionStore::new());
    let hit_store_for_setup = hit_store.clone();
    let hit_store_for_manage = hit_store.clone();
```

Delete this builder manage call:

```rust
        .manage::<std::sync::Arc<passthrough::HitRegionStore>>(hit_store_for_manage)
```

Delete this setup block:

```rust
            if let Some(window) = app.get_webview_window("main") {
                passthrough::install(&window, hit_store_for_setup.clone());
            }
```

In `tauri::generate_handler![...]`, delete:

```rust
            set_click_through,
            passthrough::register_hit_region,
            passthrough::unregister_hit_region,
            passthrough::clear_hit_regions,
```

In the exit handler, delete:

```rust
            if let Some(window) = handle.get_webview_window("main") {
                passthrough::uninstall(&window);
            }
```

- [ ] **Step 7: Update comments in Rust integration tests**

In `app/src-tauri/tests/settings_crash_regression.rs`, change comment references from:

```rust
//! Post-fix: passthrough::install_first_mouse_only_impl uses
```

to:

```rust
//! Post-fix: window_helpers::install_first_mouse_only_impl uses
```

In `app/src-tauri/tests/focus_restore_regression.rs`, only update comments that explicitly name the old module. Keep test names and marker strings unchanged.

- [ ] **Step 8: Verify no native passthrough command references remain**

Run:

```bash
rg -n "HitRegionStore|register_hit_region|unregister_hit_region|clear_hit_regions|set_click_through|HTTRANSPARENT|WM_NCHITTEST|CPAPassthroughView|passthrough::" app/src-tauri app/src
```

Expected: no output, except historical docs under `docs/` are outside this command.

- [ ] **Step 9: Run focused tests**

Run:

```bash
cd app && npx vitest run src/windowLayoutConfig.test.ts
cd app/src-tauri && cargo test --lib window_helpers
```

Expected: both PASS.

- [ ] **Step 10: Commit**

```bash
git add app/src-tauri/src/lib.rs app/src-tauri/src/window_helpers app/src-tauri/tests/settings_crash_regression.rs app/src-tauri/tests/focus_restore_regression.rs app/src/windowLayoutConfig.test.ts
git add -u app/src-tauri/src/passthrough
git commit -m "refactor: remove native main window passthrough"
```

---

### Task 5: Full Verification

**Files:**
- No code changes expected.

- [ ] **Step 1: Run frontend test suite**

Run:

```bash
cd app && npm test
```

Expected: all Vitest files PASS.

- [ ] **Step 2: Run frontend build**

Run:

```bash
cd app && npm run build
```

Expected: `tsc && vite build` completes successfully.

- [ ] **Step 3: Run Rust tests**

Run:

```bash
cd app/src-tauri && cargo test
```

Expected: Rust unit and integration tests PASS on the current platform.

- [ ] **Step 4: Run Rust check**

Run:

```bash
cd app/src-tauri && cargo check
```

Expected: check completes successfully.

- [ ] **Step 5: Manual runtime verification**

Run:

```bash
./start.sh
```

Verify:

1. The main Pomodoro window no longer appears as an `1100 x 680` transparent hit area.
2. The visible Pomodoro panel has only its small host bounds.
3. Clicking outside the Pomodoro window interacts with the app underneath.
4. The Pomodoro header still drags the window.
5. HApJ0 still toggles pin state.
6. The settings button still opens the settings window.
7. The settings window is interactive when it overlaps the Pomodoro window.

- [ ] **Step 6: Final status check**

Run:

```bash
git status --short
```

Expected: only intentional changes are present. The existing untracked `.codex/` directory may remain; do not add it.
