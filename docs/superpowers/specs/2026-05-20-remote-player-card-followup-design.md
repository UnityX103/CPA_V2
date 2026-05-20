# Remote Player Card Follow-Up Design

**Date**: 2026-05-20
**Scope**: Fix two regressions in the current remote-player card work: the `epxz9` pin button placement inside Pencil node `drqFB`, and the missing display of remote synced key counter node `oCExj` when another player joins with a broadcast key binding.

## Goal

Remote player cards match the current Pencil `PlayerCard` component and reliably show the remote player's synced key counter when that player has selected a binding key for room broadcast.

This is a narrow follow-up to `docs/superpowers/specs/2026-05-19-remote-player-sync-design.md`. It should not reopen the larger remote-window architecture unless direct evidence shows the architecture is the cause.

## Context

Pencil MCP currently reports:

- `drqFB` — reusable `PlayerCard`, `153x94`, `padding: 14`, `clip: true`.
- `D3ZIc` — `pc-content-stack`, `layout: vertical`, `gap: 12`, `width: fill_container`.
- `oCExj` — `timeRow`, `alignItems: center`, `justifyContent: end`, with one `KeyCounterPill` instance.
- `epxz9` — `pc-pin-btn`, a `Button/Pin` instance with `layoutPosition: absolute`, `x: 110`, `y: 50`.

The React implementation already renders `PlayerCard` from `app/src/ui/PlayerCard.tsx` and styles the pin with `.pc-pin { left: 110px; top: 50px; }`. The important mismatch is semantic: Pencil's `epxz9` is an absolute child of `D3ZIc`, while the React button is currently an absolute child of `.pc-card`. The same numeric coordinates therefore resolve against a different containing block.

The synced key data path already exists in current code:

- Local `stateSync.ts` builds `RemoteState.bindingKey` from `bindingKey.syncedKeyId`.
- `network.ts` stores incoming `player_state_broadcast.state` on the remote player.
- `Server/src/protocol.js`, `Server/src/RoomManager.js`, and server tests already preserve `bindingKey`.
- `PlayerCard.tsx` shows `.pc-time-row` only when `player.state?.bindingKey` is non-null.
- Remote player card windows receive state via `useBridgeHost` snapshots and `useBridgeClient` mirrors.

The most likely current failure is therefore in the frontend bridge/window display chain: a card window can be opened before it has a fresh snapshot containing the remote player's updated `bindingKey`, and existing fixed-label windows may not receive an immediate snapshot after opening.

## Approaches Considered

### Recommended: Narrow Frontend Follow-Up

Adjust the React card hierarchy so `epxz9` uses the same containing block as Pencil, and add an explicit snapshot send after remote card windows are created. Strengthen tests around `PlayerCard`, `RemotePlayerCardApp`, and bridge-host snapshot delivery for `bindingKey`.

This keeps the fix inside the layer that has direct evidence. It also preserves the accepted server protocol and remote-window architecture.

### Protocol Rewrite

Introduce a new dedicated `binding_key_broadcast` WebSocket event separate from `RemoteState`.

This would make key-counter updates explicit, but current server tests show `bindingKey` is already normalized and broadcast. A new protocol path would increase compatibility and migration risk without evidence that the protocol is the failing layer.

### Restore In-Main-Window `RemoteRoster`

Render remote players back in the main DOM instead of independent Tauri windows.

This would likely make bridge timing simpler, but it contradicts the approved remote-player design: cards should be independent small windows and should not resize or crowd the main pomodoro window.

## Design

### Card Geometry

Treat `D3ZIc` / `.pc-content` as the containing block for `epxz9`.

Implementation should move the pin button inside `.pc-content` after the footer, matching the Pencil hierarchy:

```text
pc-card (drqFB)
  pc-content (D3ZIc)
    head (tyyE3)
    divider (cnbrI)
    footer (cwbeK)
    pin button (epxz9, absolute)
```

