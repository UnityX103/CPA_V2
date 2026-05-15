# Settings Panel — Dedicated Tauri Window Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the Settings panel out of the main Tauri window into its own programmatically-built `settings` window, so Pomodoro and Settings can be dragged independently while preserving every existing UI behavior.

**Architecture:** Rust adds two lifecycle commands (`open_settings_window`, `close_settings_window`) that build the second window lazily and reuse it via `hide()`/`show()`. A single `index.html` dispatches to `App.tsx` or `SettingsApp.tsx` based on the `?window=settings` query string. Domain zustand stores in the settings window are constructed via a factory that detects the window mode; in settings mode, write actions become point-to-point Tauri events to the main window (`app:dispatch`), and the main window broadcasts state snapshots back (`app:state`). Source of truth always lives in the main window.

**Tech Stack:** Tauri 2 (Rust shell, `WebviewWindowBuilder`, `@tauri-apps/api/webviewWindow` JS API), React + TypeScript, zustand, vitest (jsdom).

**Repo note:** This codebase has no git. Skip every "commit" step. After each task, the gate is **all `vitest run` and `tsc --noEmit` checks pass**.

---

## File Structure

**Tauri (Rust):**
- `app/src-tauri/src/lib.rs` — register `open_settings_window`, `close_settings_window` (+ existing).
- `app/src-tauri/capabilities/default.json` — extend `windows` to `["main", "settings"]`.

**App entry & routing:**
- `app/src/main.tsx` — dispatch on `?window=settings`.
- `app/src/App.tsx` — main-window root; drops `<SettingsPanel/>`, adds `useBridgeHost`.
- `app/src/SettingsApp.tsx` — **new** settings-window root; mounts `useBridgeClient` + `<SettingsPanel/>`.

**Bridge module (`app/src/domain/bridge/`):**
- `protocol.ts` — **new**, event names, `BRIDGE_VERSION`, `BridgeSnapshot`, `DispatchPayload` types.
- `dispatch.ts` — **new**, `dispatch(payload)` helper that emits `app:dispatch` to the main window.
- `host.ts` — **new**, `useBridgeHost()`, `buildSnapshot()`, `applyDispatch()`.
- `client.ts` — **new**, `useBridgeClient()`, `applySnapshotToMirrors()`.
- `protocol.test.ts` — **new**, type/version sanity.
- `host.test.ts` — **new**, snapshot shape + dispatch routing.
- `client.test.ts` — **new**, mirror application.

**Domain stores (split via factory `createXStore({ isSettingsWindow })`):**
- `app/src/domain/settings.ts` — drop `isOpen`, `open`, `close` from type; factory.
- `app/src/domain/pomodoro.ts` — factory; only `applySettings` swapped in settings mode.
- `app/src/domain/network.ts` — factory; `createRoom`, `joinRoom`, `leaveRoom`, `setAutoConnect`, `setPlayerName` swapped.
- `app/src/domain/bindingKey.ts` — factory; `addEntry`, `removeEntry`, `setSynced`, `beginCapture` swapped.

**UI:**
- `app/src/ui/SettingsPanel.tsx` — remove `isOpen` early-return; close button calls `invoke('close_settings_window')`.
- `app/src/ui/SettingsPanel.css` — drop centering transform; `position: relative` so the panel fills its window.
- `app/src/ui/PomodoroPanel.tsx` — gear icon `onClick` calls `invoke('open_settings_window')`.

**Tests:**
- `app/src/domain/settings.test.ts` — drop `open()` / `close()` tests; add settings-mode dispatcher test.
- `app/src/ui/SettingsPanel.test.tsx` — drop `isOpen: true` priming; update close-button assertion.
- New: `bridge/{protocol,host,client}.test.ts` (covered above).
- New: settings-mode dispatcher tests inside each store's existing `*.test.ts` (where one exists) or in the bridge tests.

---

## Task 1: Tauri window-lifecycle commands

**Files:**
- Modify: `app/src-tauri/src/lib.rs`
- Modify: `app/src-tauri/capabilities/default.json`

- [ ] **Step 1: Extend the capability windows list**

