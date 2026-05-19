# Remote Player Sync And Card Parity Design

## Problem

Multiplayer sync is partially present but not usable end to end in the current worktree. The frontend has `network`, `stateSync`, `PlayerCard`, and `RemoteRoster` code, but the active main window no longer mounts remote players. The current worktree also has an empty `Server/` directory because it is a gitlink without a checkout, while the usable Server repository exists at `/Users/xpy/Desktop/NanZhai/CPA_V2/Server`.

Remote player cards must return as first-class desktop-pet UI elements. Each remote player needs a card matching Pencil node `drqFB`, each card must be independently draggable and positionable, and each card must show the remote player's pomodoro status, synced key counter, foreground app icon, and foreground app title.

## Goals

- Restore a usable `Server/` checkout inside the current worktree before running local server tests.
- Keep the main pomodoro window behavior intact; remote player cards are independent small windows, not a right-side roster list.
- Render one remote player card per non-local player.
- Let every remote player card drag independently and persist its position by `playerId`.
- Extend multiplayer state so remote cards show the active app window title and icon.
- Match Pencil reusable component `drqFB` with pixel-level verification.
- Verify the local server flow with test players joining a room and showing player cards.

## Non-Goals

- Do not redesign the pomodoro panel.
- Do not convert the Server into a multi-node service.
- Do not remove existing generation guards in `network.ts`.
- Do not replace the existing `icon_upload` / `icon_request` Server cache path unless direct active-app icon syncing proves too heavy.
- Do not reintroduce `RemoteRoster` as a single draggable list.

## Current Context

Pencil MCP reports `drqFB` as the reusable `PlayerCard` component. Its root frame is `153x94`, vertical, `padding: 14`, `gap: 5`, `cornerRadius: 20`, `fill: #FFFDFBF2`, and `stroke: #EFDCCD`. The content stack contains:

- `name` text and `phaseBadge` in the head row.
- A `KeyCounterPill` instance on the right.
- A `#F3E3D3` divider.
- A footer with a lucide `app-window` icon and app text.
- A pin button positioned at `x=110`, `y=50`.

The current `PlayerCard.tsx` already mirrors much of this structure, but it does not use remote app title or real icon data. The current `RemoteRoster.tsx` renders a vertical list and is no longer mounted by `App.tsx`.

The current worktree's `Server/` directory must be restored before local server tests can run. The reference checkout is `/Users/xpy/Desktop/NanZhai/CPA_V2/Server`, currently at commit `9a98bf4 Harden protocol validators per adversarial review (#1 + codex follow-up)`.

## Architecture

Use the existing room sync shape:

```text
local stores
  -> stateSync builds RemoteState
  -> network sends player_state_update
  -> Server normalizes and broadcasts
  -> remote network.players updates
  -> RemotePlayerWindowController mirrors players into card windows
```

The main app owns a `RemotePlayerWindowController` next to the existing bridge, active-app, and input-counter controllers. It filters out the local `playerId`, opens one small Tauri webview window per remaining `RemotePlayer`, and closes that window when the player leaves.

Each card window loads a `RemotePlayerCardApp` route, for example `?window=remote-player&playerId=<id>`. The route renders one `PlayerCard` using mirrored network state from the main window. The accepted runtime path is dynamic remote player card windows, not the old `RemoteRoster` list.

`RemoteRoster` can either be deleted or kept as an unused legacy component during the implementation.

## Protocol

Extend `RemoteActiveApp` to include the fields the card needs:

```ts
interface RemoteActiveApp {
    name: string;
    bundleId: string;
    windowTitle?: string | null;
    iconDataUrl?: string | null;
    iconId?: string;
}
```

`stateSync` maps native active app data as follows:

- `ActiveAppInfo.name` -> `RemoteActiveApp.name`
- `ActiveAppInfo.bundle_id` -> `RemoteActiveApp.bundleId`
- `ActiveAppInfo.window_title` -> `RemoteActiveApp.windowTitle`
- `ActiveAppInfo.icon_data_url` -> `RemoteActiveApp.iconDataUrl`

Server protocol normalization stays explicit and whitelist-based. `protocol.js` and `RoomManager.js` should both keep accepting only known active-app fields, clamping string size for `name`, `bundleId`, `windowTitle`, `iconId`, and `iconDataUrl`.

