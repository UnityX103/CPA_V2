# Settings Panel — Dedicated Tauri Window & Pixel-Perfect Parity with `vnYnS`

Date: 2026-05-15 (revised)
Status: Approved, ready for implementation plan
Pencil source-of-truth: `AUI/PUI.pen` node `vnYnS` (Unified Settings Panel)

> **Revision note (2026-05-15):** The earlier revision of this spec placed the Settings panel in the main window and dragged the whole OS window. The user explicitly chose the previously-deferred alternative: give Settings its own Tauri window so it can be moved independently of the Pomodoro. This document supersedes that approach. Part 2 (pixel-perfect tab content) is unchanged in intent — it has already landed and only needs minor re-homing into the new window.

## Background

Two coupled problems on the Settings panel:

1. **Drag scope.** The shipped solution drags the OS window (`getCurrentWindow().startDragging()`), which moves the Pomodoro along for the ride. The user wants Settings to move independently — i.e., a second OS window.
2. **Pixel parity.** Tab content was rebuilt against Pencil sub-panels `gs1Tv` / `8Le5R` / `v2ZgA` / `Pdj9C`. That work is already in the codebase and only needs to render inside the new window.

## Goals

- A dedicated Tauri window `settings` (label `settings`) renders the Settings panel and can be moved anywhere on screen, independently of the main window.
- The Settings window is created lazily on first open, then hidden/shown on subsequent toggles (no destroy/recreate cost after first show).
- The Settings window is exactly 460 × 394 (matches Pencil `vnYnS`); the panel fills the window edge-to-edge with no inner positioning fudge.
- The settings webview consumes the same React component code and the same store APIs the main window uses (`useSettingsStore`, `usePomodoroStore`, `useNetworkStore`, `useBindingKeyStore`) by wiring those stores to a Tauri-event bridge instead of running domain logic locally. Component bodies do not change.
- Tauri capability surface stays minimal; the settings window inherits the same restricted permission set as `main`.
- Existing 25/25 vitest suite keeps passing after the migration; new tests cover the bridge dispatch + state-merge paths.

## Non-Goals

- Multi-monitor placement memory (always center on display containing main window for now).
- Window-state persistence (re-center on every fresh boot is acceptable).
- Independent rendering of the Pomodoro panel in another window.
- Replacing zustand. The settings window keeps using zustand; only the action implementations differ between windows.
- Restoring `总轮次` / `休息自动开始` UI elsewhere (still gated on the design adding them).

## Why this approach is the costlier path

For honesty: this is the option flagged "not recommended" in the original design. Costs we are accepting:

- **A second IPC surface.** Every store action consumed by the Settings panel now travels through Tauri events. That's wiring, debug surface, and a new failure mode (events lost, ordering, reconnect after reload).
- **Two webview processes.** Slightly higher memory footprint; macOS will spin up a second WKWebView host the first time the user opens settings.
- **State drift risk.** Source of truth lives in main window's zustand stores. Any new field a future feature adds must be re-listed in the bridge snapshot, or the settings window will silently render stale data.
- **Capabilities widening.** The capability file's `windows` array grows from `["main"]` to `["main", "settings"]`, and any future capability split must consider both.

The user has accepted these costs in exchange for independent drag of the two panels.

## Architecture overview

