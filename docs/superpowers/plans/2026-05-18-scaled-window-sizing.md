# Scaled Window Sizing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every global-scale UI window resize with `settings.uiScale` while preserving each window's current interaction and positioning behavior.

**Architecture:** Add a shared Rust scaled-window sizing module with pure geometry helpers and one Tauri command. Add a small frontend hook that reads the existing settings store and invokes the shared command from `App`, `SettingsApp`, and `InputCounterPanel`.

**Tech Stack:** Tauri 2, Rust, React 19, TypeScript, Zustand, Vitest, jsdom, native CSS.

---

## File Structure

- Create: `app/src-tauri/src/scaled_window.rs`
  - Owns pure scaled-size geometry helpers, unit tests, and the native resize command implementation.
- Modify: `app/src-tauri/src/lib.rs`
  - Registers the new module and exposes `resize_scaled_window` in the Tauri invoke handler.
- Create: `app/src/domain/scaledWindow.ts`
  - Owns `useScaledWindowSize`, base window size constants, and the frontend command payload shape.
- Create: `app/src/domain/scaledWindow.test.tsx`
  - Verifies the shared hook invokes the native command when scale or base size changes.
- Create: `app/src/App.test.tsx`
  - Verifies the main window host requests scaled native sizing.
- Create: `app/src/SettingsApp.test.tsx`
  - Verifies the Settings window host requests centered scaled native sizing.
- Modify: `app/src/App.tsx`
  - Uses `useScaledWindowSize` for the `main` window.
- Modify: `app/src/SettingsApp.tsx`
  - Uses `useScaledWindowSize` for the `settings` window with recentering enabled.
- Modify: `app/src/InputCounterApp.tsx`
  - Applies `--app-ui-scale` to the input-counter root.
- Modify: `app/src/ui/InputCounterPanel.tsx`
  - Replaces the old input-counter-only resize command with `useScaledWindowSize`.
- Modify: `app/src/styles/global.css`
  - Lets the input-counter content consume `--app-ui-scale`.
- Modify: `app/src/ui/InputCounterPanel.test.tsx`
  - Updates resize expectations to the shared command.

---

### Task 1: Rust Scaled-Window Geometry

**Files:**
- Create: `app/src-tauri/src/scaled_window.rs`

- [ ] **Step 1: Write pure geometry helpers and tests**

Create `app/src-tauri/src/scaled_window.rs` with this initial content:

```rust
use serde::Deserialize;

pub const WINDOW_EDGE_MARGIN: f64 = 24.0;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct LogicalRect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct LogicalSizePair {
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResizeScaledWindowArgs {
    pub label: String,
    pub base_width: f64,
    pub base_height: f64,
    pub scale: f64,
    pub min_width: f64,
    pub min_height: f64,
    pub center: bool,
}

pub fn scaled_size(base_width: f64, base_height: f64, scale: f64) -> Result<LogicalSizePair, String> {
    if !base_width.is_finite() || !base_height.is_finite() || !scale.is_finite() {
        return Err("scaled window dimensions must be finite".to_string());
    }
    if base_width <= 0.0 || base_height <= 0.0 || scale <= 0.0 {
        return Err("scaled window dimensions must be positive".to_string());
    }
    Ok(LogicalSizePair {
        width: base_width * scale,
        height: base_height * scale,
    })
}

pub fn clamp_size_to_monitor(
    size: LogicalSizePair,
    min_width: f64,
    min_height: f64,
    monitor_width: f64,
    monitor_height: f64,
    margin: f64,
) -> LogicalSizePair {
    let available_width = (monitor_width - margin * 2.0).max(min_width);
    let available_height = (monitor_height - margin * 2.0).max(min_height);
    LogicalSizePair {
        width: size.width.max(min_width).min(available_width),
        height: size.height.max(min_height).min(available_height),
    }
}

pub fn centered_origin(monitor: LogicalRect, size: LogicalSizePair) -> (f64, f64) {
    (
        monitor.x + (monitor.width - size.width) / 2.0,
        monitor.y + (monitor.height - size.height) / 2.0,
    )
}

pub fn clamp_origin_to_monitor(origin: (f64, f64), monitor: LogicalRect, size: LogicalSizePair, margin: f64) -> (f64, f64) {
    let min_x = monitor.x + margin;
    let min_y = monitor.y + margin;
    let max_x = monitor.x + monitor.width - margin - size.width;
    let max_y = monitor.y + monitor.height - margin - size.height;
    (
        origin.0.clamp(min_x.min(max_x), min_x.max(max_x)),
        origin.1.clamp(min_y.min(max_y), min_y.max(max_y)),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scaled_size_multiplies_base_dimensions() {
        assert_eq!(
            scaled_size(249.0, 171.0, 1.5).unwrap(),
            LogicalSizePair { width: 373.5, height: 256.5 }
        );
    }

    #[test]
    fn scaled_size_rejects_invalid_dimensions() {
        assert!(scaled_size(0.0, 171.0, 1.0).is_err());
        assert!(scaled_size(249.0, f64::NAN, 1.0).is_err());
        assert!(scaled_size(249.0, 171.0, -1.0).is_err());
    }

    #[test]
    fn clamp_size_respects_monitor_margin_and_minimum_size() {
        let clamped = clamp_size_to_monitor(
            LogicalSizePair { width: 1000.0, height: 900.0 },
            360.0,
            320.0,
            800.0,
            700.0,
            WINDOW_EDGE_MARGIN,
        );
        assert_eq!(clamped, LogicalSizePair { width: 752.0, height: 652.0 });

        let minned = clamp_size_to_monitor(
            LogicalSizePair { width: 100.0, height: 100.0 },
            360.0,
            320.0,
            800.0,
            700.0,
            WINDOW_EDGE_MARGIN,
        );
        assert_eq!(minned, LogicalSizePair { width: 360.0, height: 320.0 });
    }

    #[test]
    fn centered_origin_places_window_in_monitor_center() {
        let origin = centered_origin(
            LogicalRect { x: 100.0, y: 50.0, width: 1000.0, height: 800.0 },
            LogicalSizePair { width: 400.0, height: 300.0 },
        );
        assert_eq!(origin, (400.0, 300.0));
    }

    #[test]
    fn clamp_origin_keeps_preserved_windows_visible() {
        let origin = clamp_origin_to_monitor(
            (900.0, 720.0),
            LogicalRect { x: 0.0, y: 0.0, width: 1000.0, height: 800.0 },
            LogicalSizePair { width: 300.0, height: 200.0 },
            WINDOW_EDGE_MARGIN,
        );
        assert_eq!(origin, (676.0, 576.0));
    }
}
```

- [ ] **Step 2: Run tests to verify GREEN for pure helpers**

Run:

```bash
cd app/src-tauri && PATH="/Users/xpy/.rustup/toolchains/stable-aarch64-apple-darwin/bin:$PATH" cargo test scaled_window
```

Expected: PASS for the five `scaled_window::tests::*` tests.

- [ ] **Step 3: Commit**

```bash
git add app/src-tauri/src/scaled_window.rs
git commit -m "test: add scaled window geometry"
```

---

### Task 2: Rust Tauri Command

**Files:**
- Modify: `app/src-tauri/src/scaled_window.rs`
- Modify: `app/src-tauri/src/lib.rs`

- [ ] **Step 1: Extend the Rust module with native resize implementation**

Append this code above the `#[cfg(test)] mod tests` block in `app/src-tauri/src/scaled_window.rs`:

```rust
use tauri::{LogicalPosition, LogicalSize, Manager};

fn monitor_logical_rect(monitor: &tauri::Monitor) -> LogicalRect {
    let scale = monitor.scale_factor();
    let position = monitor.position();
    let size = monitor.size();
    LogicalRect {
        x: position.x as f64 / scale,
        y: position.y as f64 / scale,
        width: size.width as f64 / scale,
        height: size.height as f64 / scale,
    }
}

fn window_logical_origin(window: &tauri::WebviewWindow) -> Result<(f64, f64), String> {
    let position = window.outer_position().map_err(|e| e.to_string())?;
    let scale = window.scale_factor().map_err(|e| e.to_string())?;
    Ok((position.x as f64 / scale, position.y as f64 / scale))
}

fn monitor_for_window(app: &tauri::AppHandle, window: &tauri::WebviewWindow, center: bool) -> Result<Option<tauri::Monitor>, String> {
    if center {
        if let Some(main) = app.get_webview_window("main") {
            return main.current_monitor().map_err(|e| e.to_string());
        }
    }
    window.current_monitor().map_err(|e| e.to_string())
}

pub fn resize_scaled_window(app: tauri::AppHandle, args: ResizeScaledWindowArgs) -> Result<(), String> {
    let Some(window) = app.get_webview_window(&args.label) else {
        return Ok(());
    };

    let target = scaled_size(args.base_width, args.base_height, args.scale)?;
    let monitor = monitor_for_window(&app, &window, args.center)?;
    let target = if let Some(ref monitor) = monitor {
        let logical = monitor_logical_rect(monitor);
        clamp_size_to_monitor(
            target,
            args.min_width,
            args.min_height,
            logical.width,
            logical.height,
            WINDOW_EDGE_MARGIN,
        )
    } else {
        LogicalSizePair {
            width: target.width.max(args.min_width),
            height: target.height.max(args.min_height),
        }
    };

    window
        .set_size(LogicalSize::new(target.width, target.height))
        .map_err(|e| e.to_string())?;

    let Some(monitor) = monitor else {
        return Ok(());
    };
    let logical_monitor = monitor_logical_rect(&monitor);
    let origin = if args.center {
        centered_origin(logical_monitor, target)
    } else {
        clamp_origin_to_monitor(window_logical_origin(&window)?, logical_monitor, target, WINDOW_EDGE_MARGIN)
    };
    window
        .set_position(LogicalPosition::new(origin.0, origin.1))
        .map_err(|e| e.to_string())?;
    Ok(())
}
```

- [ ] **Step 2: Wire the command in `lib.rs`**

In `app/src-tauri/src/lib.rs`, add the module near the other `mod` declarations:

```rust
mod scaled_window;
```

Add this Tauri command near the other command functions:

```rust
#[tauri::command]
fn resize_scaled_window(
    app: tauri::AppHandle,
    args: scaled_window::ResizeScaledWindowArgs,
) -> Result<(), String> {
    scaled_window::resize_scaled_window(app, args)
}
```

Add `resize_scaled_window` to the `tauri::generate_handler![...]` list:

```rust
            resize_scaled_window,
```

- [ ] **Step 3: Run Rust verification**

Run:

```bash
cd app/src-tauri && PATH="/Users/xpy/.rustup/toolchains/stable-aarch64-apple-darwin/bin:$PATH" cargo test scaled_window
```

Expected: PASS.

Run:

```bash
cd app/src-tauri && PATH="/Users/xpy/.rustup/toolchains/stable-aarch64-apple-darwin/bin:$PATH" cargo check
```

Expected: exits 0 with no compile errors.

- [ ] **Step 4: Commit**

```bash
git add app/src-tauri/src/lib.rs app/src-tauri/src/scaled_window.rs
git commit -m "feat: add scaled window resize command"
```

---

### Task 3: Frontend Shared Hook

**Files:**
- Create: `app/src/domain/scaledWindow.ts`
- Create: `app/src/domain/scaledWindow.test.tsx`

- [ ] **Step 1: Write failing hook tests**

Create `app/src/domain/scaledWindow.test.tsx`:

```tsx
import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSettingsStore } from './settings';
import {
    MAIN_WINDOW_BASE_SIZE,
    SETTINGS_WINDOW_BASE_SIZE,
    useScaledWindowSize,
} from './scaledWindow';

const { invokeMock } = vi.hoisted(() => ({
    invokeMock: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));

function Probe({
    label,
    baseWidth,
    baseHeight,
    minWidth,
    minHeight,
    center = false,
}: {
    label: string;
    baseWidth: number;
    baseHeight: number;
    minWidth: number;
    minHeight: number;
    center?: boolean;
}) {
    useScaledWindowSize({ label, baseWidth, baseHeight, minWidth, minHeight, center });
    return null;
}

beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValue(undefined);
    useSettingsStore.setState({
        uiScale: 1,
        committedUiScale: 1,
        dangerousChange: null,
    });
});

describe('useScaledWindowSize', () => {
    it('invokes the shared native resize command with current scale', async () => {
        useSettingsStore.setState({ uiScale: 1.5 });

        render(
            <Probe
                label="main"
                baseWidth={MAIN_WINDOW_BASE_SIZE.width}
                baseHeight={MAIN_WINDOW_BASE_SIZE.height}
                minWidth={MAIN_WINDOW_BASE_SIZE.width}
                minHeight={MAIN_WINDOW_BASE_SIZE.height}
            />,
        );

        await waitFor(() => {
            expect(invokeMock).toHaveBeenCalledWith('resize_scaled_window', {
                args: {
                    label: 'main',
                    baseWidth: 249,
                    baseHeight: 171,
                    minWidth: 249,
                    minHeight: 171,
                    scale: 1.5,
                    center: false,
                },
            });
        });
    });

    it('reinvokes when scale changes and passes center for settings', async () => {
        const { rerender } = render(
            <Probe
                label="settings"
                baseWidth={SETTINGS_WINDOW_BASE_SIZE.width}
                baseHeight={SETTINGS_WINDOW_BASE_SIZE.height}
                minWidth={360}
                minHeight={320}
                center
            />,
        );

        await waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(1));
        invokeMock.mockClear();
        useSettingsStore.setState({ uiScale: 2 });
        rerender(
            <Probe
                label="settings"
                baseWidth={SETTINGS_WINDOW_BASE_SIZE.width}
                baseHeight={SETTINGS_WINDOW_BASE_SIZE.height}
                minWidth={360}
                minHeight={320}
                center
            />,
        );

        await waitFor(() => {
            expect(invokeMock).toHaveBeenCalledWith('resize_scaled_window', {
                args: {
                    label: 'settings',
                    baseWidth: 460,
                    baseHeight: 440,
                    minWidth: 360,
                    minHeight: 320,
                    scale: 2,
                    center: true,
                },
            });
        });
    });
});
```

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
cd app && npx vitest run src/domain/scaledWindow.test.tsx
```

Expected: FAIL because `app/src/domain/scaledWindow.ts` does not exist.

- [ ] **Step 3: Implement the hook**

Create `app/src/domain/scaledWindow.ts`:

```ts
import { useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useSettingsStore } from './settings';

export const MAIN_WINDOW_BASE_SIZE = { width: 249, height: 171 } as const;
export const SETTINGS_WINDOW_BASE_SIZE = { width: 460, height: 440 } as const;
export const SETTINGS_WINDOW_MIN_SIZE = { width: 360, height: 320 } as const;
export const INPUT_COUNTER_BASE_WIDTH = 128;
export const INPUT_COUNTER_BASE_HEIGHT = 84;

export interface ScaledWindowSizeOptions {
    label: string;
    baseWidth: number;
    baseHeight: number;
    minWidth: number;
    minHeight: number;
    center?: boolean;
    enabled?: boolean;
}

