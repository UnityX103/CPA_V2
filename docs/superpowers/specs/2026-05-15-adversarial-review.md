# 1. Protocol safety / DoS
[Severity: med] `Server/src/index.js:191-194` converts any raw WebSocket payload to text and JSON-parses it before a byte cap. `Server/src/protocol.js:228-241` and `Server/src/RoomManager.js:305-323` only validate `pomodoro`/`bindingKey`; `activeApp` is pass-through, then rendered at `app/src/ui/PlayerCard.tsx:27,49`. Rate limiting exists only for state broadcasts (`Server/src/RoomManager.js:8-9,153-164`). Icon cache has a 1 MiB cap (`Server/src/IconCache.js:15-16,40-42`) but only after JSON parse and before broadcast (`Server/src/index.js:353-374`).

Reproduction: join a room, send `player_state_update` with a multi-MB JSON body or huge `state.activeApp.name`; peers receive and render it. Crash not reproduced, but memory/UI DoS is.

Fix: set `ws` `maxPayload`, reject raw messages above cap before `JSON.parse`, schema-validate `activeApp`, cap string lengths, and rate-limit all message types.

# 2. WebSocket reconnect race
[Severity: med] `ensureSocket` reuses only `OPEN` sockets (`app/src/domain/network.ts:141-150`), so two `joinRoom` calls before `onopen` create duplicate sockets. Stale callbacks can mutate global state: `onopen` starts ping (`153-159`), `onerror` sets error (`161`), and `onclose` nulls `internal.socket` and schedules reconnect (`162-178`) without proving the callback belongs to the current socket. The exact “leave during 5s reconnect starts new connection” path is NOT REPRODUCED because `leaveRoom` blanks `roomCode` (`211-214`), and the timer reads current `roomCode` (`171-177`).

Reproduction: double-click Join at `app/src/ui/SettingsPanel.tsx:141-144` while status is `connecting`; observe two WebSockets and whichever closes last controls store state.

Fix:
```diff
--- a/app/src/domain/network.ts
+++ b/app/src/domain/network.ts
@@
-    socket: WebSocket | null;
+    socket: WebSocket | null;
+    generation: number;
@@
-const internal: NetworkInternal = { socket: null, reconnectTimer: null, pingTimer: null };
+const internal: NetworkInternal = { socket: null, reconnectTimer: null, pingTimer: null, generation: 0 };
@@
-            if (internal.socket && internal.socket.readyState === WebSocket.OPEN) {
+            if (internal.socket && [WebSocket.OPEN, WebSocket.CONNECTING].includes(internal.socket.readyState)) {
                 resolve(internal.socket);
                 return;
             }
@@
-                const socket = new WebSocket(url);
+                const generation = ++internal.generation;
+                const socket = new WebSocket(url);
@@
-                    if (internal.pingTimer != null) clearInterval(internal.pingTimer);
+                    if (generation !== internal.generation) { socket.close(); return; }
+                    if (internal.pingTimer != null) clearInterval(internal.pingTimer);
@@
-                    internal.socket = null;
+                    if (generation !== internal.generation) return;
+                    internal.socket = null;
@@
         leaveRoom: () => {
+            clearTimers();
             send(internal.socket, { type: 'leave_room' });
+            internal.socket?.close();
+            internal.socket = null;
```

# 3. State-sync leak
[Severity: med] `lastSent` is module-level (`app/src/domain/stateSync.ts:26`) and dedupes only by payload (`33-36`). After leaving (`app/src/domain/network.ts:211-214`) and joining another room with unchanged local state, the first state push is skipped until local state changes or payload differs. React StrictMode mounts `App` under `React.StrictMode` (`app/src/main.tsx:6-9`), but cleanup clears the interval (`stateSync.ts:51-54`), so duplicate interval is NOT REPRODUCED. The 5s heartbeat does not conflict with phase pushes: phase changes send immediately (`39-46`) and the interval dedupes (`49-50`).

Reproduction: join, send state, leave, join a new room with unchanged pomodoro/active app; remote snapshot has `state:null`.

Fix:
```diff
--- a/app/src/domain/stateSync.ts
+++ b/app/src/domain/stateSync.ts
@@
-            const key = JSON.stringify(state);
+            const net = useNetworkStore.getState();
+            const key = `${net.roomCode}:${net.playerId}:${JSON.stringify(state)}`;
```
Also reset `lastSent` on `room_joined`/`room_created` or when status leaves `joined`.

# 4. Tauri capabilities too broad
[Severity: high] The main window unconditionally gets `core:window:allow-set-always-on-top`, `allow-set-ignore-cursor-events`, position/size, opener, and store (`app/src-tauri/capabilities/default.json:5-15`). CSP is disabled (`app/src-tauri/tauri.conf.json:31-32`). An XSS in `main` can therefore make an always-on-top click-through window, move/resize it, open URLs, or touch store without going through Rust validation. Rust commands already exist for narrower window APIs (`app/src-tauri/src/lib.rs:6-13`).

Reproduction: inject script into the main webview and call Tauri window APIs.

Fix:
```diff
--- a/app/src-tauri/capabilities/default.json
+++ b/app/src-tauri/capabilities/default.json
@@
-    "core:window:allow-set-always-on-top",
-    "core:window:allow-set-ignore-cursor-events",
-    "core:window:allow-set-position",
-    "core:window:allow-set-size",
-    "opener:default",
-    "store:default"
+    "core:window:allow-start-dragging"
```
Gate privileged actions behind `tauri::command` allowlists and restore CSP.

