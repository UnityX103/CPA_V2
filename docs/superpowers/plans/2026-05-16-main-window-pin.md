# Main Window Pin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Pencil node `HApJ0` the only control that pins the main Pomodoro window, while leaving the settings window non-pinned and coverable by other apps.

**Architecture:** Rust owns the native pin operation through a narrow `set_main_window_pinned(on_top)` command that only targets the `main` window. Frontend `PomodoroPanel` keeps `isPinned` as the UI state source and syncs that state to the command. Default always-on-top sources are removed, and the macOS accessibility prompt flow restores the previous main-window pin state instead of assuming it should restore to pinned.

**Tech Stack:** Tauri 2, Rust, React 19, TypeScript, Zustand, Vitest, Testing Library, native CSS.

---

## File Structure

- Modify `app/src-tauri/tauri.conf.json`
  Remove the main window's default `alwaysOnTop: true`.

- Modify `app/src-tauri/src/lib.rs`
  Add `set_main_window_pinned(app, on_top)`, register it in `invoke_handler`, remove the broad `set_always_on_top(window, on_top)` command if no callers remain, remove the setup-time forced main-window pin, and make the hidden settings window non-pinned.

- Modify `app/src-tauri/src/accessibility/mod.rs`
  Snapshot `main.is_always_on_top()` before yielding to the macOS accessibility prompt, then restore exactly that value after the prompt finishes or times out.

- Modify `app/src/ui/PomodoroPanel.tsx`
  Add a `useEffect` that syncs `state.isPinned` to `invoke('set_main_window_pinned', { onTop })`.

- Create `app/src/ui/PomodoroPanel.test.tsx`
  Covers the HApJ0 pin button invoking the main-window command on mount and on user toggles.

- Create `app/src/windowPinConfig.test.ts`
  Source/config guard tests for default pin removal, narrow command registration, and accessibility state restoration.

---

### Task 1: Add PomodoroPanel Pin Behaviour Test

**Files:**
- Create: `app/src/ui/PomodoroPanel.test.tsx`
- Modify: none
- Test: `app/src/ui/PomodoroPanel.test.tsx`

- [ ] **Step 1: Write the failing test file**

Create `app/src/ui/PomodoroPanel.test.tsx` with this exact content:

```tsx
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react';

const { invokeMock, startDragging } = vi.hoisted(() => ({
    invokeMock: vi.fn(),
    startDragging: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));

vi.mock('@tauri-apps/api/window', () => ({
    getCurrentWindow: () => ({
        startDragging: () => {
            startDragging();
            return Promise.resolve();
        },
    }),
}));

class FakeResizeObserver {
    constructor(_cb: ResizeObserverCallback) {}
    observe() {}
    unobserve() {}
    disconnect() {}
}
vi.stubGlobal('ResizeObserver', FakeResizeObserver);

class FakeMutationObserver {
    constructor(_cb: MutationCallback) {}
    observe() {}
    disconnect() {}
    takeRecords() { return []; }
}
vi.stubGlobal('MutationObserver', FakeMutationObserver);

const { PomodoroPanel } = await import('./PomodoroPanel');
const { usePomodoroStore } = await import('../domain/pomodoro');

function resetPomodoro() {
    usePomodoroStore.setState({
        focusDurationSeconds: 25 * 60,
        breakDurationSeconds: 5 * 60,
        totalRounds: 4,
        currentRound: 1,
        remainingSeconds: 25 * 60,
        currentPhase: 'focus',
        isRunning: false,
        isPinned: false,
        autoStartBreak: true,
        consecutiveCompletedFocus: 0,
    });
}

function pinCalls() {
    return invokeMock.mock.calls.filter(([cmd]) => cmd === 'set_main_window_pinned');
}

describe('PomodoroPanel HApJ0 pin behaviour', () => {
    beforeEach(() => {
        cleanup();
        invokeMock.mockReset();
        invokeMock.mockResolvedValue(undefined);
        startDragging.mockReset();
        resetPomodoro();
        vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
            const s = this.style;
            return {
                x: parseFloat(s.left) || 0,
                y: parseFloat(s.top) || 0,
                left: parseFloat(s.left) || 0,
                top: parseFloat(s.top) || 0,
                width: parseFloat(s.width) || 0,
                height: parseFloat(s.height) || 0,
                right: (parseFloat(s.left) || 0) + (parseFloat(s.width) || 0),
                bottom: (parseFloat(s.top) || 0) + (parseFloat(s.height) || 0),
                toJSON: () => ({}),
            } as DOMRect;
        });
    });

    afterEach(() => {
        cleanup();
        vi.restoreAllMocks();
    });

    it('syncs initial unpinned state and HApJ0 toggles to the main-window pin command', async () => {
        render(<PomodoroPanel />);

        await waitFor(() => {
            expect(pinCalls()).toContainEqual(['set_main_window_pinned', { onTop: false }]);
        });

        invokeMock.mockClear();
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: '置顶' }));
        });
        await waitFor(() => {
            expect(pinCalls()).toEqual([['set_main_window_pinned', { onTop: true }]]);
        });

        invokeMock.mockClear();
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: '置顶' }));
        });
        await waitFor(() => {
            expect(pinCalls()).toEqual([['set_main_window_pinned', { onTop: false }]]);
        });
    });

    it('settings button still opens the settings window through its existing command', async () => {
        render(<PomodoroPanel />);

        invokeMock.mockClear();
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: '设置' }));
        });

        expect(invokeMock).toHaveBeenCalledWith('open_settings_window');
    });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
cd app && npx vitest run src/ui/PomodoroPanel.test.tsx
```

