# Overlay Hit-Passthrough Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop CPA_V2's 1100×680 transparent main window from intercepting drag/click events in other macOS/Windows apps; only the actually-visible UI panels should grab input.

**Architecture:** A Rust-side `HitRegionStore` (rect set, keyed by stable IDs) is fed window-local DOM rects from the React layer via two Tauri commands. Native code on each platform consults the store on every OS hit-test query: macOS via an `NSView` subclass overriding `hitTest:` (returns `nil` → passthrough); Windows via `SetWindowSubclass` returning `HTTRANSPARENT` from `WM_NCHITTEST`. No window-level `ignoresMouseEvents` / `WS_EX_TRANSPARENT` toggling, no polling.

**Tech Stack:** Tauri 2, Rust 2021, `objc2` 0.6 + `objc2-app-kit` 0.3 (macOS), `windows` crate 0.58 (Windows), React 19 + TypeScript, Vitest + jsdom.

**Spec:** `docs/superpowers/specs/2026-05-15-overlay-hit-passthrough-design.md`

---

## File Structure

**Create:**
- `app/src-tauri/src/passthrough/mod.rs` — platform-neutral `HitRegionStore`, `Rect` type, Tauri commands, `install()` dispatcher
- `app/src-tauri/src/passthrough/macos.rs` — `CPAPassthroughView` subclass, `install_impl()`
- `app/src-tauri/src/passthrough/windows.rs` — `SetWindowSubclass` WndProc, `install_impl()`
- `app/src-tauri/src/passthrough/stub.rs` — no-op `install_impl()` for other platforms
- `app/src/domain/passthrough.ts` — `useHitRegion(label)` returning a ref callback + `clearHitRegions()` boot helper
- `app/src/domain/passthrough.test.ts` — vitest coverage for the hook

**Modify:**
- `app/src-tauri/Cargo.toml` — add `NSView` feature on `objc2-app-kit`; add Windows target block with `windows` crate
- `app/src-tauri/src/lib.rs` — `mod passthrough`, `manage(HitRegionStore)`, register the 3 new commands, call `passthrough::install(&main_window)` in `setup()`, call `passthrough::uninstall(&main_window)` on `RunEvent::ExitRequested|Exit`
- `app/src/ui/PomodoroPanel.tsx` — attach `useHitRegion('pomodoro-panel')` to the `.pomo-panel` root div
- `app/src/ui/RemoteRoster.tsx` — attach `useHitRegion('remote-roster')` to the `.remote-roster` root div (use ref callback so conditional rendering is safe)
- `app/src/main.tsx` — on app boot, call `clearHitRegions()` once so a webview reload doesn't leave orphan rects

---

## Task 1: Shared Rust `HitRegionStore` (pure logic, platform-free)

**Files:**
- Create: `app/src-tauri/src/passthrough/mod.rs`

- [ ] **Step 1: Create the module file with the failing test scaffold**

Write only the `#[cfg(test)]` block at the bottom of a new file. The types referenced will not yet exist — that's the point.

```rust
// app/src-tauri/src/passthrough/mod.rs
#[cfg(test)]
mod tests {
    use super::*;

    fn r(x: f64, y: f64, w: f64, h: f64) -> Rect {
        Rect { x, y, w, h }
    }

    #[test]
    fn empty_store_misses_everything() {
        let s = HitRegionStore::new();
        assert!(!s.hit_test(0.0, 0.0));
        assert!(!s.hit_test(100.0, 100.0));
    }

    #[test]
    fn single_rect_inside_hits_outside_misses() {
        let s = HitRegionStore::new();
        s.upsert("a".into(), r(10.0, 20.0, 30.0, 40.0));
        assert!(s.hit_test(10.0, 20.0));     // left-top inclusive
        assert!(s.hit_test(25.0, 35.0));     // interior
        assert!(s.hit_test(40.0 - 0.001, 60.0 - 0.001)); // just inside far edge
        assert!(!s.hit_test(40.0, 60.0));    // right-bottom exclusive
        assert!(!s.hit_test(9.999, 35.0));
        assert!(!s.hit_test(25.0, 60.0));
    }

    #[test]
    fn multiple_rects_union() {
        let s = HitRegionStore::new();
        s.upsert("a".into(), r(0.0, 0.0, 10.0, 10.0));
        s.upsert("b".into(), r(100.0, 100.0, 10.0, 10.0));
        assert!(s.hit_test(5.0, 5.0));
        assert!(s.hit_test(105.0, 105.0));
        assert!(!s.hit_test(50.0, 50.0));
    }

    #[test]
    fn upsert_same_id_replaces() {
        let s = HitRegionStore::new();
        s.upsert("a".into(), r(0.0, 0.0, 10.0, 10.0));
        s.upsert("a".into(), r(100.0, 100.0, 10.0, 10.0));
        assert!(!s.hit_test(5.0, 5.0));
        assert!(s.hit_test(105.0, 105.0));
    }

    #[test]
    fn remove_clears_rect() {
        let s = HitRegionStore::new();
        s.upsert("a".into(), r(0.0, 0.0, 10.0, 10.0));
        s.remove("a");
        assert!(!s.hit_test(5.0, 5.0));
    }

    #[test]
    fn clear_drops_all_rects() {
        let s = HitRegionStore::new();
        s.upsert("a".into(), r(0.0, 0.0, 10.0, 10.0));
        s.upsert("b".into(), r(100.0, 100.0, 10.0, 10.0));
        s.clear();
        assert!(!s.hit_test(5.0, 5.0));
        assert!(!s.hit_test(105.0, 105.0));
    }
}
```

