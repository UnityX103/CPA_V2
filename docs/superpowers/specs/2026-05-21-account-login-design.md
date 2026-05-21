# Account Login Design

**Date**: 2026-05-21
**Scope**: Add a minimal username/password account system to the Settings panel's online tab and the Node WebSocket server. Accounts are for internal beta identity only. Pomodoro and check-in plan features must remain fully usable without logging in or connecting to a server.

## Goal

Users can create an account by typing a username and password, then log in with the same credentials from the Settings > 联机 tab. No email, phone number, captcha, password complexity rule, password reset, or profile flow is required for this internal beta.

The account system should make online identity more stable, but it must not become an app-wide gate. If the server is down, the user is offline, or the user never creates an account, the local plan and pomodoro flows continue working exactly as they do today.

## Current Context

The client already has a `network` Zustand store, a Settings `OnlineTab`, and a WebSocket protocol used for room creation, room join, remote state broadcast, icon upload, and ping/pong. The Server is a single-node Node.js WebSocket service on port `8039`, with rooms and caches stored in process memory.

Existing important constraints remain in force:

- Keep the WebSocket reconnect generation guard in `app/src/domain/network.ts`.
- Keep Server payload capping at the `ws` `maxPayload` layer.
- Keep the room server single-node; do not introduce distributed session or room assumptions.
- Keep protocol validation explicit and whitelist-based.
- Do not make local pomodoro, check-in plan editing, or check-in windows depend on network status.

## Default Product Decisions

- Username is the account identity and must be unique.
- Display name for online rooms defaults to the logged-in username, while the existing editable player name can remain as the room display name.
- Account creation and login happen in the 联机 tab above the room controls.
- Users can use the app as a guest locally forever.
- Room creation and room join should require a logged-in account for this pass, because the purpose of this feature is stable online identity.
- Existing local settings and pomodoro state are not migrated into accounts in this pass.
- Session persistence is local to the desktop app. Logging in stores a session token locally; logging out clears it.

## Approaches Considered

### Recommended: WebSocket Auth With File-Backed Server Store

Add `auth_create`, `auth_login`, `auth_session`, and `auth_logout` messages to the existing WebSocket protocol. Store users and sessions in a small JSON file under `Server/data/accounts.json`, using salted password hashes instead of plaintext passwords.

This fits the current Server shape, avoids adding an HTTP framework or database, and is enough for internal beta. It is also easy to test with the existing `node --test` setup.

### HTTP Auth API Beside WebSocket Rooms

Add an HTTP server with `/signup`, `/login`, and `/session` endpoints, then keep room sync on WebSocket.

This is conventional, but it introduces a second transport and more server bootstrapping for a small beta-only feature. It also adds CORS and CSP considerations that are not needed yet.

### In-Memory Accounts Only

Keep accounts in memory and lose them when the server restarts.

This is the quickest implementation, but it makes account creation feel broken after a deploy or restart. It also makes tests less representative of the real beta flow.

## Client Architecture

Add an account slice to the existing `network` domain rather than creating an app-wide auth gate:

```ts
type AccountStatus = 'guest' | 'checking' | 'creating' | 'loggingIn' | 'loggedIn' | 'error';

interface AccountState {
    accountStatus: AccountStatus;
    accountUser: { userId: string; username: string } | null;
    accountToken: string | null;
    accountError: string | null;
}
```

The network store owns account actions:

- `createAccount(username, password)`
- `login(username, password)`
- `restoreAccountSession()`
- `logout()`

The main app store performs real WebSocket work. The Settings-window store keeps the current bridge-dispatch pattern and forwards account actions to the main window.

Persist only the session token and username in local storage or the existing lightweight persistence pattern. Do not persist the password.

## Settings UI

The 联机 tab gets a compact account card above the existing 自动联网 and room cards.

Logged out state:

- Username input.
- Password input.
- Primary action: 登录.
- Secondary action: 创建账号.
- Small status/error text for duplicate username, wrong password, or connection failure.

Logged in state:

- Show current account username.
- Show a 退出登录 button.
- Existing room controls remain below.
- Player name defaults to username if the existing player name is empty or still the initial default.

Room controls:

- If not logged in, 创建房间 and 加入房间 are disabled and show a short inline hint.
- If logged in, the current room flow works as before.
- The busy overlay remains reserved for room joining; account actions use inline disabled buttons/status text so the whole tab is not blocked.

## Server Architecture

Add `Server/src/AuthStore.js` with one clear responsibility: manage users, password hashes, and sessions.

`AuthStore` stores a JSON file shaped like:

```json
{
  "users": {
    "normalized-username": {
      "userId": "uuid",
      "username": "DisplayName",
      "passwordHash": "base64",
      "passwordSalt": "base64",
      "createdAt": 1779360000000
    }
  },
  "sessions": {
    "token": {
      "userId": "uuid",
      "username": "DisplayName",
      "createdAt": 1779360000000
    }
  }
}
```

Use Node's built-in `crypto.scrypt` with a per-user random salt. Use `randomUUID()` for `userId` and `randomBytes(32)` for session tokens. Write the JSON file atomically by writing a temporary file and renaming it.

Auth validation:

- Username trims surrounding whitespace.
- Username must be 1 to 32 visible characters.
- Password must be 1 to 128 characters.
- No password complexity rules.
- Username uniqueness is case-insensitive by using a normalized lookup key.
- Passwords are never logged, returned, or stored in plaintext.

## Protocol

Keep `PROTOCOL_VERSION = 1` and add these client messages:

- `auth_create`: `{ username, password }`
- `auth_login`: `{ username, password }`
- `auth_session`: `{ token }`
- `auth_logout`: `{ token }`

Add these server messages:

- `auth_ok`: `{ user: { userId, username }, token }`
- `auth_logged_out`: `{}`
- existing `error`: includes auth error codes.

Auth error codes:

- `USERNAME_TAKEN`
- `INVALID_CREDENTIALS`
- `INVALID_SESSION`
- `INVALID_ACCOUNT_INPUT`
- `AUTH_REQUIRED`

Room messages should require an authenticated connection. `create_room` and `join_room` fail with `AUTH_REQUIRED` if the connection has no authenticated user.

When authenticated, the connection stores:

- `userId`
- `username`
- `authToken`

Room player identity remains per-connection `playerId` for compatibility with existing remote-player window logic. The server includes optional `userId` and `username` in future-safe room player records only if the frontend needs them; this pass can keep `RemotePlayer` unchanged and use `playerName` for display.

## Data Flow

Startup:

1. The main window hydrates the saved account token.
2. If a token exists, the network store opens or reuses a socket and sends `auth_session`.
3. On `auth_ok`, the store enters `loggedIn`.
4. On `INVALID_SESSION`, the store clears the saved token and returns to `guest`.

Create account:

1. User types username/password in Settings > 联机.
2. Settings store dispatches `createAccount` to main.
3. Main opens WebSocket if needed and sends `auth_create`.
4. Server creates the user, creates a session, and replies `auth_ok`.
5. Client persists token and shows logged-in account UI.

Login:

1. User types username/password.
2. Client sends `auth_login`.
3. Server verifies password with scrypt.
4. Server replies `auth_ok`.
5. Client persists token.

Room join:

1. User clicks 创建房间 or 加入房间.
2. Client sends the existing room message on the authenticated socket.
3. Existing room created/joined/snapshot flow continues unchanged.

Logout:

1. Client leaves the current room if joined.
2. Client sends `auth_logout` with the current token.
3. Client clears account state and token.
4. Local pomodoro and check-in state remain untouched.

## Offline Behavior

Local features are independent from account state:

- Pomodoro panel renders and runs while `network.accountStatus` is `guest`, `error`, or `loggedIn`.
- Check-in plan editor and today check-in windows do not read account state.
- Existing local persistence remains local.
- Network errors appear only in the 联机 tab and do not change local feature stores.

Auto-connect should not repeatedly create room attempts while logged out. If `autoConnect` is enabled but no valid session exists, the network store should restore the account session first. If restore fails, it should stop at `guest` with an inline auth hint.

## Error Handling

- Duplicate username shows `USERNAME_TAKEN`.
- Wrong username/password shows `INVALID_CREDENTIALS`.
- Expired or missing token clears local session and shows guest UI.
- Server or socket failure shows the existing connection error style inside the 联机 tab.
- Logging out while in a room calls `leaveRoom` first and then clears auth.
- Failed account actions do not close the socket if the socket is otherwise usable.

## Tests

Server tests:

- `AuthStore` creates users, rejects duplicate usernames case-insensitively, hashes passwords, and never stores plaintext passwords.
- `AuthStore` logs in with correct credentials and rejects wrong credentials.
- `auth_session` restores valid sessions and rejects invalid tokens.
- `create_room` and `join_room` return `AUTH_REQUIRED` before auth.
- Authenticated `create_room` and `join_room` preserve existing room behavior.
- Existing protocol tests still cover version mismatch, invalid JSON, and room payload normalization.

Frontend domain tests:

- `network.createAccount` sends `auth_create`, stores `auth_ok`, and persists token.
- `network.login` sends `auth_login`, stores `auth_ok`, and updates player name default.
- `network.restoreAccountSession` clears bad tokens on `INVALID_SESSION`.
- `network.logout` leaves rooms, clears token, and returns to `guest`.
- Existing reconnect generation guards still prevent stale callbacks.
- Local `pomodoro` and `checkin` tests do not need account setup.

Frontend UI tests:

- Logged-out 联机 tab shows username/password inputs and login/create buttons.
- Logged-in 联机 tab shows the current username and logout button.
- Room buttons are disabled while logged out.
- Account errors render inline without hiding local settings tabs.
- Existing online busy overlay still appears only for room connection status.

Verification commands:

- `cd Server && npm test`
- `cd app && npx vitest run src/domain/network.test.ts src/ui/SettingsPanel.test.tsx`
- `cd app && npm test`
- `cd app && npm run build`

## Non-Goals

- Email verification.
- Password reset.
- OAuth or third-party login.
- Multi-device cloud sync for pomodoro or check-in plans.
- Database deployment.
- Account profile editing.
- Server-side rate limiting beyond existing payload caps and simple validation.
- Changing the remote-player card architecture.