`.pc-content` remains `position: relative`; `.pc-pin` keeps `left: 110px`, `top: 50px`, `width: 22px`, and `height: 22px`. The card root remains clipped. This makes the numeric Pencil coordinates resolve against the intended content-stack origin.

No Pencil edit is needed in this pass because the Pencil source is already the desired source of truth. The implementation should update code to match it.

### Remote Synced Key Display

Keep `RemoteState.bindingKey` as the single source for remote key-counter display.

The remote card should show `oCExj` when and only when:

- the remote player has a non-null `state.bindingKey`;
- `bindingKey.keyLabel` is a non-empty string after trimming;
- `bindingKey.pressCount` is a finite non-negative integer after server/client normalization.

If `state.bindingKey` is null, missing, or has an empty label, the `timeRow` remains hidden. This prevents an empty pill from appearing for players who have not selected a broadcast key.

### Bridge And Window Timing

When `remotePlayerWindows.ts` successfully creates a card window, it should trigger or request a fresh host snapshot for that fixed label after the webview is ready enough to listen. The design should use the existing `app:state:request` and `app:state` event pattern where possible:

1. `RemotePlayerCardApp` mounts and calls `useBridgeClient`.
2. `useBridgeClient` attaches its `EVT_STATE` listener, then emits `EVT_STATE_REQUEST` to `main`.
3. The main host responds with a snapshot containing `network.players`.
4. Any later `network.players` change emits snapshots to all fixed remote-player labels.

The implementation should harden this path with tests rather than adding a second state transport. If the current `EVT_STATE_REQUEST` path already works in tests, the missing display bug should be fixed by ensuring host snapshots are emitted after `bindingKey` changes and that remote-card windows keep their listener alive.

### Error Handling

- If a remote card window cannot be created, do not retain its label assignment.
- If a mirror snapshot is missed during window startup, the card window should recover by requesting state on mount.
- If `bindingKey` is malformed in a local test fixture or future legacy server response, the UI should hide the pill instead of throwing.
- If more than seven remote players join, keep the existing fixed-label cap and show the first seven sorted remote player IDs.

## Tests

Add or update frontend tests:

- `PlayerCard.test.tsx`: confirms the pin button is inside `.pc-content`, because `epxz9` coordinates are relative to `D3ZIc`.
- `PlayerCard.test.tsx`: confirms `oCExj` / key pill renders when `state.bindingKey` has `keyLabel` and `pressCount`.
- `PlayerCard.test.tsx`: confirms no key pill renders when `state.bindingKey` is null or has an empty label.
- `RemotePlayerCardApp.test.tsx`: confirms a routed remote player with `bindingKey` renders the key label and count after mirror state is present.
- `bridge/host.test.ts`: confirms `bindingKeySig` changes when the synced entry press count changes and that the mirror target list still includes all fixed remote-player labels.
- `bridge/client.test.ts`: confirms incoming snapshot `network.players[*].state.bindingKey` is cloned into the remote card store.

Run:

- `cd app && npx vitest run src/ui/PlayerCard.test.tsx src/RemotePlayerCardApp.test.tsx src/domain/bridge/host.test.ts src/domain/bridge/client.test.ts src/domain/stateSync.test.ts src/domain/network.test.ts`
- `cd app && npm test`
- `cd app && npm run build`

Manual verification:

1. Start the local app flow through `./start.sh`.
2. Create or join a room with two clients.
3. On the remote player, enable a binding key and mark it as synchronized.
4. Press the bound key at least once.
5. Confirm the other client's remote player card shows the `oCExj` key pill.
6. Confirm the pin button visually matches `epxz9` in `drqFB`.

## Non-Goals

- Do not redesign `drqFB`.
- Do not change the server's single-node room model.
- Do not add a new WebSocket message type unless the existing broadcast path is proven broken by a failing test.
- Do not replace independent remote-player windows with `RemoteRoster`.
- Do not change the active-app icon/title behavior in this pass.