- [ ] **Step 2: Run the test to verify it fails to compile**

Run: `cd app/src-tauri && cargo test --lib passthrough::tests`
Expected: compile errors — `cannot find type Rect`, `HitRegionStore`, etc. This proves we're starting from zero.

- [ ] **Step 3: Implement `Rect`, `HitRegionStore`, and the platform dispatch shell**

Add at the top of `app/src-tauri/src/passthrough/mod.rs`:

```rust
//! 透传命中区域：前端注册 UI rect → 平台原生层在每次 OS 命中测试时查询。
//! 详细设计见 docs/superpowers/specs/2026-05-15-overlay-hit-passthrough-design.md。

use std::collections::HashMap;
use std::sync::Mutex;
use serde::{Deserialize, Serialize};
use tauri::{State, WebviewWindow};

#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "windows")]
mod windows;
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
mod stub;

/// Window-local CSS-pixel 矩形，左上原点（与 DOMRect 一致）。平台层负责把 OS
/// 事件坐标转到此坐标系。
#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

impl Rect {
    pub fn contains(&self, x: f64, y: f64) -> bool {
        x >= self.x && x < self.x + self.w && y >= self.y && y < self.y + self.h
    }
}

/// 注册表：id → window-local rect。clone 出来一个 Arc 句柄交给原生层；前端
/// 通过 Tauri command 增删改 rect。
pub struct HitRegionStore {
    inner: Mutex<HashMap<String, Rect>>,
}

impl HitRegionStore {
    pub fn new() -> Self {
        Self { inner: Mutex::new(HashMap::new()) }
    }

    pub fn upsert(&self, id: String, rect: Rect) {
        self.inner.lock().unwrap().insert(id, rect);
    }

    pub fn remove(&self, id: &str) {
        self.inner.lock().unwrap().remove(id);
    }

    pub fn clear(&self) {
        self.inner.lock().unwrap().clear();
    }

    /// O(n) 全表线性扫描；命中即返回 true。n 通常 ≤ 5，不需要空间索引。
    pub fn hit_test(&self, x: f64, y: f64) -> bool {
        self.inner.lock().unwrap().values().any(|r| r.contains(x, y))
    }
}

#[tauri::command]
pub fn register_hit_region(state: State<HitRegionStore>, id: String, rect: Rect) {
    state.upsert(id, rect);
}

#[tauri::command]
pub fn unregister_hit_region(state: State<HitRegionStore>, id: String) {
    state.remove(&id);
}

#[tauri::command]
pub fn clear_hit_regions(state: State<HitRegionStore>) {
    state.clear();
}

/// 在主窗口上安装平台原生 hit-test 钩子。在 setup() 内调用一次；失败仅打日志。
pub fn install(window: &WebviewWindow, store: std::sync::Arc<HitRegionStore>) {
    #[cfg(target_os = "macos")]
    macos::install_impl(window, store);
    #[cfg(target_os = "windows")]
    windows::install_impl(window, store);
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    stub::install_impl(window, store);
}

/// 在窗口/进程关闭时摘掉钩子；幂等。
pub fn uninstall(window: &WebviewWindow) {
    #[cfg(target_os = "macos")]
    macos::uninstall_impl(window);
    #[cfg(target_os = "windows")]
    windows::uninstall_impl(window);
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    stub::uninstall_impl(window);
}
```

Then create the stub file so the `not(macos|windows)` build compiles:

```rust
// app/src-tauri/src/passthrough/stub.rs
use super::HitRegionStore;
use tauri::WebviewWindow;

pub fn install_impl(_w: &WebviewWindow, _s: std::sync::Arc<HitRegionStore>) {}
pub fn uninstall_impl(_w: &WebviewWindow) {}
```

And create empty placeholders so the `mod` declarations compile on macOS / Windows builds:

```rust
// app/src-tauri/src/passthrough/macos.rs
use super::HitRegionStore;
use tauri::WebviewWindow;

pub fn install_impl(_w: &WebviewWindow, _s: std::sync::Arc<HitRegionStore>) {
    // filled in by Task 6
}
pub fn uninstall_impl(_w: &WebviewWindow) {}
```

```rust
// app/src-tauri/src/passthrough/windows.rs
use super::HitRegionStore;
use tauri::WebviewWindow;

pub fn install_impl(_w: &WebviewWindow, _s: std::sync::Arc<HitRegionStore>) {
    // filled in by Task 8
}
pub fn uninstall_impl(_w: &WebviewWindow) {}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd app/src-tauri && cargo test --lib passthrough::tests`
Expected: 6 passed.