```
┌─────────────────────────── Tauri process ─────────────────────────────┐
│                                                                       │
│  WebviewWindow "main"                  WebviewWindow "settings"       │
│  ┌──────────────────────────┐          ┌────────────────────────────┐ │
│  │ React: App.tsx           │          │ React: SettingsApp.tsx     │ │
│  │  • PomodoroPanel         │          │  • SettingsPanel           │ │
│  │  • RemoteRoster          │          │  • <BridgeClient/>         │ │
│  │  • <BridgeHost/>         │          │                            │ │
│  │                          │          │ Zustand mirror stores:     │ │
│  │ Zustand source stores:   │          │  • settings (uiScale,      │ │
│  │  • pomodoro              │          │    targetMonitor,          │ │
│  │  • network               │          │    activeTab — local)      │ │
│  │  • bindingKey            │          │  • pomodoroMirror          │ │
│  │  • settings              │          │  • networkMirror           │ │
│  │  • activeApp             │          │  • bindingKeyMirror        │ │
│  └──────────────────────────┘          └────────────────────────────┘ │
│         │  ▲                                  │  ▲                    │
│         │  │  app:dispatch (settings→main)    │  │                    │
│         │  ├──────────────────────────────────┤  │                    │
│         │  │  app:state    (main→settings)    │  │                    │
│         ▼  │  app:state:request (settings→main, on bridge mount)      │
│                                                                       │
│  Rust (lib.rs):                                                       │
│   • #[tauri::command] open_settings_window  → lazy create / show      │
│   • #[tauri::command] close_settings_window → hide                    │
└───────────────────────────────────────────────────────────────────────┘
```

Three IPC channels, all routed window-to-window via point-to-point `WebviewWindow#emit` (JS API: `WebviewWindow.getByLabel('<label>')?.emit(event, payload)` from `@tauri-apps/api/webviewWindow`). Point-to-point (not the global `emit`) avoids the sender hearing its own event and prevents accidental feedback loops. No Rust state involved:

| Event             | Direction          | Payload                                                 |
| ----------------- | ------------------ | ------------------------------------------------------- |
| `app:state:request` | settings → main  | `{}`                                                     |
| `app:state`         | main → settings  | `{ settings, pomodoro, network, bindingKey }` (snapshot) |
| `app:dispatch`      | settings → main  | `{ store, action, args }`                                |

Two Tauri commands:

| Command                  | Effect                                                                                                                        |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `open_settings_window`   | If window exists → `show()` + `set_focus()`. Otherwise build it via `WebviewWindowBuilder`, center, show, focus.                |
| `close_settings_window`  | `if let Some(w) = ... { w.hide(); }`. Called from Settings close button via `invoke(...)` (or settings webview can call `getCurrentWindow().hide()` directly — see Trade-offs). |

## Design

### Part 1 — Window plumbing

**`tauri.conf.json`** — leave the `windows: [...]` array alone. The settings window is built programmatically (not declared in config), because declaring it would make it visible at app launch. (Tauri's `visible: false` declarative flag works, but lazy build keeps the cold-start path identical to today.)

**`app/src-tauri/capabilities/default.json`**

```diff
-  "windows": ["main"],
+  "windows": ["main", "settings"],
```

No new permissions: the settings window only needs `core:window:default` (for `startDragging`, `hide`) and `core:event:default` (for the bridge). Both are already listed.

**`app/src-tauri/src/lib.rs`** — add two commands and register them:

```rust
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

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

Register in `invoke_handler![ set_click_through, set_always_on_top, get_active_app, open_settings_window, close_settings_window ]`.

**`app/src/main.tsx`** — route on `?window=` query param:

```tsx
import App from './App';
import SettingsApp from './SettingsApp';
import './styles/global.css';

const params = new URLSearchParams(window.location.search);
const which = params.get('window');
const Root = which === 'settings' ? SettingsApp : App;
ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
        <Root />
    </React.StrictMode>,
);
```

**`app/src/SettingsApp.tsx`** — new file:

```tsx
import { SettingsPanel } from './ui/SettingsPanel';
import { useBridgeClient } from './domain/bridge/client';

