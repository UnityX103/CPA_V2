# Account Auth Status Reset Design

**Date**: 2026-05-21
**Scope**: Fix the incorrect `正在加入房间...` overlay after account creation or login succeeds.

## Goal

Creating or logging into an account should not imply any room action. After `auth_ok`, the 联机 tab should show the logged-in account summary, auto-connect row, join/create room card, and history card. It should not show the room busy overlay unless the user explicitly clicks `创建房间` or `加入房间`.

## Current Context

The network store uses `status: "connecting"` whenever `ensureSocket()` opens the WebSocket. That is correct for room join/create, but account creation and login also open the same WebSocket. The Settings panel currently treats `status === "connecting"` after login as a room-join busy state, so an account flow can leave the UI dimmed with `正在加入房间...` even though no room join is happening.

The previous quick UI guard only hid the overlay while `accountStatus` was `creating`, `loggingIn`, or `checking`. It does not cover the moment after `auth_ok`, because `accountStatus` becomes `loggedIn` while `status` can still remain `connecting`.

## Approaches Considered

### Recommended: Reset Connection Status After Auth-Only Results

When the server returns `auth_ok`, `auth_logged_out`, or `INVALID_SESSION`, the client should reset `status` to `idle` if the user is not in a room. This treats WebSocket opening for account auth as transport setup, not room connection state.

This fixes the root state mismatch and keeps the UI simple.

### Alternative: Add A Separate Room Busy Flag

Add `roomActionStatus` or `pendingRoomAction` to distinguish auth socket connection from room join/create.

This is more explicit, but it is larger than needed for the current bug. It can be revisited if more independent network actions are added.

### Alternative: Only Hide The Overlay In UI

Make the overlay check `roomCode` or a local UI flag.

This masks the symptom but leaves the domain store saying it is still connecting after auth completed. That stale state can continue to confuse mirror windows and tests.

## Selected Design

Use the recommended approach.

Implementation rules:

- On valid `auth_ok`, set `accountStatus` to `loggedIn` and set `status` to `idle` when `playerId` is null.
- On `auth_logged_out`, clear account fields and set `status` to `idle`.
- On `INVALID_SESSION`, clear account fields and set `status` to `idle`.
- Preserve `joined`, `reconnecting`, and room state if the user is already in a room.
- Keep the Settings overlay scoped to actual room connection. The current UI guard can remain as extra protection, but the domain store should no longer leave auth-only flows in `connecting`.

## Tests

Add or update tests so they fail before the fix:

- `network.createAccount` receives `auth_ok` after opening a socket and ends with `accountStatus: "loggedIn"` and `status: "idle"`.
- `network.login` or `restoreAccountSession` handles `INVALID_SESSION` and ends with `status: "idle"`.
- Settings UI with `accountStatus: "loggedIn"` and `status: "idle"` renders the room controls without `正在加入房间...`.

Existing room join/create tests should continue to prove room flows still use `connecting` while waiting for room messages.

## Non-Goals

- Do not auto-create or auto-join rooms after account creation.
- Do not introduce an account profile screen.
- Do not change the WebSocket protocol.
- Do not modify Pencil for this patch; the visual design already says account login and room join are separate steps.