export function useScaledWindowSize({
    label,
    baseWidth,
    baseHeight,
    minWidth,
    minHeight,
    center = false,
    enabled = true,
}: ScaledWindowSizeOptions) {
    const scale = useSettingsStore((s) => s.uiScale);

    useEffect(() => {
        if (!enabled) return;
        void invoke('resize_scaled_window', {
            args: {
                label,
                baseWidth,
                baseHeight,
                minWidth,
                minHeight,
                scale,
                center,
            },
        }).catch((error) => {
            console.error(`[scaled-window] resize ${label} failed`, error);
        });
    }, [baseHeight, baseWidth, center, enabled, label, minHeight, minWidth, scale]);
}
```

- [ ] **Step 4: Run tests to verify GREEN**

Run:

```bash
cd app && npx vitest run src/domain/scaledWindow.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/domain/scaledWindow.ts app/src/domain/scaledWindow.test.tsx
git commit -m "feat: add scaled window hook"
```

---

### Task 4: Wire Main And Settings Windows

**Files:**
- Create: `app/src/App.test.tsx`
- Create: `app/src/SettingsApp.test.tsx`
- Modify: `app/src/App.tsx`
- Modify: `app/src/SettingsApp.tsx`

- [ ] **Step 1: Add frontend regression tests**

Create `app/src/App.test.tsx`:

```tsx
import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSettingsStore } from './domain/settings';

const { invokeMock } = vi.hoisted(() => ({
    invokeMock: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));
vi.mock('./domain/stateSync', () => ({ useStateSync: vi.fn() }));
vi.mock('./domain/activeApp', () => ({ useActiveAppListener: vi.fn() }));
vi.mock('./domain/bindingKey', () => ({ useBindingKeyListener: vi.fn() }));
vi.mock('./domain/bridge/host', () => ({ useBridgeHost: vi.fn() }));
vi.mock('./domain/inputCounterWindow', () => ({ useInputCounterWindowController: vi.fn() }));
vi.mock('./domain/settingsPersistence', () => ({ loadPersistedSettings: vi.fn(() => Promise.resolve(null)) }));
vi.mock('./ui/PomodoroPanel', () => ({ PomodoroPanel: () => <div data-testid="pomodoro-panel" /> }));
vi.mock('./ui/PomodoroEndActionLayer', () => ({ PomodoroEndActionLayer: () => null }));

const { default: App } = await import('./App');

beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValue(undefined);
    useSettingsStore.setState({ uiScale: 1.5, committedUiScale: 1.5, dangerousChange: null });
});

describe('App scaled window sizing', () => {
    it('requests native resize for the main window when global scale is active', async () => {
        render(<App />);

        await waitFor(() => {
            expect(invokeMock).toHaveBeenCalledWith('resize_scaled_window', {
                args: {
                    label: 'main',
                    baseWidth: 249,
                    baseHeight: 171,
                    minWidth: 249,
                    minHeight: 171,
                    scale: 1.5,
                    center: false,
                },
            });
        });
    });
});
```

Create `app/src/SettingsApp.test.tsx`:

```tsx
import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSettingsStore } from './domain/settings';

const { invokeMock } = vi.hoisted(() => ({
    invokeMock: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));
vi.mock('./domain/bridge/client', () => ({ useBridgeClient: vi.fn() }));
vi.mock('./ui/SettingsPanel', () => ({ SettingsPanel: () => <div data-testid="settings-panel" /> }));
vi.mock('./ui/DangerousChangeDialog', () => ({ DangerousChangeDialog: () => null }));

const { default: SettingsApp } = await import('./SettingsApp');

beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValue(undefined);
    useSettingsStore.setState({ uiScale: 1.5, committedUiScale: 1.5, dangerousChange: null });
});

describe('SettingsApp scaled window sizing', () => {
    it('requests centered native resize for the settings window when global scale is active', async () => {
        render(<SettingsApp />);

        await waitFor(() => {
            expect(invokeMock).toHaveBeenCalledWith('resize_scaled_window', {
                args: {
                    label: 'settings',
                    baseWidth: 460,
                    baseHeight: 440,
                    minWidth: 360,
                    minHeight: 320,
                    scale: 1.5,
                    center: true,
                },
            });
        });
    });
});
```

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
cd app && npx vitest run src/App.test.tsx src/SettingsApp.test.tsx
```