# 5. macOS transparent window trap
[Severity: low] Confirmed transparent, decorationless, always-on-top config: `transparent:true`, `decorations:false`, `alwaysOnTop:true` (`app/src-tauri/tauri.conf.json:21-23`). Production inconsistency is NOT REPRODUCED: build config is shared and setup also forces topmost (`app/src-tauri/src/lib.rs:27-29`). No visible-on-all-workspaces/Mission Control behavior is configured in the app config (`tauri.conf.json:12-35`) despite the design requiring transparent desktop-pet behavior (`docs/superpowers/specs/2026-05-15-cpa-tauri-rewrite-design.md:20`).

Reproduction: launch on macOS, enter Mission Control or switch Spaces; window behavior is left to defaults.

Fix: explicitly set/document macOS Spaces collection behavior via a Rust window command or remove the always-on-top default until UX controls exist.

# 6. Rust 1Hz poll thread safety
[Severity: med] A background thread loops forever (`app/src-tauri/src/lib.rs:30-46`) and calls `active_app::current_active_app()` (`35`). That function calls `NSWorkspace::sharedWorkspace().frontmostApplication()` (`app/src-tauri/src/active_app.rs:11-13`). There is no shutdown flag or app-exit condition. A process hang on close is NOT REPRODUCED from this code alone, but off-main AppKit access plus unbounded polling is a real risk.

Reproduction: start app, close the main window; thread has no condition that observes app shutdown and may keep emitting to `AppHandle` (`lib.rs:41-45`).

Fix: move polling to a main-thread-safe Tauri event/timer path or add `Arc<AtomicBool>` stopped from app exit and avoid AppKit calls off main.

# 7. Pomodoro state-machine bug
[Severity: low] `advancePhase` preserves `accumulator` when focus ends and `autoStartBreak` is true (`app/src/domain/pomodoro.ts:35-43`). `tick` subtracts one second then returns immediately after phase change (`126-139`). With `focusDurationSeconds=1`, `autoStartBreak=true`, and a real `requestAnimationFrame` delta over 1s (`app/src/ui/PomodoroPanel.tsx:29-36`), residue carries into break, so the first displayed break second can last less than one real second.

Reproduction: set focus to 1s, start, simulate `tick(1.2)`, then `tick(0.8)`; break drops from 60 to 59 after only 0.8s in break.

Fix:
```diff
--- a/app/src/domain/pomodoro.ts
+++ b/app/src/domain/pomodoro.ts
@@
-            accumulator = state.autoStartBreak ? accumulator : 0;
+            accumulator = 0;
```

# 8. Single-node server state
[Severity: low] `RoomManager` stores rooms only in `_rooms = new Map()` (`Server/src/RoomManager.js:24-31`) and each server creates a new manager by default (`Server/src/index.js:40`). Empty rooms expire via local timers (`RoomManager.js:245-264`). Multi-node deployment is therefore unsupported. The design only says the server is reused on port 8039 (`docs/superpowers/specs/2026-05-15-cpa-tauri-rewrite-design.md:15,36`) and does not mark it non-production.

Reproduction: run two server processes; create room on A, join same code on B returns room-not-found.

Fix: document single-node/dev scope or back rooms/icons/rate windows with Redis.

# 9. Dependency CVEs
[Severity: low] NOT REPRODUCED. The requested manifests (`package.json`, `Cargo.toml`) are outside the allowed read scope. In-scope docs only mention `package.json` and `tauri-plugin-store` paths/names without versions (`docs/superpowers/specs/2026-05-15-cpa-tauri-rewrite-design.md:50,53,58`). No CVE is reported because no versioned dependency evidence was read.

Reproduction: none under the path constraint.

Fix: allow reading `app/package.json`, `Server/package.json`, `app/src-tauri/Cargo.toml`, and lockfiles, then check OSV/npm/RustSec advisories by exact version.

# 10. Test coverage gaps
[Severity: med] The design requires Vitest units and ws integration (`docs/superpowers/specs/2026-05-15-cpa-tauri-rewrite-design.md:117-121`). No client-side `*.test.*`/`*.spec.*` files were found under `app/src`.

Reproduction: `rg --files app/src | rg '(test|spec)\\.(ts|tsx|js|jsx)$|(__tests__)'` returns no files.

Fix exactly these 5 must-have cases:
1. `pomodoro.tick`: focus=1s, autoStartBreak=true, no break-second residue (`pomodoro.ts:35-43,126-139`).
2. `pomodoro.tick`: large delta processes deterministically or clamps by spec (`pomodoro.ts:126-139`).
3. protocol serialization: outbound `sendStateUpdate` includes `v`, `type`, `state`, and room (`network.ts:68-71,215-217`).
4. network receive validation: malformed `room_snapshot`/`player_state_broadcast` cannot poison `players` (`network.ts:86-139`).
5. stateSync: leaving and rejoining a room sends initial state despite identical payload (`stateSync.ts:26-36`).

# Prioritized fix backlog
1. [S] Add WebSocket connection generation guard and clear reconnect on leave.
2. [S] Reset/scope `stateSync.lastSent` by room/player.
3. [M] Add `ws` maxPayload, raw size cap, and full protocol schema.
4. [S] Remove broad Tauri window/store/opener permissions; restore CSP.
5. [S] Zero Pomodoro accumulator on phase transition.
6. [M] Replace Rust polling thread with lifecycle-aware/main-thread-safe polling.
7. [S] Document single-node Server scope or add Redis plan.
8. [M] Add the 5 client tests above.