Edit `app/src-tauri/capabilities/default.json`:

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "桌宠番茄钟主窗口最小权限：仅暴露窗口拖动；其它特权操作走 #[tauri::command] 名单",
  "windows": ["main", "settings"],
  "permissions": [
    "core:default",
    "core:window:default",
    "core:window:allow-start-dragging",
    "core:event:default"
  ]
}
```

- [ ] **Step 2: Add `open_settings_window` and `close_settings_window` to `lib.rs`**

Open `app/src-tauri/src/lib.rs`. Replace the top `use tauri::...` line and add two commands. The full diff (showing the imports and new commands; leave the rest of the file alone):

```rust
use tauri::{Emitter, Manager, RunEvent, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
```

Then below `get_active_app`, add:

```rust
#[tauri::command]
async fn open_settings_window(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window("settings") {
        w.show().map_err(|e| e.to_string())?;
        w.set_focus().map_err(|e| e.to_string())?;
        return Ok(());
    }
    let url = WebviewUrl::App("index.html?window=settings".into());
    WebviewWindowBuilder::new(&app, "settings", url)
        .title("设置")
        .inner_size(460.0, 394.0)
        .resizable(false)
        .transparent(true)
        .decorations(false)
        .always_on_top(true)
        .shadow(false)
        .skip_taskbar(true)
        .visible(true)
        .center()
        .build()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn close_settings_window(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window("settings") {
        w.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}
```

- [ ] **Step 3: Register the new commands in `invoke_handler!`**

Find the `.invoke_handler(tauri::generate_handler![ ... ])` block and extend it:

```rust
.invoke_handler(tauri::generate_handler![
    set_click_through,
    set_always_on_top,
    get_active_app,
    open_settings_window,
    close_settings_window
])
```

- [ ] **Step 4: Verify Rust compiles**

Run:
```
cd app/src-tauri && cargo check
```
Expected: `Finished ... profile [unoptimized + debuginfo] target(s)` with no errors.

If `cargo` is not on PATH, use `PATH="/Users/xpy/.rustup/toolchains/stable-aarch64-apple-darwin/bin:$PATH" cargo check`.

- [ ] **Step 5: Verify the JS test suite is still green (no impact yet)**

```
cd app && npm test
```
Expected: 25/25 tests passing — same as before.

---

## Task 2: Query-string entry-point routing + stub settings root

**Files:**
- Modify: `app/src/main.tsx`
- Create: `app/src/SettingsApp.tsx`

- [ ] **Step 1: Create a stub `SettingsApp.tsx`**

Write `app/src/SettingsApp.tsx`:

```tsx
import './styles/global.css';

export default function SettingsApp() {
    return (
        <div
            style={{
                width: '100%',
                height: '100%',
                display: 'grid',
                placeItems: 'center',
                fontFamily: 'system-ui, sans-serif',
                color: '#374151',
                background: 'transparent',
            }}
        >
            <p>Settings window — bridge wiring pending.</p>
        </div>
    );
}
```

This is intentionally a placeholder so we can verify the routing works end-to-end before the bridge lands. Task 12 replaces the body with the real wiring.

- [ ] **Step 2: Update `main.tsx` to route on `?window=`**

Replace the file `app/src/main.tsx`:

```tsx
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import SettingsApp from "./SettingsApp";
import "./styles/global.css";

const which = new URLSearchParams(window.location.search).get("window");
const Root = which === "settings" ? SettingsApp : App;

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
        <Root />
    </React.StrictMode>,
);
```

- [ ] **Step 3: Type-check and test suite still green**

```
cd app && npm run build
```
Expected: `tsc && vite build` finishes with no errors.

```
cd app && npm test
```
Expected: 25/25 passing — jsdom's default URL has no `?window=`, so all existing tests still see main mode.

- [ ] **Step 4 (manual): Smoke-test the settings window plumbing**

```
cd app && npm run tauri dev
```
(Use `PATH="/Users/xpy/.rustup/toolchains/stable-aarch64-apple-darwin/bin:$PATH" npm run tauri dev` if cargo isn't on PATH.)

Once the main window opens, open the WebView dev console (right-click → Inspect, or `Cmd+Opt+I`) and run:

```js
const { invoke } = await import('@tauri-apps/api/core');
await invoke('open_settings_window');
```

Expected: a 460×394 transparent borderless window appears, centered, showing the "Settings window — bridge wiring pending." placeholder. Close the dev server when verified.

If you do not have a desktop available, skip Step 4 and rely on the type-check + tests passing as the gate. Note this in the task report.

---

## Task 3: Bridge protocol module + tests

**Files:**
- Create: `app/src/domain/bridge/protocol.ts`
- Create: `app/src/domain/bridge/protocol.test.ts`

- [ ] **Step 1: Write the failing test `protocol.test.ts`**

Write `app/src/domain/bridge/protocol.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
    BRIDGE_VERSION,
    EVT_DISPATCH,
    EVT_STATE,
    EVT_STATE_REQUEST,
    type BridgeSnapshot,
    type DispatchPayload,
} from './protocol';

describe('bridge protocol', () => {
    it('defines stable event names', () => {
        expect(EVT_STATE_REQUEST).toBe('app:state:request');
        expect(EVT_STATE).toBe('app:state');
        expect(EVT_DISPATCH).toBe('app:dispatch');
    });

    it('uses BRIDGE_VERSION = 1', () => {
        expect(BRIDGE_VERSION).toBe(1);
    });

    it('BridgeSnapshot accepts a fully-populated payload', () => {
        const snap: BridgeSnapshot = {
            v: 1,
            settings: { uiScale: 1.5, targetMonitorIndex: 0 },
            pomodoro: { focusDurationSeconds: 1500, breakDurationSeconds: 300, totalRounds: 4 },
            network: {
                autoConnect: false, playerName: 'me', playerId: 'p-1',
                roomCode: 'R1', status: 'idle',
                players: {}, lastError: null,
            },
            bindingKey: { entries: [], capturingId: null, syncedKeyId: null },
        };
        expect(snap.v).toBe(1);
    });

    it('DispatchPayload accepts every action shape', () => {
        const samples: DispatchPayload[] = [
            { v: 1, store: 'settings',   action: 'setUiScale',     args: [1.5] },
            { v: 1, store: 'settings',   action: 'setTargetMonitor', args: [2] },
            { v: 1, store: 'pomodoro',   action: 'applySettings',  args: [1500, 300, 4, true] },
            { v: 1, store: 'network',    action: 'createRoom',     args: ['R1'] },
            { v: 1, store: 'network',    action: 'joinRoom',       args: ['R1'] },
            { v: 1, store: 'network',    action: 'leaveRoom',      args: [] },
            { v: 1, store: 'network',    action: 'setAutoConnect', args: [true] },
            { v: 1, store: 'network',    action: 'setPlayerName',  args: ['me'] },
            { v: 1, store: 'bindingKey', action: 'beginCapture',   args: ['bk-1'] },
            { v: 1, store: 'bindingKey', action: 'removeEntry',    args: ['bk-1'] },
            { v: 1, store: 'bindingKey', action: 'setSynced',      args: [null] },
            { v: 1, store: 'bindingKey', action: 'addEntry',       args: [] },
        ];
        expect(samples).toHaveLength(12);
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```
cd app && npx vitest run src/domain/bridge/protocol.test.ts
```
Expected: FAIL with `Failed to resolve import "./protocol"`.

- [ ] **Step 3: Implement `protocol.ts`**

Write `app/src/domain/bridge/protocol.ts`:

```ts
import type { BindingKeyEntry } from '../bindingKey';
import type { ConnectionStatus, RemotePlayer } from '../network';

export const EVT_STATE_REQUEST = 'app:state:request';
export const EVT_STATE = 'app:state';
export const EVT_DISPATCH = 'app:dispatch';
export const BRIDGE_VERSION = 1 as const;

export interface BridgeSnapshot {
    v: typeof BRIDGE_VERSION;
    settings: {
        uiScale: number;
        targetMonitorIndex: number;
    };
    pomodoro: {
        focusDurationSeconds: number;
        breakDurationSeconds: number;
        totalRounds: number;
    };
    network: {
        autoConnect: boolean;
        playerName: string;
        playerId: string | null;
        roomCode: string;
        status: ConnectionStatus;
        players: Record<string, RemotePlayer>;
        lastError: string | null;
    };
    bindingKey: {
        entries: BindingKeyEntry[];
        capturingId: string | null;
        syncedKeyId: string | null;
    };
}

export type DispatchPayload =
    | { v: typeof BRIDGE_VERSION; store: 'settings';   action: 'setUiScale' | 'setTargetMonitor'; args: [number] }
    | { v: typeof BRIDGE_VERSION; store: 'pomodoro';   action: 'applySettings'; args: [number, number, number, boolean] }
    | { v: typeof BRIDGE_VERSION; store: 'network';    action: 'createRoom' | 'joinRoom'; args: [string] }
    | { v: typeof BRIDGE_VERSION; store: 'network';    action: 'leaveRoom'; args: [] }
    | { v: typeof BRIDGE_VERSION; store: 'network';    action: 'setAutoConnect'; args: [boolean] }
    | { v: typeof BRIDGE_VERSION; store: 'network';    action: 'setPlayerName'; args: [string] }
    | { v: typeof BRIDGE_VERSION; store: 'bindingKey'; action: 'beginCapture' | 'removeEntry'; args: [string] }
    | { v: typeof BRIDGE_VERSION; store: 'bindingKey'; action: 'setSynced'; args: [string | null] }
    | { v: typeof BRIDGE_VERSION; store: 'bindingKey'; action: 'addEntry'; args: [] };
```

- [ ] **Step 4: Re-run the test**

```
cd app && npx vitest run src/domain/bridge/protocol.test.ts
```
Expected: PASS (4 tests).

- [ ] **Step 5: Run full suite to confirm no regressions**

```
cd app && npm test
```
Expected: 29/29 passing (25 prior + 4 new).

---

## Task 4: Bridge dispatch helper

**Files:**
- Create: `app/src/domain/bridge/dispatch.ts`

This module is a one-liner that hides the Tauri webview API behind a typed function. No isolated unit test — its behavior is exercised by store-factory tests in Tasks 8–11.

- [ ] **Step 1: Write `dispatch.ts`**

Write `app/src/domain/bridge/dispatch.ts`:

```ts
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { EVT_DISPATCH, type DispatchPayload } from './protocol';

export async function dispatch(payload: DispatchPayload): Promise<void> {
    try {
        const w = await WebviewWindow.getByLabel('main');
        if (!w) return;
        await w.emit(EVT_DISPATCH, payload);
    } catch {
        /* swallow — settings window in non-Tauri/test env */
    }
}
```

- [ ] **Step 2: Type-check**

```
cd app && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Run full suite (no regressions)**

```
cd app && npm test
```
Expected: 29/29 passing.

---

## Task 5: Bridge host (main window)

**Files:**
- Create: `app/src/domain/bridge/host.ts`
- Create: `app/src/domain/bridge/host.test.ts`

- [ ] **Step 1: Write the failing tests**

Write `app/src/domain/bridge/host.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { applyDispatch, buildSnapshot } from './host';
import { useSettingsStore } from '../settings';
import { usePomodoroStore } from '../pomodoro';
import { useNetworkStore } from '../network';
import { useBindingKeyStore } from '../bindingKey';
import { BRIDGE_VERSION } from './protocol';

beforeEach(() => {
    useSettingsStore.setState({ uiScale: 1.0, targetMonitorIndex: 0, activeTab: 'pomodoro' });
});

describe('buildSnapshot', () => {
    it('reads from every source store and stamps the version', () => {
        useSettingsStore.setState({ uiScale: 1.5, targetMonitorIndex: 2 });
        const snap = buildSnapshot();
        expect(snap.v).toBe(BRIDGE_VERSION);
        expect(snap.settings.uiScale).toBe(1.5);
        expect(snap.settings.targetMonitorIndex).toBe(2);
        expect(snap.pomodoro.focusDurationSeconds).toBe(usePomodoroStore.getState().focusDurationSeconds);
        expect(snap.network.status).toBe(useNetworkStore.getState().status);
        expect(snap.bindingKey.entries).toBe(useBindingKeyStore.getState().entries);
    });

    it('does NOT include transient timer fields like remainingSeconds', () => {
        const snap = buildSnapshot();
        // @ts-expect-error remainingSeconds is intentionally absent from the snapshot type
        expect(snap.pomodoro.remainingSeconds).toBeUndefined();
    });
});

describe('applyDispatch', () => {
    it('routes settings/setUiScale to useSettingsStore.setUiScale', () => {
        applyDispatch({ v: BRIDGE_VERSION, store: 'settings', action: 'setUiScale', args: [1.75] });
        expect(useSettingsStore.getState().uiScale).toBe(1.75);
    });

    it('routes settings/setTargetMonitor to useSettingsStore.setTargetMonitor', () => {
        applyDispatch({ v: BRIDGE_VERSION, store: 'settings', action: 'setTargetMonitor', args: [3] });
        expect(useSettingsStore.getState().targetMonitorIndex).toBe(3);
    });

    it('ignores payloads with a mismatched bridge version', () => {
        const before = useSettingsStore.getState().uiScale;
        applyDispatch({ v: 999 as 1, store: 'settings', action: 'setUiScale', args: [2.5] });
        expect(useSettingsStore.getState().uiScale).toBe(before);
    });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```
cd app && npx vitest run src/domain/bridge/host.test.ts
```
Expected: FAIL with `Failed to resolve import "./host"`.

- [ ] **Step 3: Implement `host.ts`**

Write `app/src/domain/bridge/host.ts`:

```ts
import { useEffect } from 'react';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { useSettingsStore } from '../settings';
import { usePomodoroStore } from '../pomodoro';
import { useNetworkStore } from '../network';
import { useBindingKeyStore } from '../bindingKey';
import {
    BRIDGE_VERSION,
    EVT_DISPATCH,
    EVT_STATE,
    EVT_STATE_REQUEST,
    type BridgeSnapshot,
    type DispatchPayload,
} from './protocol';

export function buildSnapshot(): BridgeSnapshot {
    const s = useSettingsStore.getState();
    const p = usePomodoroStore.getState();
    const n = useNetworkStore.getState();
    const b = useBindingKeyStore.getState();
    return {
        v: BRIDGE_VERSION,
        settings: { uiScale: s.uiScale, targetMonitorIndex: s.targetMonitorIndex },
        pomodoro: {
            focusDurationSeconds: p.focusDurationSeconds,
            breakDurationSeconds: p.breakDurationSeconds,
            totalRounds: p.totalRounds,
        },
        network: {
            autoConnect: n.autoConnect,
            playerName: n.playerName,
            playerId: n.playerId,
            roomCode: n.roomCode,
            status: n.status,
            players: n.players,
            lastError: n.lastError,
        },
        bindingKey: {
            entries: b.entries,
            capturingId: b.capturingId,
            syncedKeyId: b.syncedKeyId,
        },
    };
}

export function applyDispatch(payload: DispatchPayload): void {
    if (payload.v !== BRIDGE_VERSION) {
        console.warn('[bridge] dispatch version mismatch:', payload.v);
        return;
    }
    switch (payload.store) {
        case 'settings': {
            const s = useSettingsStore.getState();
            if (payload.action === 'setUiScale') s.setUiScale(...payload.args);
            else if (payload.action === 'setTargetMonitor') s.setTargetMonitor(...payload.args);
            return;
        }
        case 'pomodoro': {
            if (payload.action === 'applySettings') {
                usePomodoroStore.getState().applySettings(...payload.args);
            }
            return;
        }
        case 'network': {
            const n = useNetworkStore.getState();
            switch (payload.action) {
                case 'createRoom':     void n.createRoom(...payload.args); return;
                case 'joinRoom':       void n.joinRoom(...payload.args); return;
                case 'leaveRoom':      n.leaveRoom(); return;
                case 'setAutoConnect': n.setAutoConnect(...payload.args); return;
                case 'setPlayerName':  n.setPlayerName(...payload.args); return;
            }
            return;
        }
        case 'bindingKey': {
            const b = useBindingKeyStore.getState();
            switch (payload.action) {
                case 'beginCapture': b.beginCapture(...payload.args); return;
                case 'removeEntry':  b.removeEntry(...payload.args); return;
                case 'setSynced':    b.setSynced(...payload.args); return;
                case 'addEntry':     b.addEntry(); return;
            }
            return;
        }
    }
}

async function sendSnapshot(): Promise<void> {
    try {
        const w = await WebviewWindow.getByLabel('settings');
        if (!w) return;
        await w.emit(EVT_STATE, buildSnapshot());
    } catch {
        /* swallow — settings window not open */
    }
}

function pomoSig(s: { focusDurationSeconds: number; breakDurationSeconds: number; totalRounds: number }): string {
    return `${s.focusDurationSeconds}|${s.breakDurationSeconds}|${s.totalRounds}`;
}

export function useBridgeHost(): void {
    useEffect(() => {
        const unlistens: UnlistenFn[] = [];

        listen(EVT_STATE_REQUEST, () => { void sendSnapshot(); })
            .then((u) => unlistens.push(u))
            .catch(() => {});

        listen<DispatchPayload>(EVT_DISPATCH, (e) => { applyDispatch(e.payload); })
            .then((u) => unlistens.push(u))
            .catch(() => {});

        let prevPomo = pomoSig(usePomodoroStore.getState());
        const subs: Array<() => void> = [
            useSettingsStore.subscribe(() => { void sendSnapshot(); }),
            usePomodoroStore.subscribe((s) => {
                const sig = pomoSig(s);
                if (sig === prevPomo) return;
                prevPomo = sig;
                void sendSnapshot();
            }),
            useNetworkStore.subscribe(() => { void sendSnapshot(); }),
            useBindingKeyStore.subscribe(() => { void sendSnapshot(); }),
        ];

        return () => {
            unlistens.forEach((u) => u());
            subs.forEach((u) => u());
        };
    }, []);
}
```

- [ ] **Step 4: Re-run the tests**

```
cd app && npx vitest run src/domain/bridge/host.test.ts
```
Expected: PASS (5 tests).

- [ ] **Step 5: Full suite**

```
cd app && npm test
```
Expected: 34/34 passing (29 prior + 5 new).

---

## Task 6: Bridge client (settings window) + tests

**Files:**
- Create: `app/src/domain/bridge/client.ts`
- Create: `app/src/domain/bridge/client.test.ts`

- [ ] **Step 1: Write the failing tests**

Write `app/src/domain/bridge/client.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { applySnapshotToMirrors } from './client';
import { useSettingsStore } from '../settings';
import { usePomodoroStore } from '../pomodoro';
import { useNetworkStore } from '../network';
import { useBindingKeyStore } from '../bindingKey';
import { BRIDGE_VERSION, type BridgeSnapshot } from './protocol';

const SAMPLE: BridgeSnapshot = {
    v: BRIDGE_VERSION,
    settings: { uiScale: 2.0, targetMonitorIndex: 1 },
    pomodoro: { focusDurationSeconds: 600, breakDurationSeconds: 120, totalRounds: 6 },
    network: {
        autoConnect: true, playerName: 'host', playerId: 'p-host',
        roomCode: 'R9', status: 'joined',
        players: {}, lastError: null,
    },
    bindingKey: { entries: [], capturingId: 'bk-cap', syncedKeyId: 'bk-sync' },
};

beforeEach(() => {
    useSettingsStore.setState({ uiScale: 1.0, targetMonitorIndex: 0, activeTab: 'pomodoro' });
});

describe('applySnapshotToMirrors', () => {
    it('writes every snapshot section into the corresponding store', () => {
        applySnapshotToMirrors(SAMPLE);
        expect(useSettingsStore.getState().uiScale).toBe(2.0);
        expect(useSettingsStore.getState().targetMonitorIndex).toBe(1);
        expect(usePomodoroStore.getState().focusDurationSeconds).toBe(600);
        expect(usePomodoroStore.getState().breakDurationSeconds).toBe(120);
        expect(usePomodoroStore.getState().totalRounds).toBe(6);
        expect(useNetworkStore.getState().status).toBe('joined');
        expect(useNetworkStore.getState().roomCode).toBe('R9');
        expect(useBindingKeyStore.getState().capturingId).toBe('bk-cap');
        expect(useBindingKeyStore.getState().syncedKeyId).toBe('bk-sync');
    });

    it('ignores snapshots with a mismatched bridge version', () => {
        const before = useSettingsStore.getState().uiScale;
        applySnapshotToMirrors({ ...SAMPLE, v: 999 as 1 });
        expect(useSettingsStore.getState().uiScale).toBe(before);
    });

    it('does not mutate activeTab (settings-window-local state)', () => {
        useSettingsStore.setState({ activeTab: 'global' });
        applySnapshotToMirrors(SAMPLE);
        expect(useSettingsStore.getState().activeTab).toBe('global');
    });
});
```

- [ ] **Step 2: Run to verify failure**

```
cd app && npx vitest run src/domain/bridge/client.test.ts
```
Expected: FAIL with `Failed to resolve import "./client"`.

- [ ] **Step 3: Implement `client.ts`**

Write `app/src/domain/bridge/client.ts`:

```ts
import { useEffect } from 'react';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { useSettingsStore } from '../settings';
import { usePomodoroStore } from '../pomodoro';
import { useNetworkStore } from '../network';
import { useBindingKeyStore } from '../bindingKey';
import {
    BRIDGE_VERSION,
    EVT_STATE,
    EVT_STATE_REQUEST,
    type BridgeSnapshot,
} from './protocol';

export function applySnapshotToMirrors(snap: BridgeSnapshot): void {
    if (snap.v !== BRIDGE_VERSION) {
        console.warn('[bridge] snapshot version mismatch:', snap.v);
        return;
    }
    useSettingsStore.setState({
        uiScale: snap.settings.uiScale,
        targetMonitorIndex: snap.settings.targetMonitorIndex,
    });
    usePomodoroStore.setState({
        focusDurationSeconds: snap.pomodoro.focusDurationSeconds,
        breakDurationSeconds: snap.pomodoro.breakDurationSeconds,
        totalRounds: snap.pomodoro.totalRounds,
    });
    useNetworkStore.setState({
        autoConnect: snap.network.autoConnect,
        playerName: snap.network.playerName,
        playerId: snap.network.playerId,
        roomCode: snap.network.roomCode,
        status: snap.network.status,
        players: snap.network.players,
        lastError: snap.network.lastError,
    });
    useBindingKeyStore.setState({
        entries: snap.bindingKey.entries,
        capturingId: snap.bindingKey.capturingId,
        syncedKeyId: snap.bindingKey.syncedKeyId,
    });
}

export function useBridgeClient(): void {
    useEffect(() => {
        const unlistens: UnlistenFn[] = [];

        listen<BridgeSnapshot>(EVT_STATE, (e) => { applySnapshotToMirrors(e.payload); })
            .then((u) => unlistens.push(u))
            .catch(() => {});

        WebviewWindow.getByLabel('main')
            .then((w) => w?.emit(EVT_STATE_REQUEST, {}))
            .catch(() => {});

        return () => { unlistens.forEach((u) => u()); };
    }, []);
}
```

- [ ] **Step 4: Re-run tests**

```
cd app && npx vitest run src/domain/bridge/client.test.ts
```
Expected: PASS (3 tests).

- [ ] **Step 5: Full suite**

```
cd app && npm test
```
Expected: 37/37 passing.

---

## Task 7: Shift Settings visibility from store to OS window

This task is necessarily larger than the others: removing `isOpen` from `SettingsState` ripples into the panel component, its tests, the store tests, and the close button — they all need to flip in one atomic change to keep the test suite green.

**Files:**
- Modify: `app/src/domain/settings.ts`
- Modify: `app/src/domain/settings.test.ts`
- Modify: `app/src/ui/SettingsPanel.tsx`
- Modify: `app/src/ui/SettingsPanel.css`
- Modify: `app/src/ui/SettingsPanel.test.tsx`

- [ ] **Step 1: Rewrite `app/src/domain/settings.ts`**

Replace the entire file:

```ts
import { create } from 'zustand';

export type SettingsTab = 'pomodoro' | 'online' | 'pet' | 'global';

export interface SettingsState {
    activeTab: SettingsTab;
    uiScale: number;
    targetMonitorIndex: number;
}

interface SettingsActions {
    setActiveTab: (tab: SettingsTab) => void;
    setUiScale: (scale: number) => void;
    setTargetMonitor: (index: number) => void;
}

export const MIN_SCALE = 0.5;
export const MAX_SCALE = 3.0;

export const useSettingsStore = create<SettingsState & SettingsActions>((set) => ({
    activeTab: 'pomodoro',
    uiScale: 1.0,
    targetMonitorIndex: 0,

    setActiveTab: (tab) => set({ activeTab: tab }),
    setUiScale: (scale) => set({ uiScale: Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale)) }),
    setTargetMonitor: (index) => set({ targetMonitorIndex: Math.max(0, index) }),
}));
```

Task 8 will wrap this in a `createSettingsStore({ isSettingsWindow })` factory. We keep that split for the next task to keep this one focused.

- [ ] **Step 2: Rewrite `app/src/domain/settings.test.ts`**

Replace the entire file:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useSettingsStore, MIN_SCALE, MAX_SCALE } from './settings';

beforeEach(() => {
    useSettingsStore.setState({
        activeTab: 'pomodoro',
        uiScale: 1.0,
        targetMonitorIndex: 0,
    });
});

describe('useSettingsStore', () => {
    it('setActiveTab switches the active tab', () => {
        useSettingsStore.getState().setActiveTab('global');
        expect(useSettingsStore.getState().activeTab).toBe('global');
    });

    it('setUiScale clamps below MIN_SCALE', () => {
        useSettingsStore.getState().setUiScale(0.1);
        expect(useSettingsStore.getState().uiScale).toBe(MIN_SCALE);
    });

    it('setUiScale clamps above MAX_SCALE', () => {
        useSettingsStore.getState().setUiScale(99);
        expect(useSettingsStore.getState().uiScale).toBe(MAX_SCALE);
    });

    it('setTargetMonitor never goes below 0', () => {
        useSettingsStore.getState().setTargetMonitor(-3);
        expect(useSettingsStore.getState().targetMonitorIndex).toBe(0);
    });
});
```

- [ ] **Step 3: Patch `SettingsPanel.tsx` — drop `isOpen` & close**

Open `app/src/ui/SettingsPanel.tsx`. Make these three changes:

1. Replace the imports block at the top so `invoke` is available:

```tsx
import { useState, useEffect } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { invoke } from '@tauri-apps/api/core';
import {
    useSettingsStore,
    type SettingsTab,
    MIN_SCALE,
    MAX_SCALE,
} from '../domain/settings';
import { usePomodoroStore } from '../domain/pomodoro';
import { useNetworkStore } from '../domain/network';
import { useBindingKeyStore } from '../domain/bindingKey';
import './SettingsPanel.css';
```

2. Inside `SettingsPanel()`, replace the top hooks (the `isOpen`, `close` reads and the early-return) with:

```tsx
const activeTab = useSettingsStore((s) => s.activeTab);
const setActiveTab = useSettingsStore((s) => s.setActiveTab);

const onClose = () => { void invoke('close_settings_window'); };
```

Delete the line `if (!isOpen) return null;` entirely.

3. Update the close button to call the new handler:

```tsx
<button className="settings-close" onClick={onClose} aria-label="关闭">
    <CloseIcon />
</button>
```

(Replace the existing `onClick={close}` reference.)

- [ ] **Step 4: Patch `SettingsPanel.css` — drop centering**

Open `app/src/ui/SettingsPanel.css`. In the `.settings-panel` rule, change:

```css
.settings-panel {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: 460px;
    height: 394px;
    /* ... rest of the rule unchanged ... */
}
```

to:

```css
.settings-panel {
    position: relative;
    width: 460px;
    height: 394px;
    /* ... rest of the rule unchanged ... */
}
```

(Remove `top`, `left`, `transform`. Keep all other declarations untouched.)

- [ ] **Step 5: Patch `SettingsPanel.test.tsx`**

Open `app/src/ui/SettingsPanel.test.tsx`. Apply three changes:

1. Remove every line of the form `useSettingsStore.setState({ isOpen: true, ... })` — replace those calls so they only set fields that still exist on `SettingsState` (`activeTab`, `uiScale`, `targetMonitorIndex`). For example:

   Before:
   ```ts
   useSettingsStore.setState({ isOpen: true, activeTab: 'pomodoro' });
   ```
   After:
   ```ts
   useSettingsStore.setState({ activeTab: 'pomodoro' });
   ```

2. Wherever the existing test asserted that clicking the close button calls `useSettingsStore.getState().close()`, replace it with an assertion that the close button calls `invoke('close_settings_window')`. Add at the top of the file (if not already present):

```ts
import { vi } from 'vitest';

const invokeMock = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));
```

   And in the close-button test:

```ts
it('clicking the close button invokes close_settings_window', async () => {
    invokeMock.mockClear();
    render(<SettingsPanel />);
    const closeBtn = screen.getByRole('button', { name: '关闭' });
    await act(async () => { fireEvent.click(closeBtn); });
    expect(invokeMock).toHaveBeenCalledWith('close_settings_window');
});
```

   (If the existing file already has a `vi.mock('@tauri-apps/api/core', ...)` pattern for `invoke`, reuse that one — don't double-mock.)

3. The geometry test that reads `SettingsPanel.css` and regexes `width: 460px` + `height: 394px` continues to work — the rule still contains those declarations.

- [ ] **Step 6: Run the targeted tests**

```
cd app && npx vitest run src/domain/settings.test.ts src/ui/SettingsPanel.test.tsx
```
Expected: PASS — settings.test.ts has 4 tests; SettingsPanel.test.tsx retains its prior count minus any open/close flow tests that no longer apply (the close-button test now asserts the invoke call).

- [ ] **Step 7: Full suite**

```
cd app && npm test
```
Expected: all passing, with the count = previous total minus any `isOpen`-specific tests that were dropped, plus zero new tests (this task is structural).

- [ ] **Step 8: Type-check**

```
cd app && npx tsc --noEmit
```
Expected: no errors. (`PomodoroPanel.tsx` still references `useSettingsStore.getState().open()` — Task 13 fixes that. If `tsc` errors here, the offending line needs replacement now; in that case, jump to Task 13 Step 1 and apply it.)

> **Implementer note:** `PomodoroPanel.tsx` line 74 currently reads `onClick={() => useSettingsStore.getState().open()}`. Since `open` is gone after Step 1 here, you must either (a) do Task 13 Step 1 now (replace with `invoke('open_settings_window')`) to keep tsc clean, or (b) accept tsc breakage temporarily. **Do (a).** That single edit is harmless to land here.

For convenience, the replacement is:

```tsx
import { invoke } from '@tauri-apps/api/core';
// ...
onClick={() => { void invoke('open_settings_window'); }}
```

Add the `invoke` import to `PomodoroPanel.tsx` if it's not already there, and replace the `onClick`. After this edit `npx tsc --noEmit` should pass.

---

## Task 8: `createSettingsStore` factory + settings-mode dispatcher

**Files:**
- Modify: `app/src/domain/settings.ts`
- Modify: `app/src/domain/settings.test.ts`

- [ ] **Step 1: Add the failing test for the dispatcher path**

Append to `app/src/domain/settings.test.ts`:

```ts
import { createSettingsStore } from './settings';
import * as dispatchMod from './bridge/dispatch';
import { vi } from 'vitest';

describe('createSettingsStore — settings-window mode', () => {
    it('setUiScale dispatches instead of mutating local state', async () => {
        const spy = vi.spyOn(dispatchMod, 'dispatch').mockResolvedValue();
        const store = createSettingsStore({ isSettingsWindow: true });
        const before = store.getState().uiScale;
        store.getState().setUiScale(1.75);
        expect(store.getState().uiScale).toBe(before); // not locally mutated
        expect(spy).toHaveBeenCalledWith(expect.objectContaining({
            store: 'settings', action: 'setUiScale', args: [1.75],
        }));
        spy.mockRestore();
    });

    it('setTargetMonitor dispatches instead of mutating local state', async () => {
        const spy = vi.spyOn(dispatchMod, 'dispatch').mockResolvedValue();
        const store = createSettingsStore({ isSettingsWindow: true });
        const before = store.getState().targetMonitorIndex;
        store.getState().setTargetMonitor(2);
        expect(store.getState().targetMonitorIndex).toBe(before);
        expect(spy).toHaveBeenCalledWith(expect.objectContaining({
            store: 'settings', action: 'setTargetMonitor', args: [2],
        }));
        spy.mockRestore();
    });

    it('setActiveTab is local in settings-window mode (no dispatch)', () => {
        const spy = vi.spyOn(dispatchMod, 'dispatch').mockResolvedValue();
        const store = createSettingsStore({ isSettingsWindow: true });
        store.getState().setActiveTab('global');
        expect(store.getState().activeTab).toBe('global');
        expect(spy).not.toHaveBeenCalled();
        spy.mockRestore();
    });
});
```

- [ ] **Step 2: Run — expect failure**

```
cd app && npx vitest run src/domain/settings.test.ts
```
Expected: FAIL with `createSettingsStore is not a function`.

- [ ] **Step 3: Refactor `settings.ts` to expose the factory**

Replace the file contents:

```ts
import { create, type StoreApi, type UseBoundStore } from 'zustand';
import { dispatch } from './bridge/dispatch';
import { BRIDGE_VERSION } from './bridge/protocol';

export type SettingsTab = 'pomodoro' | 'online' | 'pet' | 'global';

export interface SettingsState {
    activeTab: SettingsTab;
    uiScale: number;
    targetMonitorIndex: number;
}

interface SettingsActions {
    setActiveTab: (tab: SettingsTab) => void;
    setUiScale: (scale: number) => void;
    setTargetMonitor: (index: number) => void;
}

export const MIN_SCALE = 0.5;
export const MAX_SCALE = 3.0;

export type SettingsStore = UseBoundStore<StoreApi<SettingsState & SettingsActions>>;

export function createSettingsStore(opts: { isSettingsWindow: boolean }): SettingsStore {
    if (opts.isSettingsWindow) {
        return create<SettingsState & SettingsActions>((set) => ({
            activeTab: 'pomodoro',
            uiScale: 1.0,
            targetMonitorIndex: 0,
            setActiveTab: (tab) => set({ activeTab: tab }),
            setUiScale: (scale) => {
                void dispatch({ v: BRIDGE_VERSION, store: 'settings', action: 'setUiScale', args: [scale] });
            },
            setTargetMonitor: (index) => {
                void dispatch({ v: BRIDGE_VERSION, store: 'settings', action: 'setTargetMonitor', args: [index] });
            },
        }));
    }
    return create<SettingsState & SettingsActions>((set) => ({
        activeTab: 'pomodoro',
        uiScale: 1.0,
        targetMonitorIndex: 0,
        setActiveTab: (tab) => set({ activeTab: tab }),
        setUiScale: (scale) => set({ uiScale: Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale)) }),
        setTargetMonitor: (index) => set({ targetMonitorIndex: Math.max(0, index) }),
    }));
}

function detectIsSettingsWindow(): boolean {
    if (typeof window === 'undefined') return false;
    return new URLSearchParams(window.location.search).get('window') === 'settings';
}

export const useSettingsStore: SettingsStore = createSettingsStore({
    isSettingsWindow: detectIsSettingsWindow(),
});
```

- [ ] **Step 4: Re-run**

```
cd app && npx vitest run src/domain/settings.test.ts
```
Expected: PASS — original 4 tests plus 3 new dispatcher tests = 7.

- [ ] **Step 5: Full suite**

```
cd app && npm test
```
Expected: all passing, +3 net tests.

---

## Task 9: `createPomodoroStore` factory + settings-mode dispatcher

**Files:**
- Modify: `app/src/domain/pomodoro.ts`
- Modify: `app/src/domain/pomodoro.test.ts`

The pomodoro store is large. Only `applySettings` is invoked from the settings UI. In settings-window mode, every other action is a no-op (the settings window has no PomodoroPanel and never calls them); only `applySettings` dispatches.

- [ ] **Step 1: Add the failing test**

Append to `app/src/domain/pomodoro.test.ts`:

```ts
import { createPomodoroStore } from './pomodoro';
import * as dispatchMod from './bridge/dispatch';
import { vi } from 'vitest';

describe('createPomodoroStore — settings-window mode', () => {
    it('applySettings dispatches instead of mutating local state', () => {
        const spy = vi.spyOn(dispatchMod, 'dispatch').mockResolvedValue();
        const store = createPomodoroStore({ isSettingsWindow: true });
        const before = store.getState().focusDurationSeconds;
        store.getState().applySettings(900, 180, 5, true);
        expect(store.getState().focusDurationSeconds).toBe(before);
        expect(spy).toHaveBeenCalledWith(expect.objectContaining({
            store: 'pomodoro', action: 'applySettings', args: [900, 180, 5, true],
        }));
        spy.mockRestore();
    });
});
```

- [ ] **Step 2: Run — expect failure**

```
cd app && npx vitest run src/domain/pomodoro.test.ts
```
Expected: FAIL with `createPomodoroStore is not a function`.

- [ ] **Step 3: Refactor `pomodoro.ts`**

Wrap the existing store creation in a factory. At the top of `app/src/domain/pomodoro.ts`, add imports:

```ts
import { dispatch } from './bridge/dispatch';
import { BRIDGE_VERSION } from './bridge/protocol';
import type { StoreApi, UseBoundStore } from 'zustand';
```

Replace the existing `export const usePomodoroStore = create<...>((set, get) => { ... })` block with this structure:

```ts
export type PomodoroStore = UseBoundStore<StoreApi<PomodoroState & PomodoroActions>>;

export function createPomodoroStore(opts: { isSettingsWindow: boolean }): PomodoroStore {
    if (opts.isSettingsWindow) {
        return create<PomodoroState & PomodoroActions>(() => ({
            focusDurationSeconds: DEFAULT_FOCUS,
            breakDurationSeconds: DEFAULT_BREAK,
            totalRounds: DEFAULT_ROUNDS,
            currentRound: 1,
            remainingSeconds: DEFAULT_FOCUS,
            currentPhase: 'focus',
            isRunning: false,
            isPinned: false,
            autoStartBreak: true,
            consecutiveCompletedFocus: 0,
            start: () => {},
            pause: () => {},
            skip: () => {},
            reset: () => {},
            togglePin: () => {},
            applySettings: (focusSeconds, breakSeconds, totalRounds, resetProgress) => {
                void dispatch({
                    v: BRIDGE_VERSION,
                    store: 'pomodoro',
                    action: 'applySettings',
                    args: [focusSeconds, breakSeconds, totalRounds, resetProgress],
                });
            },
            tick: () => {},
        }));
    }
    return create<PomodoroState & PomodoroActions>((set, get) => {
        // ... the entire existing body, unchanged ...
    });
}

function detectIsSettingsWindow(): boolean {
    if (typeof window === 'undefined') return false;
    return new URLSearchParams(window.location.search).get('window') === 'settings';
}

export const usePomodoroStore: PomodoroStore = createPomodoroStore({
    isSettingsWindow: detectIsSettingsWindow(),
});
```

The block "the entire existing body, unchanged" is literally the original `create<...>((set, get) => { ... })` callback contents (including `let accumulator = 0`, `advancePhase`, the returned object). Move it verbatim into the `false` branch.

- [ ] **Step 4: Re-run pomodoro tests**

```
cd app && npx vitest run src/domain/pomodoro.test.ts
```
Expected: PASS — original tests plus 1 new test.

- [ ] **Step 5: Full suite**

```
cd app && npm test
```
Expected: all passing.

---

## Task 10: `createNetworkStore` factory + settings-mode dispatcher

**Files:**
- Modify: `app/src/domain/network.ts`
- Modify: `app/src/domain/network.test.ts`

`network.ts` is the largest store. Only 5 actions are reachable from settings UI; in settings-window mode, override only those and stub the rest as no-ops (the WebSocket lifecycle must NEVER run in the settings window).

- [ ] **Step 1: Add the failing test**

Append to `app/src/domain/network.test.ts`:

```ts
import { createNetworkStore } from './network';
import * as dispatchMod from './bridge/dispatch';
import { vi } from 'vitest';

describe('createNetworkStore — settings-window mode', () => {
    it('joinRoom dispatches instead of opening a socket', async () => {
        const spy = vi.spyOn(dispatchMod, 'dispatch').mockResolvedValue();
        const store = createNetworkStore({ isSettingsWindow: true });
        await store.getState().joinRoom('ROOM-XYZ');
        expect(spy).toHaveBeenCalledWith(expect.objectContaining({
            store: 'network', action: 'joinRoom', args: ['ROOM-XYZ'],
        }));
        // status is not advanced locally — only the dispatch fires
        expect(store.getState().status).toBe('idle');
        spy.mockRestore();
    });

    it('createRoom, leaveRoom, setAutoConnect, setPlayerName all dispatch', async () => {
        const spy = vi.spyOn(dispatchMod, 'dispatch').mockResolvedValue();
        const store = createNetworkStore({ isSettingsWindow: true });

        await store.getState().createRoom('R1');
        store.getState().leaveRoom();
        store.getState().setAutoConnect(true);
        store.getState().setPlayerName('alice');

        expect(spy).toHaveBeenCalledWith(expect.objectContaining({ store: 'network', action: 'createRoom', args: ['R1'] }));
        expect(spy).toHaveBeenCalledWith(expect.objectContaining({ store: 'network', action: 'leaveRoom', args: [] }));
        expect(spy).toHaveBeenCalledWith(expect.objectContaining({ store: 'network', action: 'setAutoConnect', args: [true] }));
        expect(spy).toHaveBeenCalledWith(expect.objectContaining({ store: 'network', action: 'setPlayerName', args: ['alice'] }));
        spy.mockRestore();
    });
});
```

- [ ] **Step 2: Run — expect failure**

```
cd app && npx vitest run src/domain/network.test.ts
```
Expected: FAIL with `createNetworkStore is not a function`.

- [ ] **Step 3: Refactor `network.ts`**

At the top of `app/src/domain/network.ts`, add imports:

```ts
import { dispatch } from './bridge/dispatch';
import { BRIDGE_VERSION } from './bridge/protocol';
import type { StoreApi, UseBoundStore } from 'zustand';
```

Find the existing `export const useNetworkStore = create<...>((set, get) => { ... })` and wrap it:

```ts
export type NetworkStore = UseBoundStore<StoreApi<NetworkStateShape & NetworkActions>>;

const INITIAL_STATE: NetworkStateShape = {
    status: 'idle',
    serverUrl: 'ws://127.0.0.1:8039',
    autoConnect: false,
    roomCode: '',
    playerName: '',
    playerId: null,
    players: {},
    lastError: null,
};

export function createNetworkStore(opts: { isSettingsWindow: boolean }): NetworkStore {
    if (opts.isSettingsWindow) {
        return create<NetworkStateShape & NetworkActions>(() => ({
            ...INITIAL_STATE,
            setServerUrl: () => {},
            setAutoConnect: (auto) => {
                void dispatch({ v: BRIDGE_VERSION, store: 'network', action: 'setAutoConnect', args: [auto] });
            },
            setPlayerName: (name) => {
                void dispatch({ v: BRIDGE_VERSION, store: 'network', action: 'setPlayerName', args: [name] });
            },
            createRoom: async (roomCode) => {
                void dispatch({ v: BRIDGE_VERSION, store: 'network', action: 'createRoom', args: [roomCode ?? ''] });
            },
            joinRoom: async (roomCode) => {
                void dispatch({ v: BRIDGE_VERSION, store: 'network', action: 'joinRoom', args: [roomCode] });
            },
            leaveRoom: () => {
                void dispatch({ v: BRIDGE_VERSION, store: 'network', action: 'leaveRoom', args: [] });
            },
            sendStateUpdate: () => {},
            disconnect: () => {},
        }));
    }
    return create<NetworkStateShape & NetworkActions>((set, get) => {
        // ... entire existing body unchanged ...
    });
}

function detectIsSettingsWindow(): boolean {
    if (typeof window === 'undefined') return false;
    return new URLSearchParams(window.location.search).get('window') === 'settings';
}

export const useNetworkStore: NetworkStore = createNetworkStore({
    isSettingsWindow: detectIsSettingsWindow(),
});
```

Replace `INITIAL_STATE` with the file's existing initial values if they differ (use the values currently written inside the original `create<...>` callback's returned object).

Use the existing original `create<...>((set, get) => { ... })` body verbatim in the `false` branch.

If the original file already defined initial-state constants outside the `create` call, reuse them — don't duplicate.

- [ ] **Step 4: Re-run network tests**

```
cd app && npx vitest run src/domain/network.test.ts
```
Expected: PASS — original tests plus 2 new tests.

- [ ] **Step 5: Full suite**

```
cd app && npm test
```
Expected: all passing.

---

## Task 11: `createBindingKeyStore` factory + settings-mode dispatcher

**Files:**
- Modify: `app/src/domain/bindingKey.ts`
- Modify: `app/src/domain/bindingKey.test.ts` (or create if it doesn't exist)

`bindingKey.ts` has 9 actions; 4 are reachable from settings UI: `addEntry`, `removeEntry`, `setSynced`, `beginCapture`.

- [ ] **Step 1: Add the failing test**

Append to `app/src/domain/bindingKey.test.ts` (create the file with `import { describe, it, expect } from 'vitest';` at the top if it doesn't yet exist):

```ts
import { createBindingKeyStore } from './bindingKey';
import * as dispatchMod from './bridge/dispatch';
import { vi } from 'vitest';
import { describe, it, expect } from 'vitest';

describe('createBindingKeyStore — settings-window mode', () => {
    it('addEntry dispatches and does not mutate local state', () => {
        const spy = vi.spyOn(dispatchMod, 'dispatch').mockResolvedValue();
        const store = createBindingKeyStore({ isSettingsWindow: true });
        const before = store.getState().entries.length;
        store.getState().addEntry();
        expect(store.getState().entries.length).toBe(before);
        expect(spy).toHaveBeenCalledWith(expect.objectContaining({
            store: 'bindingKey', action: 'addEntry', args: [],
        }));
        spy.mockRestore();
    });

    it('removeEntry, setSynced, beginCapture all dispatch', () => {
        const spy = vi.spyOn(dispatchMod, 'dispatch').mockResolvedValue();
        const store = createBindingKeyStore({ isSettingsWindow: true });
        store.getState().removeEntry('bk-1');
        store.getState().setSynced('bk-2');
        store.getState().beginCapture('bk-3');
        expect(spy).toHaveBeenCalledWith(expect.objectContaining({ store: 'bindingKey', action: 'removeEntry',  args: ['bk-1'] }));
        expect(spy).toHaveBeenCalledWith(expect.objectContaining({ store: 'bindingKey', action: 'setSynced',    args: ['bk-2'] }));
        expect(spy).toHaveBeenCalledWith(expect.objectContaining({ store: 'bindingKey', action: 'beginCapture', args: ['bk-3'] }));
        spy.mockRestore();
    });
});
```

- [ ] **Step 2: Run — expect failure**

```
cd app && npx vitest run src/domain/bindingKey.test.ts
```
Expected: FAIL with `createBindingKeyStore is not a function`.

- [ ] **Step 3: Refactor `bindingKey.ts`**

At the top of `app/src/domain/bindingKey.ts`, add imports:

```ts
import { dispatch } from './bridge/dispatch';
import { BRIDGE_VERSION } from './bridge/protocol';
import type { StoreApi, UseBoundStore } from 'zustand';
```

Find `export const useBindingKeyStore = create<...>((set, get) => ({ ... }))` and wrap:

```ts
export type BindingKeyStore = UseBoundStore<StoreApi<BindingKeyState & BindingKeyActions>>;

export function createBindingKeyStore(opts: { isSettingsWindow: boolean }): BindingKeyStore {
    if (opts.isSettingsWindow) {
        return create<BindingKeyState & BindingKeyActions>(() => ({
            entries: [],
            syncedKeyId: null,
            capturingId: null,
            addEntry: () => {
                void dispatch({ v: BRIDGE_VERSION, store: 'bindingKey', action: 'addEntry', args: [] });
                return '';
            },
            removeEntry: (id) => {
                void dispatch({ v: BRIDGE_VERSION, store: 'bindingKey', action: 'removeEntry', args: [id] });
            },
            setEnabled: () => {},
            setSynced: (id) => {
                void dispatch({ v: BRIDGE_VERSION, store: 'bindingKey', action: 'setSynced', args: [id] });
            },
            beginCapture: (id) => {
                void dispatch({ v: BRIDGE_VERSION, store: 'bindingKey', action: 'beginCapture', args: [id] });
            },
            cancelCapture: () => {},
            completeCapture: () => {},
            incrementByKeyCode: () => {},
            resetCount: () => {},
        }));
    }
    return create<BindingKeyState & BindingKeyActions>((set, get) => ({
        // ... entire existing body unchanged ...
    }));
}

function detectIsSettingsWindow(): boolean {
    if (typeof window === 'undefined') return false;
    return new URLSearchParams(window.location.search).get('window') === 'settings';
}

export const useBindingKeyStore: BindingKeyStore = createBindingKeyStore({
    isSettingsWindow: detectIsSettingsWindow(),
});
```

Use the existing original body verbatim in the `false` branch.

- [ ] **Step 4: Re-run binding-key tests**

```
cd app && npx vitest run src/domain/bindingKey.test.ts
```
Expected: PASS — any pre-existing tests + 2 new tests.

- [ ] **Step 5: Full suite**

```
cd app && npm test
```
Expected: all passing.

---

## Task 12: Wire `App.tsx` (host) and `SettingsApp.tsx` (client)

**Files:**
- Modify: `app/src/App.tsx`
- Modify: `app/src/SettingsApp.tsx`

- [ ] **Step 1: Rewrite `App.tsx`**

Replace the file:

```tsx
import { PomodoroPanel } from './ui/PomodoroPanel';
import { RemoteRoster } from './ui/RemoteRoster';
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
            <RemoteRoster />
        </div>
    );
}
```

`<SettingsPanel/>` is removed from main; the settings window renders it instead.

- [ ] **Step 2: Rewrite `SettingsApp.tsx`**

Replace the stub with the real wiring:

```tsx
import { SettingsPanel } from './ui/SettingsPanel';
import { useBridgeClient } from './domain/bridge/client';
import './styles/global.css';