Expected: FAIL because `App` and `SettingsApp` do not call `resize_scaled_window`.

- [ ] **Step 3: Wire `App.tsx`**

In `app/src/App.tsx`, add this import:

```ts
import { MAIN_WINDOW_BASE_SIZE, useScaledWindowSize } from './domain/scaledWindow';
```

Inside `App()`, after reading `uiScale`, add:

```ts
    useScaledWindowSize({
        label: 'main',
        baseWidth: MAIN_WINDOW_BASE_SIZE.width,
        baseHeight: MAIN_WINDOW_BASE_SIZE.height,
        minWidth: MAIN_WINDOW_BASE_SIZE.width,
        minHeight: MAIN_WINDOW_BASE_SIZE.height,
    });
```

- [ ] **Step 4: Wire `SettingsApp.tsx`**

In `app/src/SettingsApp.tsx`, add this import:

```ts
import { SETTINGS_WINDOW_BASE_SIZE, SETTINGS_WINDOW_MIN_SIZE, useScaledWindowSize } from './domain/scaledWindow';
```

Inside `SettingsApp()`, after reading `uiScale`, add:

```ts
    useScaledWindowSize({
        label: 'settings',
        baseWidth: SETTINGS_WINDOW_BASE_SIZE.width,
        baseHeight: SETTINGS_WINDOW_BASE_SIZE.height,
        minWidth: SETTINGS_WINDOW_MIN_SIZE.width,
        minHeight: SETTINGS_WINDOW_MIN_SIZE.height,
        center: true,
    });
```

- [ ] **Step 5: Run tests to verify GREEN**

Run:

```bash
cd app && npx vitest run src/domain/scaledWindow.test.tsx src/App.test.tsx src/SettingsApp.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/src/App.tsx app/src/SettingsApp.tsx app/src/App.test.tsx app/src/SettingsApp.test.tsx
git commit -m "feat: scale main and settings windows"
```

---

### Task 5: Wire Input Counter Window

**Files:**
- Modify: `app/src/InputCounterApp.tsx`
- Modify: `app/src/styles/global.css`
- Modify: `app/src/ui/InputCounterPanel.tsx`
- Modify: `app/src/ui/InputCounterPanel.test.tsx`

- [ ] **Step 1: Update failing input-counter tests**

In `app/src/ui/InputCounterPanel.test.tsx`, replace the old no-resize expectation:

```tsx
expect(invokeMock).not.toHaveBeenCalledWith('resize_input_counter_window', expect.anything());
```

with:

```tsx
expect(invokeMock).not.toHaveBeenCalledWith('resize_scaled_window', expect.anything());
```

Append this test inside `describe('InputCounterPanel', ...)`:

```tsx
    it('requests scaled native size from visible key count and global scale', async () => {
        useSettingsStore.setState({ uiScale: 1.5 });
        useBindingKeyStore.setState({
            entries: [
                { id: 'space', label: 'Space', keyCode: 49, pressCount: 47, enabled: true },
                { id: 'enter', label: 'Enter', keyCode: 36, pressCount: 3, enabled: true },
            ],
        });

        render(<InputCounterPanel />);

        await waitFor(() => {
            expect(invokeMock).toHaveBeenCalledWith('resize_scaled_window', {
                args: {
                    label: 'input-counter',
                    baseWidth: 128,
                    baseHeight: 111,
                    minWidth: 128,
                    minHeight: 84,
                    scale: 1.5,
                    center: false,
                },
            });
        });
    });
```

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
cd app && npx vitest run src/ui/InputCounterPanel.test.tsx
```

Expected: FAIL because the component still invokes `resize_input_counter_window`.

- [ ] **Step 3: Scale the input-counter root**

Replace `app/src/InputCounterApp.tsx` with:

```tsx
import type { CSSProperties } from 'react';
import { useBridgeClient } from './domain/bridge/client';
import { useSettingsStore } from './domain/settings';
import { InputCounterPanel } from './ui/InputCounterPanel';

