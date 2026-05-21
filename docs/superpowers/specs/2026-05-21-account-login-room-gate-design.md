# Account Login Room Gate Design

**Date**: 2026-05-21
**Scope**: Fix account login/create reliability, require a logged-in account before any room join/create UI appears, and bring the new online account UI into the Pencil source of truth.

## Goal

The 联机 tab should behave as a clear two-step flow:

1. Users log in or create an account.
2. Only after the account is logged in does the room panel appear, allowing room creation or joining.

Before login, the room join/create panel and room history panel are not rendered. Local pomodoro, check-in, settings, input counter, and other non-online features continue to work without an account.

## Current Context

The previous account-login pass added:

- `accountPersistence.ts` for local token storage.
- account state and actions in `network.ts`.
- WebSocket auth messages in the client and server.
- Server-side `AuthStore`.
- account controls in `SettingsPanel.tsx`.

The current implementation still has two product gaps:

- Main-window startup does not call `restoreAccountSession()`, so saved sessions are not restored automatically.
- Logged-out users still see the room join/create card, with disabled buttons and a hint. The requested behavior is stricter: the room panel should not display before login.

The Pencil file `AUI/PUI.pen` currently has `Online Settings Panel` nodes for auto-connect, join room, joined room, history, and busy overlay, but it has no account-login card. That means the current React UI has drifted from the design source of truth.

## Approaches Considered

### Recommended: Repair Existing Auth Flow And Gate Room UI

Keep the existing WebSocket auth protocol and `network` store, then fix the missing lifecycle pieces. The app restores a saved account token on startup, account errors return the UI to a retryable logged-out state, and the Settings online tab only renders room controls when `accountStatus === "loggedIn"`.

This is the smallest change that matches the requested behavior and preserves the current architecture.

### Alternative: Split Auth Into A Dedicated Store

Move account state into a separate `account` domain store and make `network` depend on it.

This creates cleaner domain boundaries in the long run, but it is too much movement for a targeted bug fix. It would also require bridge protocol changes and more tests across mirror windows.

### Alternative: Make The Server Auto-Create Guest Accounts

Let room creation/join implicitly create a temporary account if the user is not logged in.

This conflicts with the requested gate. It also weakens the purpose of stable online identity.

## Selected Design

Use the recommended approach.

### Client Account Lifecycle

The main window owns account restoration because it owns the real network socket. On app startup, a `useEffect` in `App.tsx` calls `useNetworkStore.getState().restoreAccountSession()` once.

If no persisted session exists, the store remains `guest`. If a token exists, the store enters `checking`, opens or reuses the WebSocket, sends `auth_session`, and waits for the server response.

On `auth_ok`, the store becomes `loggedIn`, saves the token, and defaults `playerName` to the username only if the player name is empty or still `"我"`.

On `INVALID_SESSION`, the store clears the persisted account and returns to `guest`.

For account create/login failures, the store should not leave the UI stuck in a permanent busy state. Server auth errors such as `USERNAME_TAKEN`, `INVALID_CREDENTIALS`, `INVALID_ACCOUNT_INPUT`, and `AUTH_REQUIRED` should set `accountStatus` to `guest` with `accountError` populated. The UI can then re-enable inputs and buttons immediately.

### Room Gate

Room creation and joining remain guarded in the domain store:

- `createRoom` returns early with `AUTH_REQUIRED` unless logged in.
- `joinRoom` returns early with `AUTH_REQUIRED` unless logged in.
- Server `create_room` and `join_room` continue to call `ensureAuthenticated`.

The Settings online tab additionally hides room controls until login. While logged out, users see:

- Account card.
- Auto-connect row.
- Account error/status text.

After login and before joining a room, users see:

- Account summary card with logout.
- Auto-connect row.
- Join/create room card.
- History card.

After joining, users see:

- Account summary card.
- Auto-connect row.
- Joined-room card and member list.

This keeps the UI aligned with the product rule: users cannot attempt room actions before account identity exists.

### Settings UI

Update `SettingsPanel.tsx` so the not-joined room card and history card are gated by `isLoggedIn && !isJoined`.

Remove the logged-out room hint because the room card will no longer render in logged-out state. Keep account errors inside the account card.

Use Chinese, user-facing error strings instead of raw protocol codes in the account area. Minimum mapping:

- `USERNAME_TAKEN`: `用户名已存在`
- `INVALID_CREDENTIALS`: `用户名或密码错误`
- `INVALID_ACCOUNT_INPUT`: `账号或密码格式不正确`
- `INVALID_SESSION`: `登录已失效，请重新登录`
- `AUTH_REQUIRED`: `请先登录账号`
- `CONNECTION_ERROR`: `无法连接服务器`

Unknown errors can fall back to `操作失败，请稍后重试`.

### Pencil Design

Update `AUI/PUI.pen` through the Pencil MCP only. Do not edit the encrypted `.pen` file directly.

Design changes:

- Add an `onlAccountCard` to reusable `Online Settings Panel` above `onlAutoRow`.
- Logged-out account card shows account/password inputs and `创建账号` / `登录` actions.
- Add a logged-in account summary card in the same reusable panel, disabled by default, so variants can switch between login form and summary without inventing a separate component family.
- Update or add variants so `onlPanel/not-joined` represents logged-in-but-not-joined, not guest.
- Add a top-level `onlPanel/logged-out` variant that contains the logged-out account card and auto-connect row, with join/history disabled by absence rather than disabled buttons.

The React implementation should map to the Pencil nodes by class names or comments in the existing style.

### Server Behavior

Keep the current Server auth architecture:

- `AuthStore` persists file-backed users and sessions.
- `auth_create`, `auth_login`, `auth_session`, and `auth_logout` remain WebSocket messages.
- Room actions require an authenticated connection.

One server-side detail to verify during implementation: invalid auth input currently normalizes to `INVALID_MESSAGE` at protocol parse time. The client should handle that as a user-facing account input error when the failed action was account-related, or the server can return `INVALID_ACCOUNT_INPUT` consistently. Prefer server consistency if it is a small protocol change.

### Tests

Frontend domain tests:

- Startup restoration calls `restoreAccountSession` from the main app lifecycle.
- `restoreAccountSession` sends `auth_session` when a token exists and clears state on invalid session.
- `createAccount` and `login` return to retryable logged-out state on account errors.
- `createRoom` and `joinRoom` still do not open a socket when logged out.

Frontend UI tests:

- Logged-out online tab renders account controls and does not render `加入房间`, `创建房间`, `历史房间`, or room number fields.
- Logged-in idle online tab renders account summary plus join/create room controls and history.
- Joined online tab renders account summary plus room member UI.
- Account error codes render as Chinese copy.

Server tests:

- Unauthenticated `create_room` and `join_room` still return `AUTH_REQUIRED`.
- Authenticated room create/join behavior remains unchanged.
- Invalid account input returns a stable account error code.

Pencil verification:

- Inspect `Online Settings Panel` and online variants through MCP after edits.
- Take a screenshot of the affected Pencil node or variants to confirm the account card and guest gate are visible.

## Non-Goals

- No password reset, email verification, captcha, profile page, or account settings screen.
- No database migration away from the file-backed `AuthStore`.
- No app-wide login requirement.
- No Windows/macOS native auth integration.

## Risks

- The Settings window is a bridge mirror, so account actions must continue to dispatch to the main window and rely on bridge snapshots for UI updates.
- Auto-connect must not repeatedly try room actions while logged out.
- `network.ts` reconnect generation guards must be preserved.
- Pencil design changes must avoid breaking existing component IDs that the implementation comments reference.