export default function SettingsApp() {
    useBridgeClient();           // hydrates mirror stores + subscribes to app:state
    return <SettingsPanel />;
}
```

**`app/src/App.tsx`** — no longer renders `<SettingsPanel />`; mounts the host bridge:

```tsx
import { useBridgeHost } from './domain/bridge/host';
// ...
export default function App() {
    useStateSync();
    useActiveAppListener();
    useBindingKeyListener();
    useBridgeHost();             // listens for settings webview, broadcasts app:state
    return (
        <div className="app-root">
            <PomodoroPanel />
            <RemoteRoster />
        </div>
    );
}
```

**Gear icon in `PomodoroPanel.tsx`** — replace the local `open()` call:

```tsx
onClick={() => { void invoke('open_settings_window'); }}
```

### Part 2 — Bridge module

A single module `app/src/domain/bridge/` owns the event protocol.

**`bridge/protocol.ts`** — wire definitions, single import target for both ends:

```ts
export const EVT_STATE_REQUEST = 'app:state:request';
export const EVT_STATE         = 'app:state';
export const EVT_DISPATCH      = 'app:dispatch';
export const BRIDGE_VERSION    = 1;

export type BridgeSnapshot = {
    v: typeof BRIDGE_VERSION;
    settings: { uiScale: number; targetMonitorIndex: number };
    pomodoro: { focusDurationSeconds: number; breakDurationSeconds: number; totalRounds: number };
    network: {
        autoConnect: boolean; playerName: string; playerId: string;
        roomCode: string; status: NetStatus;
        players: Record<string, RemotePlayer>; lastError: string | null;
    };
    bindingKey: { entries: BindingKeyEntry[]; capturingId: string | null; syncedKeyId: string | null };
};

export type DispatchPayload =
    | { store: 'settings';   action: 'setUiScale' | 'setTargetMonitor'; args: [number] }
    | { store: 'pomodoro';   action: 'applySettings'; args: [number, number, number, boolean] }
    | { store: 'network';    action: 'createRoom' | 'joinRoom'; args: [string] }
    | { store: 'network';    action: 'leaveRoom'; args: [] }
    | { store: 'network';    action: 'setAutoConnect'; args: [boolean] }
    | { store: 'network';    action: 'setPlayerName'; args: [string] }
    | { store: 'bindingKey'; action: 'beginCapture' | 'removeEntry'; args: [string] }
    | { store: 'bindingKey'; action: 'setSynced'; args: [string | null] }
    | { store: 'bindingKey'; action: 'addEntry'; args: [] };
```

Mismatched `v` is rejected and a warning is logged (no auto-upgrade).

**`bridge/host.ts`** — runs in main window:

```ts
export function useBridgeHost() {
    useEffect(() => {
        const unlistens: UnlistenFn[] = [];

        const sendSnapshot = () => {
            const w = getWebviewWindow('settings');     // returns undefined if not open yet
            if (!w) return;
            w.emit(EVT_STATE, buildSnapshot()).catch(() => {});
        };

        const buildSnapshot = (): BridgeSnapshot => ({
            v: BRIDGE_VERSION,
            settings: pick(useSettingsStore.getState(), ['uiScale', 'targetMonitorIndex']),
            pomodoro: pick(usePomodoroStore.getState(), ['focusDurationSeconds', 'breakDurationSeconds', 'totalRounds']),
            network:  pick(useNetworkStore.getState(),  ['autoConnect', 'playerName', 'playerId', 'roomCode', 'status', 'players', 'lastError']),
            bindingKey: pick(useBindingKeyStore.getState(), ['entries', 'capturingId', 'syncedKeyId']),
        });

        // Reply to mount-time hydrate
        listen(EVT_STATE_REQUEST, sendSnapshot).then((u) => unlistens.push(u));

        // Handle dispatched actions from settings window
        listen<DispatchPayload>(EVT_DISPATCH, (e) => applyDispatch(e.payload)).then((u) => unlistens.push(u));

        // Re-broadcast on store changes (subscribe to each source store; debounce/coalesce per microtask)
        const subs = [
            useSettingsStore.subscribe(sendSnapshot),
            usePomodoroStore.subscribe(sendSnapshotIfDurationsChanged),  // see below
            useNetworkStore.subscribe(sendSnapshot),
            useBindingKeyStore.subscribe(sendSnapshot),
        ];

        return () => { unlistens.forEach((u) => u()); subs.forEach((u) => u()); };
    }, []);
}
```

`sendSnapshotIfDurationsChanged` filters out the `tick`-driven `remainingSeconds` updates so we don't flood the settings window at 60 FPS. Concretely it diffs the three pomodoro fields the snapshot exposes.

`applyDispatch` is a switch over `{ store, action }` that calls the matching action on the canonical zustand store with `args` spread.

**`bridge/client.ts`** — runs in settings window:

```ts
export function useBridgeClient() {
    useEffect(() => {
        const unlistens: UnlistenFn[] = [];

        listen<BridgeSnapshot>(EVT_STATE, (e) => {
            if (e.payload.v !== BRIDGE_VERSION) { console.warn('bridge version mismatch'); return; }
            applySnapshotToMirrors(e.payload);
        }).then((u) => unlistens.push(u));

        // Kick the host to send us the current state.
        getWebviewWindow('main')?.emit(EVT_STATE_REQUEST, {}).catch(() => {});

        return () => { unlistens.forEach((u) => u()); };
    }, []);
}
```

**Mirror stores**: in the settings window, `useSettingsStore` / `usePomodoroStore` / `useNetworkStore` / `useBindingKeyStore` are still the same TypeScript symbols (so the component code is unchanged) — but their *creation factory* detects `window.location.search.includes('window=settings')` and substitutes the actions with thin dispatchers:

```ts
// inside settings.ts
const isSettingsWindow = typeof window !== 'undefined'
    && new URLSearchParams(window.location.search).get('window') === 'settings';