- [ ] **Step 5: Run `cargo check` against all targets to confirm the module shell compiles cleanly**

Run: `cd app/src-tauri && cargo check`
Expected: no errors (warnings about unused functions are OK at this point).

- [ ] **Step 6: Commit**

```bash
git add app/src-tauri/src/passthrough/
git commit -m "$(cat <<'EOF'
Add passthrough::HitRegionStore (platform-neutral rect set)

Shared rect store + Tauri command shells (register/unregister/clear)
plus a platform-dispatch install()/uninstall() that today no-ops on
every platform. macOS and Windows implementations follow.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Wire commands and state into `lib.rs`

**Files:**
- Modify: `app/src-tauri/src/lib.rs`

- [ ] **Step 1: Add the module declaration, state, install hook, and three commands**

Open `app/src-tauri/src/lib.rs`. Make these targeted edits:

After existing `mod active_app; mod key_counter;` (line 1-2), add:

```rust
mod passthrough;
```

Inside `pub fn run()`, **before** `let app = tauri::Builder::default()` (around line 65-66), add:

```rust
let hit_store = std::sync::Arc::new(passthrough::HitRegionStore::new());
let hit_store_for_setup = hit_store.clone();
let hit_store_for_manage = hit_store.clone();
```

Inside `tauri::Builder::default()`, register the store via `.manage(...)` (insert right after the existing `.plugin(tauri_plugin_store::Builder::new().build())` line, around line 68):

```rust
        .manage::<std::sync::Arc<passthrough::HitRegionStore>>(hit_store_for_manage)
```

Inside the `.setup(move |app| { ... })` closure, **after** the `if let Some(window) = app.get_webview_window("main") { let _ = window.set_always_on_top(true); }` block (around line 70-72), add:

```rust
            if let Some(window) = app.get_webview_window("main") {
                passthrough::install(&window, hit_store_for_setup.clone());
            }
```

Extend the `invoke_handler` list (around line 109-115) to:

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

In the closing `app.run(...)` callback (around line 119-124), add uninstall on exit:

```rust
    app.run(move |handle, event| {
        if matches!(event, RunEvent::ExitRequested { .. } | RunEvent::Exit) {
            active_app_stop_for_exit.store(true, Ordering::Relaxed);
            key_counter_stop_for_exit.store(true, Ordering::Relaxed);
            if let Some(window) = handle.get_webview_window("main") {
                passthrough::uninstall(&window);
            }
        }
    });
```

Note the closure param `_handle` is now used → rename to `handle`.

- [ ] **Step 2: Build to confirm wiring**

Run: `cd app/src-tauri && cargo build`
Expected: builds cleanly. (`Tauri::State<Arc<HitRegionStore>>` resolves because we registered it via `.manage()`. The commands accept `State<HitRegionStore>` — we'll need to either change them to `State<Arc<HitRegionStore>>` or unwrap. The simplest fix: change the command signatures to take `State<'_, Arc<HitRegionStore>>` and deref inside.)

If the build fails because of the state-type mismatch, **update `passthrough/mod.rs` command signatures** to:

```rust
#[tauri::command]
pub fn register_hit_region(
    state: State<'_, std::sync::Arc<HitRegionStore>>,
    id: String,
    rect: Rect,
) {
    state.upsert(id, rect);
}

#[tauri::command]
pub fn unregister_hit_region(
    state: State<'_, std::sync::Arc<HitRegionStore>>,
    id: String,
) {
    state.remove(&id);
}

#[tauri::command]
pub fn clear_hit_regions(state: State<'_, std::sync::Arc<HitRegionStore>>) {
    state.clear();
}
```

Rerun `cargo build`. Expected: success.

- [ ] **Step 3: Smoke-launch the app to confirm nothing regressed**

Run: `cd app && npm run tauri dev`
Expected: window opens as before; no panic in stderr; existing commands still work. Close the window. (Visual passthrough behavior is unchanged until native install is implemented in Tasks 6/8.)

- [ ] **Step 4: Commit**