Expected: FAIL. The first test should fail because `PomodoroPanel` does not yet call `set_main_window_pinned`.

- [ ] **Step 3: Commit the failing test**

```bash
git add app/src/ui/PomodoroPanel.test.tsx
git commit -m "test: cover pomodoro pin command"
```

---

### Task 2: Add Window Pin Config Guard Tests

**Files:**
- Create: `app/src/windowPinConfig.test.ts`
- Modify: none
- Test: `app/src/windowPinConfig.test.ts`

- [ ] **Step 1: Write the failing guard test file**

Create `app/src/windowPinConfig.test.ts` with this exact content:

```ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const tauriConfPath = path.join(here, '../src-tauri/tauri.conf.json');
const libRsPath = path.join(here, '../src-tauri/src/lib.rs');
const accessibilityRsPath = path.join(here, '../src-tauri/src/accessibility/mod.rs');

function libRs(): string {
    return readFileSync(libRsPath, 'utf8');
}

function accessibilityRs(): string {
    return readFileSync(accessibilityRsPath, 'utf8');
}

describe('main window pin configuration', () => {
    it('does not default the main Tauri window to always-on-top', () => {
        const conf = JSON.parse(readFileSync(tauriConfPath, 'utf8'));
        const main = conf.app.windows.find((w: { label?: string }) => w.label === 'main');
        expect(main, 'main window config should exist').toBeTruthy();
        expect(main.alwaysOnTop).not.toBe(true);
    });

    it('registers a narrow command that can only pin the main window', () => {
        const source = libRs();
        expect(source).toMatch(/fn set_main_window_pinned\(\s*app:\s*tauri::AppHandle,\s*on_top:\s*bool\s*\)\s*->\s*Result<\(\),\s*String>/);
        expect(source).toMatch(/get_webview_window\("main"\)[\s\S]*set_always_on_top\(on_top\)/);
        expect(source).toMatch(/tauri::generate_handler!\[[\s\S]*set_main_window_pinned/);
        expect(source).not.toMatch(/fn set_always_on_top\(\s*window:\s*WebviewWindow,\s*on_top:\s*bool\s*\)/);
    });

    it('does not force main or settings windows to pinned during startup', () => {
        const source = libRs();
        expect(source).not.toMatch(/get_webview_window\("main"\)\s*\{\s*let _ = window\.set_always_on_top\(true\);/);
        expect(source).not.toMatch(/WebviewWindowBuilder::new\(app,\s*"settings"[\s\S]*?\.always_on_top\(true\)/);
    });

    it('restores the accessibility prompt yield to the previous pin state, not always true', () => {
        const source = accessibilityRs();
        expect(source).toMatch(/let was_main_on_top = main\.is_always_on_top\(\)\.unwrap_or\(false\);/);
        expect(source).toMatch(/main\.set_always_on_top\(was_main_on_top\)/);
        expect(source).not.toMatch(/set_always_on_top\(true\)/);
    });
});
```

- [ ] **Step 2: Run the guard test and verify it fails**

Run:

```bash
cd app && npx vitest run src/windowPinConfig.test.ts
```