export const useSettingsStore = create<SettingsState & SettingsActions>((set) => {
    const base = { isOpen: true /* always-on in this window */, activeTab: 'pomodoro' as SettingsTab,
                   uiScale: 1.0, targetMonitorIndex: 0 };
    if (isSettingsWindow) {
        return {
            ...base,
            open: () => {},                              // no-op in settings window
            close: () => { void invoke('close_settings_window'); },
            setActiveTab: (tab) => set({ activeTab: tab }),  // local: tab is settings-window UI state
            setUiScale: (scale) => dispatch({ store: 'settings', action: 'setUiScale',     args: [scale] }),
            setTargetMonitor: (i) => dispatch({ store: 'settings', action: 'setTargetMonitor', args: [i] }),
        };
    }
    // main window: existing behavior unchanged
    return { ...base, /* original actions */ };
});
```

`dispatch(payload)` is a tiny helper that does `getWebviewWindow('main')?.emit(EVT_DISPATCH, payload)`.

The same pattern applies to `pomodoro.ts`, `network.ts`, `bindingKey.ts`. State fields in the settings window are overwritten by `applySnapshotToMirrors` on every `app:state` arrival; actions go through `dispatch`.

**`activeTab` is local to the settings window.** It controls which sub-tab is visible — no reason to ship that across IPC. The main window doesn't need it; `isOpen` doesn't exist there anymore (the OS window's visibility *is* the open state).

### Part 3 — Window-vs-panel rendering

The Settings window is exactly 460 × 394 with `transparent: true`, `decorations: false`. The HTML/CSS needs to fill that exactly:

**`app/src/SettingsApp.tsx`** mounts only `<SettingsPanel />` — no surrounding chrome.

**`app/src/ui/SettingsPanel.css`** — adjust the outer rule (Phase 1 of the prior design used `position: fixed; transform: translate(-50%, -50%);` to center within the main window):

```diff
 .settings-panel {
-    position: fixed;
-    top: 50%;
-    left: 50%;
-    transform: translate(-50%, -50%);
+    position: relative;
     width: 460px;
     height: 394px;
     /* ... rest unchanged ... */
 }