export default function InputCounterApp() {
    useBridgeClient();
    const uiScale = useSettingsStore((s) => s.uiScale);

    return (
        <div className="input-counter-window-root" style={{ '--app-ui-scale': String(uiScale) } as CSSProperties}>
            <InputCounterPanel />
        </div>
    );
}
```

In `app/src/styles/global.css`, add the zoom rule to `.input-counter-window-root`:

```css
.input-counter-window-root {
    position: relative;
    width: fit-content;
    height: fit-content;
    padding: 0;
    overflow: hidden;
    background: transparent;
    zoom: var(--app-ui-scale);
}
```

- [ ] **Step 4: Replace the old input-counter resize call**

Add this import:

```ts
import {
    INPUT_COUNTER_BASE_HEIGHT,
    INPUT_COUNTER_BASE_WIDTH,
    useScaledWindowSize,
} from '../domain/scaledWindow';
```

Replace the existing resize effect:

```ts
    useEffect(() => {
        if (!panelEnabled || boundEntries.length === 0) return;
        void invoke('resize_input_counter_window', { height: windowHeightForPills(boundEntries.length) })
            .catch(() => { /* non-Tauri/test env */ });
    }, [boundEntries.length, panelEnabled]);
```

with:

```ts
    const baseHeight = windowHeightForPills(boundEntries.length);
    useScaledWindowSize({
        label: 'input-counter',
        baseWidth: INPUT_COUNTER_BASE_WIDTH,
        baseHeight,
        minWidth: INPUT_COUNTER_BASE_WIDTH,
        minHeight: INPUT_COUNTER_BASE_HEIGHT,
        enabled: panelEnabled && boundEntries.length > 0,
    });
```

Keep the existing `invoke('set_input_counter_window_pinned', ...)` import because the file still needs it for pinning:

```ts
import { invoke } from '@tauri-apps/api/core';
```

Remove `useEffect` from the React import:

```ts
import { useMemo, useState } from 'react';
```

- [ ] **Step 5: Run tests to verify GREEN**

Run:

```bash
cd app && npx vitest run src/ui/InputCounterPanel.test.tsx src/domain/scaledWindow.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/src/InputCounterApp.tsx app/src/styles/global.css app/src/ui/InputCounterPanel.tsx app/src/ui/InputCounterPanel.test.tsx
git commit -m "feat: scale input counter window"
```

---

### Task 6: Final Verification

**Files:**
- Verify only: no planned production edits unless verification exposes a compile issue in the files changed above.

- [ ] **Step 1: Run focused frontend tests**

Run:

```bash
cd app && npx vitest run src/domain/scaledWindow.test.tsx src/App.test.tsx src/SettingsApp.test.tsx src/ui/InputCounterPanel.test.tsx
```

Expected: all selected tests pass.

- [ ] **Step 2: Run full frontend test suite**

Run:

```bash
cd app && npm test
```

Expected: Vitest exits 0.

- [ ] **Step 3: Run frontend build**

Run:

```bash
cd app && npm run build
```

Expected: TypeScript and Vite build exit 0.

- [ ] **Step 4: Run Rust checks**

Run:

```bash
cd app/src-tauri && PATH="/Users/xpy/.rustup/toolchains/stable-aarch64-apple-darwin/bin:$PATH" cargo test scaled_window && PATH="/Users/xpy/.rustup/toolchains/stable-aarch64-apple-darwin/bin:$PATH" cargo check
```

Expected: Rust unit tests and `cargo check` exit 0.

- [ ] **Step 5: Runtime smoke verification**

Run:

```bash
./start.sh
```

Expected: the Tauri app launches. Open Settings, set Global scale to `1.5x` and then `2.0x`, and confirm the main, Settings, and input-counter windows resize with the preview. Cancel or let the dangerous preview time out and confirm all active windows return to the previous size.