Expected: FAIL. Current code still has `alwaysOnTop: true`, broad `set_always_on_top`, settings `.always_on_top(true)`, and accessibility restore-to-true.

- [ ] **Step 3: Commit the failing guard test**

```bash
git add app/src/windowPinConfig.test.ts
git commit -m "test: guard main window pin configuration"
```

---

### Task 3: Implement Rust And Tauri Config Pin Boundaries

**Files:**
- Modify: `app/src-tauri/tauri.conf.json`
- Modify: `app/src-tauri/src/lib.rs`
- Modify: `app/src-tauri/src/accessibility/mod.rs`
- Test: `app/src/windowPinConfig.test.ts`

- [ ] **Step 1: Update `tauri.conf.json`**

In `app/src-tauri/tauri.conf.json`, remove this line from the `main` window object:

```json
"alwaysOnTop": true,
```

Do not add a replacement `alwaysOnTop: false`; absence uses Tauri's default false and keeps the config smaller.

- [ ] **Step 2: Replace the broad always-on-top command in `lib.rs`**

In `app/src-tauri/src/lib.rs`, replace this function:

```rust
#[tauri::command]
fn set_always_on_top(window: WebviewWindow, on_top: bool) -> Result<(), String> {
    window.set_always_on_top(on_top).map_err(|e| e.to_string())
}
```

with:

```rust
#[tauri::command]
fn set_main_window_pinned(app: tauri::AppHandle, on_top: bool) -> Result<(), String> {
    let main = app
        .get_webview_window("main")
        .ok_or_else(|| "main window not found".to_string())?;
    main.set_always_on_top(on_top).map_err(|e| e.to_string())
}
```

Keep `WebviewWindow` in the import list because `set_click_through(window: WebviewWindow, ...)` still uses it.

- [ ] **Step 3: Remove settings-window default pin**

In `build_settings_window_hidden`, remove this builder call:

```rust
.always_on_top(true)
```

The surrounding builder should still include:

```rust
.transparent(true)
.decorations(false)
.shadow(false)
.skip_taskbar(true)
.visible(false)
```

- [ ] **Step 4: Remove setup-time main-window pin**

In `lib.rs::setup`, delete this whole block:

```rust
if let Some(window) = app.get_webview_window("main") {
    let _ = window.set_always_on_top(true);
}
```

Leave the following passthrough install block intact:

```rust
if let Some(window) = app.get_webview_window("main") {
    passthrough::install(&window, hit_store_for_setup.clone());
}
```

- [ ] **Step 5: Register the new command**

In the `tauri::generate_handler!` list, replace:

```rust
set_always_on_top,
```

with:

```rust
set_main_window_pinned,
```

- [ ] **Step 6: Preserve the previous pin state during the macOS accessibility prompt**

In `app/src-tauri/src/accessibility/mod.rs`, inside the `#[cfg(target_os = "macos")]` block of `request_accessibility_permission`, insert this snapshot before `app_for_yield`:

```rust
let was_main_on_top = app
    .get_webview_window("main")
    .and_then(|main| main.is_always_on_top().ok())
    .unwrap_or(false);
```

Then replace the restore task's hard-coded true block:

```rust
if let Some(main) = restore_app.get_webview_window("main") {
    if let Err(e) = main.set_always_on_top(true) {
        eprintln!("[accessibility] set_always_on_top(true) 恢复失败：{e}");
    }
}
```

with:

```rust
if let Some(main) = restore_app.get_webview_window("main") {
    if let Err(e) = main.set_always_on_top(was_main_on_top) {
        eprintln!(
            "[accessibility] set_always_on_top({was_main_on_top}) 恢复失败：{e}"
        );
    }
}
```

Do not change the yield step that temporarily calls `main.set_always_on_top(false)` before showing the prompt.

- [ ] **Step 7: Run the guard test**

Run:

```bash
cd app && npx vitest run src/windowPinConfig.test.ts
```

Expected: PASS.

- [ ] **Step 8: Run Rust check**

Run:

```bash
cd app/src-tauri && cargo check
```

If `cargo` is not on PATH, run:

```bash
cd app/src-tauri && PATH="$HOME/.rustup/toolchains/stable-aarch64-apple-darwin/bin:$PATH" cargo check
```

Expected: PASS.

- [ ] **Step 9: Commit Rust/config changes**