The first implementation may send `iconDataUrl` directly in `player_state_update` so the UI path is complete. If test or runtime payload size becomes a problem, the same public shape can later switch to `iconId` plus the existing `icon_request` and `icon_broadcast` flow.

## Remote Card Display

For each remote player:

- Player name: `player.playerName || "远端玩家"`.
- Phase badge:
  - no state: `待加入`, gray.
  - completed: `已完成`.
  - paused: `已暂停`.
  - break running: `休息中`.
  - focus running: `专注中`.
- Key counter pill: shown only when `state.bindingKey` is not null.
- Active app label: `state.activeApp?.windowTitle || state.activeApp?.name || "待加入"`.
- Active app icon: `state.activeApp?.iconDataUrl` if present, otherwise the Pencil fallback lucide `app-window` icon.

The card keeps the `drqFB` geometry and visual tokens. Long names and app titles truncate rather than resizing the card.

## Drag And Positioning

Each remote player card is an independent Tauri window with a position keyed by `playerId`.

Default placement starts near the pomodoro window and offsets each new card so cards do not overlap on first join. Persisted positions take priority over default placement.

Dragging works from the card background, using the same native `getCurrentWindow().startDragging()` affordance as the pomodoro panel. Dragging a player card moves only that player's card window.

Pointer rules:

- Left mouse or primary pointer starts drag.
- Interactive descendants use the shared no-window-drag classifier pattern.
- Drag end records the native window position.
- Window creation and persisted positions clamp to visible monitor bounds when possible.

Positions are persisted by `playerId` in a small frontend persistence module, for example:

```ts
type RemotePlayerCardPositions = Record<string, { x: number; y: number }>;
```

When a player leaves, their card window closes but the saved position remains. If the same `playerId` appears again, the card returns to its saved position.

Remote card windows should be transparent, decorationless, resizable false, and sized to the `drqFB` component bounds. They should not enlarge or reposition the main pomodoro window.

## Server Restoration

The implementation should restore the current worktree's `Server/` checkout before touching Server tests. Use the existing standalone repository at `/Users/xpy/Desktop/NanZhai/CPA_V2/Server` as the source of truth for content and commit alignment.

After restoration, `Server/package.json` must support `npm test`, which runs `node --test test/*.js`.

## Testing

Server tests:

- `parseClientMessage` preserves `activeApp.windowTitle` and `activeApp.iconDataUrl`.
- `player_state_broadcast` sends pomodoro, binding key, app title, and app icon to other players.
- `room_snapshot` gives a newly joined player the existing players' title and icon fields.

Frontend domain tests:

- `stateSync` includes app title and icon in `RemoteState`.
- `network` updates an existing remote player from `player_state_broadcast` without creating ghost players.
- Existing room/player/payload `lastSent` behavior remains intact.

Frontend UI tests:

- `PlayerCard` prefers `windowTitle`, falls back to app name, and then `待加入`.
- `PlayerCard` uses `iconDataUrl` when present and uses the fallback icon when absent.
- `RemotePlayerWindowController` opens windows only for non-local players.
- Each player card position is independent and persists by `playerId`.
- Dragging one card invokes native drag for that card window only.

Pixel and visual verification:

- Export Pencil node `drqFB` through Pencil MCP.
- Generate or use a dedicated HTML/dev-align route that renders only the matching React `PlayerCard` state.
- Capture both at the same logical dimensions.
- Compare with a strict visual tolerance that allows font antialiasing but catches size, color, spacing, and alignment drift.

Local end-to-end verification:

- Run `cd Server && npm test`.
- Run focused frontend tests for `stateSync`, `network`, `PlayerCard`, and `RemotePlayerWindowController`.
- Run `cd app && npm test`.
- Run `cd app && npm run build`.
- Start the local Server and a local app/frontend flow; create or join a test room and verify that a test player entering the room shows a draggable card with app title and icon.

## Risks And Mitigations

- Direct `iconDataUrl` can increase WebSocket payload size. Keep Server payload caps and string clamps, and keep the existing icon cache path available for a later optimization.
- Font rendering may differ between Pencil export and browser screenshots. Pixel checks should allow narrow antialiasing tolerance while still checking component geometry and color.
- `playerId` may change on reconnect depending on the current Server session. Persisting by `playerId` matches the accepted requirement for this pass; a future stable player identity can be added separately if needed.
- Restoring `Server/` in a worktree with a gitlink can affect review ergonomics. Keep the restoration explicit and verify the Server commit before editing.