export default function SettingsApp() {
    useBridgeClient();
    return <SettingsPanel />;
}
```

- [ ] **Step 3: Type-check**

```
cd app && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 4: Full suite**

```
cd app && npm test
```
Expected: all passing.

---

## Task 13: Wire the gear-icon button

**Files:**
- Modify: `app/src/ui/PomodoroPanel.tsx`

If Task 7 Step 8 already applied this edit (recommended), confirm it's still present; this task is a no-op verification.

- [ ] **Step 1: Confirm the import**

Open `app/src/ui/PomodoroPanel.tsx`. At the top, confirm:

```tsx
import { invoke } from '@tauri-apps/api/core';
```

If missing, add it.

- [ ] **Step 2: Confirm the gear-icon handler**

Find the gear `<button>` that previously called `useSettingsStore.getState().open()`. It should now read:

```tsx
<button
    className="pomo-icon-btn"
    aria-label="设置"
    title="设置"
    onClick={() => { void invoke('open_settings_window'); }}
>
    <SettingsIcon />
</button>
```

If `useSettingsStore` is no longer used anywhere in this file, remove the import.

- [ ] **Step 3: Type-check + test suite**

```
cd app && npx tsc --noEmit && npm test
```
Expected: no errors, all tests passing.

---

## Task 14: Final verification