```bash
git add app/src-tauri/tauri.conf.json app/src-tauri/src/lib.rs app/src-tauri/src/accessibility/mod.rs
git commit -m "fix: restrict pinning to main window command"
```

---

### Task 4: Sync HApJ0 State To The Main Window Command

**Files:**
- Modify: `app/src/ui/PomodoroPanel.tsx`
- Test: `app/src/ui/PomodoroPanel.test.tsx`

- [ ] **Step 1: Add the pin sync effect**

In `app/src/ui/PomodoroPanel.tsx`, inside `PomodoroPanel()` after the existing timer `useEffect`, add:

```tsx
    useEffect(() => {
        void invoke('set_main_window_pinned', { onTop: state.isPinned })
            .catch((error) => {
                console.error('[pin] set_main_window_pinned failed', error);
            });
    }, [state.isPinned]);
```

The top import already includes `useEffect`, and `invoke` is already imported, so no import change is needed.

- [ ] **Step 2: Run the PomodoroPanel test**

Run:

```bash
cd app && npx vitest run src/ui/PomodoroPanel.test.tsx
```

Expected: PASS.

- [ ] **Step 3: Run both new tests together**

Run:

```bash
cd app && npx vitest run src/ui/PomodoroPanel.test.tsx src/windowPinConfig.test.ts
```

Expected: PASS.

- [ ] **Step 4: Commit frontend sync**

```bash
git add app/src/ui/PomodoroPanel.tsx
git commit -m "fix: sync HApJ0 pin state to main window"
```

---

### Task 5: Full Verification

**Files:**
- No new edits expected
- Test: full app test/build/check suite

- [ ] **Step 1: Run all frontend tests**

Run:

```bash
cd app && npm test
```

Expected: PASS.

- [ ] **Step 2: Run frontend production build**

Run:

```bash
cd app && npm run build
```

Expected: PASS.

- [ ] **Step 3: Run Rust check**

Run:

```bash
cd app/src-tauri && cargo check
```

If `cargo` is not on PATH, run:

```bash
cd app/src-tauri && PATH="$HOME/.rustup/toolchains/stable-aarch64-apple-darwin/bin:$PATH" cargo check
```

Expected: PASS.

- [ ] **Step 4: Run available Rust tests**

Run:

```bash
cd app/src-tauri && cargo test
```

If `cargo` is not on PATH, run:

```bash
cd app/src-tauri && PATH="$HOME/.rustup/toolchains/stable-aarch64-apple-darwin/bin:$PATH" cargo test
```

Expected: PASS. If a macOS GUI E2E test cannot run in the current environment, record the exact failing test and stderr in the task report instead of hiding it.

- [ ] **Step 5: Manual desktop verification**

Run:

```bash
cd app && npm run tauri dev
```

Expected checks:

1. Cold start: main Pomodoro window can be covered by another app.
2. Cold start: settings window can be covered by another app.
3. Click `HApJ0` once: main Pomodoro window stays above other apps.
4. Click `HApJ0` again: main Pomodoro window can be covered by another app.
5. Open settings while `HApJ0` is on: settings window itself can still be covered by another app.
6. Open settings while `HApJ0` is off: settings window itself can still be covered by another app.
7. Request accessibility permission while `HApJ0` is off: after prompt flow ends, main window remains not pinned.
8. Request accessibility permission while `HApJ0` is on: after prompt flow ends, main window returns to pinned.

- [ ] **Step 6: Commit final verification note if changes were needed**

If verification required any fixes, commit those fixes:

```bash
git add app/src-tauri/tauri.conf.json app/src-tauri/src/lib.rs app/src-tauri/src/accessibility/mod.rs app/src/ui/PomodoroPanel.tsx app/src/ui/PomodoroPanel.test.tsx app/src/windowPinConfig.test.ts
git commit -m "fix: complete main window pin verification"
```

If no fixes were needed, do not create an empty commit.

---

## Self-Review

- Spec coverage: The plan covers no default pinned windows, HApJ0-only main window pinning, settings window non-pinned behavior, narrow Rust command ownership, accessibility prompt restoration, tests, and manual validation.
- Placeholder scan: No unfinished placeholder markers remain. Every code-edit step includes exact code or exact deletion target.
- Type consistency: The frontend uses `{ onTop }` and the Rust command uses `on_top`, matching Tauri's argument casing. The command name is consistently `set_main_window_pinned`.