```bash
git add app/src-tauri/src/lib.rs app/src-tauri/src/passthrough/mod.rs
git commit -m "$(cat <<'EOF'
Wire passthrough state + commands into Tauri setup/teardown

manage()s the shared HitRegionStore, exposes register/unregister/clear
commands, installs the (currently no-op) platform hook in setup() and
uninstalls on ExitRequested|Exit.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Frontend `useHitRegion` hook + tests

**Files:**
- Create: `app/src/domain/passthrough.ts`
- Create: `app/src/domain/passthrough.test.ts`

- [ ] **Step 1: Write the failing tests first**

Create `app/src/domain/passthrough.test.ts`:

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import React from 'react';

const invokeMock = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({
    invoke: (...args: unknown[]) => invokeMock(...args),
}));

// Import AFTER the mock is registered.
const { useHitRegion, clearHitRegions } = await import('./passthrough');

function Probe({ label, hide }: { label: string; hide?: boolean }) {
    const ref = useHitRegion(label);
    if (hide) return null;
    return <div ref={ref} style={{ position: 'absolute', left: 10, top: 20, width: 30, height: 40 }} data-testid="probe" />;
}

describe('useHitRegion', () => {
    beforeEach(() => {
        invokeMock.mockReset();
        cleanup();
    });

    it('registers on mount with a unique id and the element rect', () => {
        const { unmount } = render(<Probe label="panel-a" />);
        const calls = invokeMock.mock.calls.filter(([cmd]) => cmd === 'register_hit_region');
        expect(calls.length).toBeGreaterThanOrEqual(1);
        const [, args] = calls[0];
        expect(args.id).toMatch(/^panel-a-\d+$/);
        expect(args.rect).toEqual({ x: 10, y: 20, w: 30, h: 40 });
        unmount();
    });

    it('unregisters on unmount with the same id used at mount', () => {
        const { unmount } = render(<Probe label="panel-b" />);
        const registerCall = invokeMock.mock.calls.find(([cmd]) => cmd === 'register_hit_region')!;
        const id = registerCall[1].id;
        invokeMock.mockClear();
        unmount();
        const unregister = invokeMock.mock.calls.find(([cmd]) => cmd === 'unregister_hit_region');
        expect(unregister).toBeTruthy();
        expect(unregister![1]).toEqual({ id });
    });

    it('handles conditional rendering: registers when the element appears, unregisters when it disappears', () => {
        const { rerender } = render(<Probe label="panel-c" hide />);
        expect(invokeMock.mock.calls.filter(([c]) => c === 'register_hit_region')).toHaveLength(0);
        rerender(<Probe label="panel-c" />);
        expect(invokeMock.mock.calls.filter(([c]) => c === 'register_hit_region')).toHaveLength(1);
        rerender(<Probe label="panel-c" hide />);
        expect(invokeMock.mock.calls.filter(([c]) => c === 'unregister_hit_region')).toHaveLength(1);
    });

    it('two instances get different ids', () => {
        render(
            <>
                <Probe label="dup" />
                <Probe label="dup" />
            </>,
        );
        const ids = invokeMock.mock.calls
            .filter(([c]) => c === 'register_hit_region')
            .map(([, a]) => a.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it('clearHitRegions() forwards to the clear_hit_regions command', () => {
        invokeMock.mockReset();
        clearHitRegions();
        expect(invokeMock).toHaveBeenCalledWith('clear_hit_regions');
    });
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `cd app && npx vitest run src/domain/passthrough.test.ts`
Expected: failure — module `./passthrough` not found.

- [ ] **Step 3: Implement the hook**

Create `app/src/domain/passthrough.ts`:

```typescript
import { useCallback, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';

let counter = 0;
const newId = (label: string) => `${label}-${++counter}`;

/**
 * Register the given DOM element as a hit region: native code will accept
 * mouse events that land inside its bounding rect, and pass everything else
 * through to whichever app is underneath.
 *
 * Returns a ref-callback so the hook handles attach/detach correctly even
 * when the host component returns null conditionally. Pass the result as a
 * React `ref` prop.
 *
 * Re-reports the rect on element resize, ancestor reflow (`window.resize`),
 * and style/class mutations (covers panels that move via inline transform).
 */
export function useHitRegion(label: string): (el: HTMLElement | null) => void {
    const idRef = useRef<string | null>(null);
    const observerRef = useRef<ResizeObserver | null>(null);
    const mutationRef = useRef<MutationObserver | null>(null);
    const resizeHandlerRef = useRef<(() => void) | null>(null);

    const report = useCallback((el: HTMLElement) => {
        const r = el.getBoundingClientRect();
        if (!idRef.current) return;
        void invoke('register_hit_region', {
            id: idRef.current,
            rect: { x: r.left, y: r.top, w: r.width, h: r.height },
        });
    }, []);

    return useCallback((el: HTMLElement | null) => {
        if (el === null) {
            if (idRef.current) {
                void invoke('unregister_hit_region', { id: idRef.current });
                idRef.current = null;
            }
            observerRef.current?.disconnect();
            mutationRef.current?.disconnect();
            if (resizeHandlerRef.current) {
                window.removeEventListener('resize', resizeHandlerRef.current);
                resizeHandlerRef.current = null;
            }
            return;
        }
        idRef.current = newId(label);
        report(el);
        const ro = new ResizeObserver(() => report(el));
        ro.observe(el);
        observerRef.current = ro;
        const mo = new MutationObserver(() => report(el));
        mo.observe(el, { attributes: true, attributeFilter: ['style', 'class'] });
        mutationRef.current = mo;
        const onResize = () => report(el);
        window.addEventListener('resize', onResize);
        resizeHandlerRef.current = onResize;
    }, [label, report]);
}

/**
 * Clear every registered hit region. Call once on app boot so a webview
 * reload (which re-mounts the React tree) doesn't leave stale rects from
 * the previous load alive in Rust state.
 */
export function clearHitRegions(): void {
    void invoke('clear_hit_regions');
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd app && npx vitest run src/domain/passthrough.test.ts`
Expected: 5 passed.

- [ ] **Step 5: Run the full vitest suite to make sure nothing else broke**

Run: `cd app && npm test`
Expected: all tests pass, including the existing ones in `app/src/domain/`.

- [ ] **Step 6: Commit**

```bash
git add app/src/domain/passthrough.ts app/src/domain/passthrough.test.ts
git commit -m "$(cat <<'EOF'
Add useHitRegion hook + clearHitRegions boot helper

Ref-callback so conditional rendering attaches/detaches correctly.
Re-reports on ResizeObserver, ancestor resize, and style/class mutations.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Wire `useHitRegion` into `PomodoroPanel`

**Files:**
- Modify: `app/src/ui/PomodoroPanel.tsx`

- [ ] **Step 1: Attach the hook to the panel's root div**

In `app/src/ui/PomodoroPanel.tsx`:

After the existing `import` block (around line 5), add:

```typescript
import { useHitRegion } from '../domain/passthrough';
```

Inside `PomodoroPanel()`, near the top (before `useEffect`), add:

```typescript
    const hitRef = useHitRegion('pomodoro-panel');
```

Change the root JSX element (line 65) from:

```tsx
        <div className="pomo-panel" data-clock-state={clockState}>
```

to:

```tsx
        <div ref={hitRef} className="pomo-panel" data-clock-state={clockState}>
```

- [ ] **Step 2: Run the vitest suite**

Run: `cd app && npm test`
Expected: all tests still pass (existing PomodoroPanel tests, if any, don't care about the extra ref).

- [ ] **Step 3: Commit**

```bash
git add app/src/ui/PomodoroPanel.tsx
git commit -m "$(cat <<'EOF'
Register PomodoroPanel as a hit region

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Wire `useHitRegion` into `RemoteRoster`

**Files:**
- Modify: `app/src/ui/RemoteRoster.tsx`

- [ ] **Step 1: Attach the hook; keep the early-return guard**

Rewrite `app/src/ui/RemoteRoster.tsx` to:

```tsx
import { useNetworkStore } from '../domain/network';
import { useHitRegion } from '../domain/passthrough';
import { PlayerCard } from './PlayerCard';
import './RemoteRoster.css';

export function RemoteRoster() {
    const players = useNetworkStore((s) => s.players);
    const playerId = useNetworkStore((s) => s.playerId);
    const hitRef = useHitRegion('remote-roster');
    const others = Object.values(players).filter((p) => p.playerId !== playerId);
    if (others.length === 0) return null;

    return (
        <div ref={hitRef} className="remote-roster">
            {others.map((p) => (
                <PlayerCard key={p.playerId} player={p} />
            ))}
        </div>
    );
}
```

Because `useHitRegion` returns a ref **callback** (not an object ref), the early-return path is safe: when `others.length === 0` the component returns `null`, the ref callback isn't attached, and `idRef` stays null inside the hook. When `others` becomes non-empty later, React mounts the div, the callback fires with the element, and we register. When it goes back to empty, React unmounts the div, the callback fires with `null`, and we unregister.

- [ ] **Step 2: Run the vitest suite**

Run: `cd app && npm test`
Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add app/src/ui/RemoteRoster.tsx
git commit -m "$(cat <<'EOF'
Register RemoteRoster as a hit region

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Call `clearHitRegions()` once on boot

**Files:**
- Modify: `app/src/main.tsx`

- [ ] **Step 1: Read the current `main.tsx` to find the right insertion point**

Run: `cat app/src/main.tsx`
Look for where the React root is created (e.g. `ReactDOM.createRoot(...).render(...)`). The clear call goes **before** the first `render(...)`.

- [ ] **Step 2: Insert the boot-time clear**

Near the top of `app/src/main.tsx`, after the existing imports, add:

```typescript
import { clearHitRegions } from './domain/passthrough';
```

Before the `createRoot(...).render(...)` line, add:

```typescript
void clearHitRegions();
```

(If `main.tsx` does environment-specific routing, e.g. checking `window=settings`, ensure the clear runs only when booting the **main** window. If the file branches early for the settings window, put the call inside the main-window branch.)

- [ ] **Step 3: Run the vitest suite + start the dev server to confirm no regression**

Run: `cd app && npm test`
Expected: all pass.

Run: `cd app && npm run tauri dev` (manual check: app launches, no console errors mentioning `clear_hit_regions`)
Then close it.

- [ ] **Step 4: Commit**

```bash
git add app/src/main.tsx
git commit -m "$(cat <<'EOF'
Clear hit regions on app boot

So a webview reload doesn't leave orphan rects in the Rust store.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: macOS — `CPAPassthroughView` (NSView subclass)

**Files:**
- Modify: `app/src-tauri/Cargo.toml`
- Modify: `app/src-tauri/src/passthrough/macos.rs`

- [ ] **Step 1: Extend `objc2-app-kit` features so `NSView` is available**

In `app/src-tauri/Cargo.toml`, change the existing macOS dep line from:

```toml
objc2-app-kit = { version = "0.3", features = ["NSWorkspace", "NSRunningApplication"] }
```

to:

```toml
objc2-app-kit = { version = "0.3", features = ["NSWorkspace", "NSRunningApplication", "NSView", "NSWindow", "NSResponder", "NSEvent"] }
```

Run: `cd app/src-tauri && cargo build`
Expected: builds clean (no usage yet of the new features).

- [ ] **Step 2: Implement `CPAPassthroughView` and `install_impl`**

Replace `app/src-tauri/src/passthrough/macos.rs` with:

```rust
//! macOS hit-test 透传：动态子类化 NSView，重写 `hitTest:` 让透明区域返回 nil。
//!
//! AppKit 命中测试时调用 contentView 的 `hitTest:`；返回 nil 表示「该点不属于
//! 这个窗口」，AppKit 自然把事件投递到 z-order 下一个窗口。

use super::HitRegionStore;
use objc2::{
    define_class, msg_send, rc::Retained, runtime::AnyObject, AllocAnyThread, DefinedClass,
};
use objc2_app_kit::{NSAutoresizingMaskOptions, NSView, NSWindow};
use objc2_foundation::{MainThreadMarker, NSPoint, NSRect};
use std::sync::Arc;
use tauri::WebviewWindow;

/// 我们子类的 instance variable：指向共享 store 的 raw pointer（Arc 的克隆，
/// view 自己持有一份引用）。view dealloc 时通过 `Arc::from_raw` 释放。
struct PassthroughIvars {
    store: *const HitRegionStore,
}

define_class!(
    #[unsafe(super = NSView)]
    #[name = "CPAPassthroughView"]
    #[ivars = PassthroughIvars]
    struct PassthroughView;

    impl PassthroughView {
        #[unsafe(method(hitTest:))]
        fn hit_test(&self, point: NSPoint) -> *mut AnyObject {
            let store = unsafe { &*self.ivars().store };
            // `point` 在 super-view 坐标系。AppKit 左下原点 → DOM 左上原点：
            // 用 self.bounds().size.height 翻转 Y。
            let bounds: NSRect = unsafe { msg_send![self, bounds] };
            let x = point.x;
            let y = bounds.size.height - point.y;
            if store.hit_test(x, y) {
                // 把命中委派给原 WKWebView (我们装在第一个 subview)，让事件
                // 正常流入 WKWebView → React。
                let subviews: *mut AnyObject = unsafe { msg_send![self, subviews] };
                if subviews.is_null() {
                    return std::ptr::null_mut();
                }
                let first: *mut AnyObject = unsafe { msg_send![subviews, firstObject] };
                if first.is_null() {
                    return std::ptr::null_mut();
                }
                unsafe { msg_send![first, hitTest: point] }
            } else {
                std::ptr::null_mut()
            }
        }
    }
);

pub fn install_impl(window: &WebviewWindow, store: Arc<HitRegionStore>) {
    let ns_window_ptr = match window.ns_window() {
        Ok(ptr) => ptr as *mut NSWindow,
        Err(_) => {
            eprintln!("[passthrough/macos] ns_window() returned Err; skipping install");
            return;
        }
    };
    // Safety: NSWindow 必须在主线程访问；Tauri 在主线程调 setup()。
    let mtm = unsafe { MainThreadMarker::new_unchecked() };
    let ns_window: &NSWindow = unsafe { &*ns_window_ptr };

    let old_content: Retained<NSView> = match unsafe { ns_window.contentView() } {
        Some(v) => v,
        None => {
            eprintln!("[passthrough/macos] window has no contentView; skipping install");
            return;
        }
    };
    let frame = old_content.frame();

    // Leak the Arc → raw ptr; view dealloc 时收回。
    let store_raw: *const HitRegionStore = Arc::into_raw(store);

    let view = PassthroughView::alloc(mtm).set_ivars(PassthroughIvars { store: store_raw });
    let view: Retained<PassthroughView> = unsafe { msg_send![super(view), initWithFrame: frame] };

    // 取下 old content，装进新 view 作 subview，新 view 设为 contentView。
    unsafe {
        old_content.removeFromSuperview();
        view.addSubview(&old_content);
        old_content.setAutoresizingMask(
            NSAutoresizingMaskOptions::ViewWidthSizable
                | NSAutoresizingMaskOptions::ViewHeightSizable,
        );
        ns_window.setContentView(Some(&view));
    }
}

pub fn uninstall_impl(_window: &WebviewWindow) {
    // 进程退出时 NSWindow 释放 → CPAPassthroughView 释放 → ivars drop →
    // 我们需要在自定义 dealloc 里 Arc::from_raw 回收 store 句柄，否则 Arc 永久泄漏。
    // 这里先不实装（进程退出后 OS 回收内存）；如果未来要支持运行时卸载，再补
    // dealloc 重写。文档化在 spec §6。
}
```

- [ ] **Step 3: Build for macOS**

Run: `cd app/src-tauri && cargo build`
Expected: builds. If `objc2` 0.6's macro API differs (it has evolved), look up the latest signature for `define_class!` and `set_ivars`/`init` patterns at <https://docs.rs/objc2/0.6/objc2/macro.define_class.html> and adjust. Specifically:
- `define_class!` superclass syntax may need `#[unsafe(super = NSView)]` exactly as written.
- The `initWithFrame:` call may need `objc2_app_kit::NSView::initWithFrame` directly instead of `msg_send!`.

If the macro form rejects, an alternative is to call `objc2::sel!` + `msg_send!` directly, similar to how the spec's pseudo-code does it. The functional contract is the same: a class with `hitTest:` checking the store.

- [ ] **Step 4: Manual sanity check that the view is installed**

Run: `cd app && npm run tauri dev`
Move the window over Finder or any non-Pomodoro area. Try to drag a file or select text *in the area covered by the transparent window but not over the visible Pomodoro panel*.

Expected: the drag/select **works in the underlying app** (passes through). Over the Pomodoro panel pixels, hovering/clicking works as before (buttons clickable, drag handle drags the window).

If pass: close the app.
If fail (still blocked): check `stderr` for `[passthrough/macos]` messages; verify `ns_window()` returned Ok; verify Step 2 of Task 4 actually ran (panel registered).

- [ ] **Step 5: Commit**

```bash
git add app/src-tauri/Cargo.toml app/src-tauri/src/passthrough/macos.rs
git commit -m "$(cat <<'EOF'
Implement macOS passthrough via NSView hitTest: subclass

Replaces the main window's contentView with CPAPassthroughView, which
returns nil from hitTest: for any point not inside a registered region.
Original WKWebView container becomes a subview and continues to handle
events that land in UI regions.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Windows — `SetWindowSubclass` + `WM_NCHITTEST`

**Files:**
- Modify: `app/src-tauri/Cargo.toml`
- Modify: `app/src-tauri/src/passthrough/windows.rs`

- [ ] **Step 1: Add the `windows` crate for the Win32 target**

Append to `app/src-tauri/Cargo.toml`:

```toml
[target.'cfg(target_os = "windows")'.dependencies]
windows = { version = "0.58", features = [
    "Win32_Foundation",
    "Win32_UI_WindowsAndMessaging",
    "Win32_UI_Controls",
    "Win32_UI_HiDpi",
    "Win32_Graphics_Gdi",
] }
```

- [ ] **Step 2: Implement the WndProc subclass**

Replace `app/src-tauri/src/passthrough/windows.rs` with:

```rust
//! Windows hit-test 透传：用 SetWindowSubclass 注入 WndProc，处理 WM_NCHITTEST。
//! 命中 UI region 时返回 HTCLIENT（让默认路由把事件投到 WebView2 子窗口），
//! 否则返回 HTTRANSPARENT（OS 视该窗口在此点不存在 → 事件去 z-order 下一个）。

use super::HitRegionStore;
use std::sync::Arc;
use tauri::WebviewWindow;
use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, POINT, WPARAM};
use windows::Win32::Graphics::Gdi::ScreenToClient;
use windows::Win32::UI::Controls::{
    DefSubclassProc, RemoveWindowSubclass, SetWindowSubclass,
};
use windows::Win32::UI::HiDpi::GetDpiForWindow;
use windows::Win32::UI::WindowsAndMessaging::{HTCLIENT, HTTRANSPARENT, WM_NCHITTEST};

const SUBCLASS_ID: usize = 0xCA0_FA11; // arbitrary, just must be stable & unique

unsafe extern "system" fn subclass_proc(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
    _id_subclass: usize,
    ref_data: usize,
) -> LRESULT {
    if msg == WM_NCHITTEST {
        let store = unsafe { &*(ref_data as *const HitRegionStore) };
        // LPARAM 低 16 位 = screen X，高 16 位 = screen Y；都是 i16。
        let raw = lparam.0 as isize;
        let screen_x = ((raw & 0xFFFF) as i16) as i32;
        let screen_y = (((raw >> 16) & 0xFFFF) as i16) as i32;
        let mut pt = POINT { x: screen_x, y: screen_y };
        if unsafe { ScreenToClient(hwnd, &mut pt) }.as_bool() {
            let dpi = unsafe { GetDpiForWindow(hwnd) };
            let scale = if dpi == 0 { 1.0 } else { dpi as f64 / 96.0 };
            let x = pt.x as f64 / scale;
            let y = pt.y as f64 / scale;
            if store.hit_test(x, y) {
                return LRESULT(HTCLIENT as isize);
            } else {
                return LRESULT(HTTRANSPARENT as isize);
            }
        }
    }
    unsafe { DefSubclassProc(hwnd, msg, wparam, lparam) }
}

pub fn install_impl(window: &WebviewWindow, store: Arc<HitRegionStore>) {
    let hwnd = match window.hwnd() {
        Ok(h) => HWND(h.0 as *mut _),
        Err(_) => {
            eprintln!("[passthrough/windows] hwnd() returned Err; skipping install");
            return;
        }
    };
    // Leak Arc → raw ptr; uninstall_impl 收回。
    let raw: *const HitRegionStore = Arc::into_raw(store);
    let ok = unsafe {
        SetWindowSubclass(hwnd, Some(subclass_proc), SUBCLASS_ID, raw as usize)
    }
    .as_bool();
    if !ok {
        eprintln!("[passthrough/windows] SetWindowSubclass failed");
        // 失败时把 Arc 收回防止泄漏
        unsafe { let _ = Arc::from_raw(raw); };
    }
}

pub fn uninstall_impl(window: &WebviewWindow) {
    let hwnd = match window.hwnd() {
        Ok(h) => HWND(h.0 as *mut _),
        Err(_) => return,
    };
    // ref_data 拿不回来；只能在 install 时另存一份指针。这里简化：直接 remove，
    // Arc 在 install 路径 leak 后由进程退出收回（与 macOS 当前同策略，文档化）。
    unsafe { let _ = RemoveWindowSubclass(hwnd, Some(subclass_proc), SUBCLASS_ID); };
}
```

- [ ] **Step 3: Build for Windows**

If a Windows build environment is available locally (or via CI/cross-build), run:

```
cd app/src-tauri && cargo build --target x86_64-pc-windows-msvc
```

Otherwise rely on CI. Expected: clean build. If `windows` crate API differs (e.g. `HWND` constructor takes `HANDLE`), adjust the constructor call.

- [ ] **Step 4: Manual verification on Windows**

(Requires actual Windows machine — record outcome in commit message.)

Build & run with `npm run tauri dev` on Windows. Repeat the spec's testing checklist (§7 items 1-7) and confirm:
- Drag in another app under the transparent area: works.
- Click/drag the Pomodoro panel: works.
- DPI scale change (150% / 200%): hit-test still aligned.

- [ ] **Step 5: Commit**

```bash
git add app/src-tauri/Cargo.toml app/src-tauri/src/passthrough/windows.rs
git commit -m "$(cat <<'EOF'
Implement Windows passthrough via WM_NCHITTEST subclass

SetWindowSubclass injects a WndProc that returns HTTRANSPARENT for any
client-area point not inside a registered hit region, HTCLIENT otherwise.
Uses GetDpiForWindow each call so DPI changes are picked up immediately.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: End-to-end manual checklist (both platforms)

**Files:** none

- [ ] **Step 1: Run the full spec testing checklist on macOS**

Per spec `§7 — Testing — 手测 checklist`:

1. 启动 app → 移到 Finder 上 → 拖文件/拖选/拖窗 不受影响。
2. 光标在 PomodoroPanel 上 → 所有按钮/滚动正常。
3. PomodoroPanel header 按下 → 拖到透明区 → OS 级窗口拖动完成。
4. 加入有远端玩家的房间 → RemoteRoster 出现 → 该区域立即接管输入；离开房间后区域可穿透。
5. cmd-tab 来回切 → 行为不变。
6. 4K 屏 DPR 2x → 命中边界与可视边界一致。

Record outcome (pass/fail per item) in a comment on the relevant PR.

- [ ] **Step 2: Run the full spec testing checklist on Windows**

Same 7 items but Windows analogues (alt-tab; Explorer instead of Finder; DPI 150%/175%/200% switch via Settings → Display → Scale).

- [ ] **Step 3: Final unified commit (no code, just confirms the checklist)**

If no code changes are needed after the checklist, no commit is necessary. If issues surfaced, return to the relevant earlier task and fix.

---

## Notes for the implementing engineer

- **Don't add window-level event toggles.** Resist any urge to also call `set_ignore_cursor_events` or set `WS_EX_TRANSPARENT` as a "belt and suspenders" mechanism — CLAUDE.md explicitly forbids it because the two approaches race.
- **Hit-test is called *very* often** (every mouse move, every keystroke that AppKit/Windows checks under cursor). Keep the `hit_test` path lock-and-scan only; never allocate inside.
- **The Arc leak in uninstall** (macOS Task 7, Windows Task 8) is deliberate: process-exit cleanup is fine for now and avoids the complexity of dealloc-time pointer recovery. If the codebase later needs runtime install/uninstall (e.g. window recreate), revisit by either (a) storing the raw pointer separately and freeing it explicitly in `uninstall_impl`, or (b) overriding `dealloc` in `CPAPassthroughView`.
- **The settings window is intentionally not touched.** It's a separate WebviewWindow created on demand; its full surface is interactive, so passthrough is not needed and would only complicate things.
- **`objc2` 0.6 API drift:** if the macros' exact syntax differs from what's shown, refer to <https://docs.rs/objc2/0.6/> for the canonical signatures. The semantic contract is fixed: a class extending NSView, an instance ivar holding a `*const HitRegionStore`, a method `hitTest:(NSPoint)` returning `*mut AnyObject` (nil for passthrough, super-delegated for hit).
- **Cross-platform stub (`stub.rs`)** keeps Linux builds green for any future contributor; it's intentionally not part of any platform CI right now.
- **Deviation from spec §6 (orphan-rect cleanup):** the spec described listening for `WindowEvent::Destroyed` + webview reload events on the Rust side to reset the store. This plan instead clears once at the start of every page load via `clearHitRegions()` in `main.tsx` (Task 6). It's strictly simpler and covers the same failure mode (webview reload re-mounts React → first thing it does is clear stale state). If a future requirement appears for clearing without a page load, layer the Rust-side event listener on top — don't replace the boot-time clear.