**Files:** none modified.

- [ ] **Step 1: Run the full vitest suite**

```
cd app && npm test
```
Expected: all tests passing. Record the count.

- [ ] **Step 2: Type-check + production build**

```
cd app && npm run build
```
Expected: `tsc && vite build` finish without errors. Note the bundle size (JS / CSS) and compare loosely to prior run (~234 KB JS / ~21 KB CSS).

- [ ] **Step 3 (manual): Smoke test against the spec's manual test plan**

Run:
```
cd app && npm run tauri dev
```
(Prefix with `PATH="/Users/xpy/.rustup/toolchains/stable-aarch64-apple-darwin/bin:$PATH"` if cargo isn't on PATH.)

Walk through each item from spec §"Test Plan / Manual":

  6. Main window opens. No second window visible at launch. ✓
  7. Click gear → settings window appears centered (~460 × 394 transparent borderless); Pomodoro stays put. ✓
  8. Drag settings header → settings moves; Pomodoro untouched. ✓
  9. Drag Pomodoro header → Pomodoro moves; settings untouched. ✓
  10. Settings → Global tab → drag scale slider → main window's `.app-root` CSS scale updates live. ✓
  11. Settings → Online tab → type a room code, click 加入房间 → join state advances (visible in main window's RemoteRoster and settings window's OnlineTab). ✓
  12. Close settings via X → window hides; click gear again → re-appears centered, activeTab preserved. ✓
  13. Quit app → both windows close cleanly; no orphan processes (verify `ps | grep app` is clean). ✓

If any item fails, file it as a follow-up task; do NOT silently mark complete.

- [ ] **Step 4: Reporting**

Report counts (tests passed, bundle size) and pass/fail of each manual smoke item.

---

## Self-Review Notes

- **Spec coverage:** Every section/requirement in the spec maps to a task:
  - Window plumbing (spec §"Part 1 — Window plumbing") → Tasks 1, 2.
  - Bridge module (spec §"Part 2 — Bridge module") → Tasks 3–6.
  - Window-vs-panel rendering / CSS / close button (spec §"Part 3") → Task 7 (CSS + close), Task 12 (mount).
  - Drop `isOpen` from `SettingsState` → Task 7 Step 1–2.
  - Store factory split → Tasks 8–11.
  - Gear-icon `invoke('open_settings_window')` → Task 7 Step 8 / Task 13.
  - Test plan items 1–5 (automated) → Tasks 3, 5, 6, 7, 8–11.
  - Test plan items 6–13 (manual) → Task 14 Step 3.

- **Placeholder scan:** Two "the entire existing body, unchanged" markers appear inside the factory refactors (Tasks 9, 10, 11). These reference the *file's current content at the time of implementation*, which is unambiguous — the implementer literally moves the existing `create<...>((set, get) => { ... })` callback contents into the `false` branch. No design decisions deferred.

- **Type consistency:** `BridgeSnapshot`, `DispatchPayload`, `BRIDGE_VERSION`, factory function names (`createSettingsStore`, `createPomodoroStore`, `createNetworkStore`, `createBindingKeyStore`), Tauri command names (`open_settings_window`, `close_settings_window`), and event names (`app:state:request`, `app:state`, `app:dispatch`) are used identically across every task that references them.

- **Test gate model:** This repo has no git. Each task's "Step N: Commit" is replaced by a test/typecheck gate. The same discipline applies — do not advance to the next task until the gate is green.