```

The geometry-guard test (CSS-text regex for `width: 460px` and `height: 394px` on `.settings-panel`) still passes.

**Drag**: `.settings-head` keeps `-webkit-app-region: drag` and `.settings-close` keeps `no-drag`. Plus the existing `onPointerDown → getCurrentWindow().startDragging()` fallback. Each window drags itself — Pomodoro stays put when Settings moves.

**Close button**: change handler from `useSettingsStore.getState().close()` (no longer a thing in settings window) to `void invoke('close_settings_window')`. (We could call `getCurrentWindow().hide()` from JS — both work — but routing through Rust keeps the lifecycle command surface centralized; see Trade-offs.)

## Data flow examples

**Initial open:**
1. User clicks gear in main window → `invoke('open_settings_window')`.
2. Rust builds the window (first time) or `show()` + `set_focus()` (subsequent times).
3. Settings window's React mounts → `useBridgeClient` fires `app:state:request` to main.
4. Main's `useBridgeHost` listener replies with `app:state` snapshot.
5. Settings window's mirror stores load with focus duration, network state, etc.; `<SettingsPanel />` renders correctly hydrated.

**Edit uiScale:**
1. User drags slider in Global tab → `settings.setUiScale(1.5)` (settings window).
2. Mirror dispatcher emits `app:dispatch` `{ store:'settings', action:'setUiScale', args:[1.5] }`.
3. Main's `applyDispatch` calls `useSettingsStore.getState().setUiScale(1.5)` → state changes.
4. `useBridgeHost`'s subscription fires `sendSnapshot()` → main emits `app:state`.
5. Settings window receives, mirror updates, slider re-renders at 1.5×.
6. Main window's `useStateSync` consumes `uiScale` change as it always did (CSS transform applied to `.app-root`).

**Join room:**
1. User clicks "加入房间" in Online tab → `net.joinRoom(code)` (mirror dispatcher).
2. `app:dispatch` `{ store:'network', action:'joinRoom', args:[code] }` → main applies → WS connection state advances (`connecting` → `joined`).
3. Each store transition emits a fresh `app:state`; the busy overlay in OnlineTab reflects each step.

**App quit:**
1. Tauri's default behavior: closing main window or quitting closes all windows.
2. `RunEvent::ExitRequested|Exit` already toggles the AtomicBool stop flags — unchanged.

## Trade-offs

- **`close_settings_window` command vs. `getCurrentWindow().hide()`.** We chose the explicit command for symmetry with `open_settings_window` and to keep all settings-window lifecycle in one place in `lib.rs`. The cost is one extra IPC call. Direct `hide()` would skip the round-trip but split the lifecycle into two homes (Rust open, JS close). Accept the round-trip.
- **Polling vs. subscription bridge.** Subscribing to all four source stores in `useBridgeHost` is the right shape but means we emit on `tick` updates too. Mitigation: the snapshot only includes fields used by Settings; `usePomodoroStore.subscribe` filters out unchanged snapshots. If profiling shows this is still hot, we can throttle to `requestAnimationFrame`.
- **No persistence of window position.** Closing & re-opening always re-centers. The user has not asked for memory; YAGNI until they do.
- **Single capability file with two windows.** Cleaner would be a dedicated `capabilities/settings.json` with a stricter set (drop `core:window:allow-start-dragging` is *not* applicable — settings needs it for header drag). Since both windows currently want the exact same permission set, one file with both labels is simpler. Revisit if the surfaces diverge.
- **Lost ability for E2E test of "open settings via store action."** `useSettingsStore.open()` is now either invoke-only (main) or a no-op (settings window). Tests that toggled `isOpen` to render the panel must instead just render `<SettingsPanel />` directly. This is a test refactor, not a feature loss.

## Files Touched

- `app/src-tauri/src/lib.rs` — add `open_settings_window`, `close_settings_window`, register handlers.
- `app/src-tauri/capabilities/default.json` — `windows: ["main", "settings"]`.
- `app/src/main.tsx` — route on `?window=settings` query.
- `app/src/App.tsx` — drop `<SettingsPanel />` mount; add `useBridgeHost`.
- `app/src/SettingsApp.tsx` — **new** — settings-window root.
- `app/src/ui/PomodoroPanel.tsx` — gear icon `onClick` switches to `invoke('open_settings_window')`.
- `app/src/ui/SettingsPanel.tsx` — close button switches to `invoke('close_settings_window')`; remove `isOpen` early-return (panel always renders when mounted).
- `app/src/ui/SettingsPanel.css` — drop centering transform; `position: relative` (panel fills its window).
- `app/src/domain/bridge/protocol.ts` — **new**.
- `app/src/domain/bridge/host.ts` — **new**.
- `app/src/domain/bridge/client.ts` — **new**.
- `app/src/domain/bridge/dispatch.ts` — **new** — settings-side `dispatch(payload)` helper.
- `app/src/domain/settings.ts` — split factory: source actions for main window, dispatch-based for settings window. **Drop `isOpen` from `SettingsState`** — visibility is now owned by the OS window, not state. `open()` / `close()` actions are removed from the type; the gear icon calls `invoke('open_settings_window')` directly. `SettingsPanel.tsx` no longer reads `isOpen` and no longer early-returns.
- `app/src/domain/pomodoro.ts` — same split factory pattern for `applySettings`.
- `app/src/domain/network.ts` — same split for `createRoom`, `joinRoom`, `leaveRoom`, `setAutoConnect`, `setPlayerName`.
- `app/src/domain/bindingKey.ts` — same split for `addEntry`, `removeEntry`, `setSynced`, `beginCapture`.
- `app/src/domain/settings.test.ts` — drop `isOpen` flow tests; keep `setUiScale` / `setTargetMonitor` / `setActiveTab` clamping tests.
- `app/src/ui/SettingsPanel.test.tsx` — remove `useSettingsStore.setState({ isOpen: true })` priming (panel renders unconditionally); change close-button assertion from `close()` call to `invoke('close_settings_window')`; geometry + drag tests unchanged.
- `app/src/domain/bridge/protocol.test.ts` — **new** — dispatch envelope shape, version-mismatch handling.
- `app/src/domain/bridge/host.test.ts` — **new** — `applyDispatch` routes to the right store action; `buildSnapshot` shape stable.

## Test Plan

Client-side (vitest + jsdom):

1. `bridge/protocol.test.ts` — dispatch envelope encodes & decodes round-trip; version mismatch logs and is dropped.
2. `bridge/host.test.ts` — `applyDispatch({ store:'settings', action:'setUiScale', args:[1.5] })` flips `useSettingsStore` state; `buildSnapshot()` includes all spec'd fields, no `remainingSeconds`.
3. `settings.test.ts` — `setUiScale` / `setTargetMonitor` / `setActiveTab` / clamping still pass (in main-window mode; that's the default jsdom URL).
4. `SettingsPanel.test.tsx` — drag (mocked `startDragging`), close (mocked `invoke('close_settings_window')`), geometry CSS-text, four tab-parity tests — all unchanged in structure.
5. Existing `pomodoro.test.ts` / `network.test.ts` / `stateSync.test.ts` — pass unchanged.

Manual:

6. `npm run tauri dev` → main window opens. No second window visible.
7. Click gear → settings window appears centered; Pomodoro stays put.
8. Drag settings header → settings moves; Pomodoro untouched.
9. Drag Pomodoro header → Pomodoro moves; settings untouched.
10. In settings, click Global tab, drag slider → main window's app-root CSS scale updates live.
11. In settings, Online tab, type a room code and click 加入房间 → join state advances in both windows simultaneously.
12. Close settings via X → window hides; click gear again → re-appears centered, with the same `activeTab`.
13. Quit app → both windows close cleanly; no orphan processes.

## Out of Scope / Future Work

- Persisting settings-window position & last-active tab across launches.
- A stricter dedicated capability file for `settings` if its permission surface ever diverges from `main`.
- Throttling the host→client snapshot stream to rAF if profiling shows pressure.
- Native macOS sheet attachment to main window (would couple windows visually; user explicitly rejected coupling).
- Splitting `index.html` into `index.html` + `settings.html` (two Vite entries) — revisit if main bundle starts loading settings code unnecessarily.
