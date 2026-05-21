# Pomodoro Cloud Settings Design

**Date**: 2026-05-21
**Status**: Approved by user default policy
**Scope**: Save Pomodoro settings, global app settings, and check-in plan data to the CPA_V2 server under the logged-in account. Local Pomodoro and check-in use must continue working offline.

## Goal

When a user logs in, CPA_V2 should restore their Pomodoro-related configuration from the server and keep future changes saved to the server. This includes the Pomodoro settings tab values and the check-in plan settings. The app remains local-first: the timer, settings UI, today check-in, and plan editor still work when logged out or offline, and local persistence remains the fallback cache.

## Current Context

The app already has:

- A file-backed account system on the Node WebSocket server (`Server/src/AuthStore.js`).
- A single WebSocket protocol for auth, room, icon, and remote-player messages (`Server/src/protocol.js`, `app/src/domain/network.ts`).
- Local settings persistence through Tauri store (`app/src/domain/settingsPersistence.ts`).
- Local check-in persistence through `localStorage` (`app/src/domain/checkinPersistence.ts`).
- Main-window ownership of real domain state, with Settings and check-in windows mirroring through the bridge.

Current server room state is intentionally in-memory and single-node. This feature should not turn rooms into the persistence mechanism.

## Approaches Considered

### Recommended: Account Cloud Snapshot

Store a versioned account data snapshot on the server, keyed by `userId`. The client pulls the snapshot after login/session restore, hydrates local stores, and pushes debounced snapshots after supported local data changes.

This matches the existing account architecture, keeps room sync separate from long-term persistence, and supports cross-device restoration.

### Alternative: Room-Owned Settings

Store Pomodoro settings and plans on rooms so everyone in the same room shares them.

This is useful for future shared focus rooms, but it conflicts with the current account-login direction and loses data when rooms expire. It also changes product behavior from "my settings" to "room settings".

### Alternative: Server Only For Pomodoro Durations

Save only focus duration, break duration, rounds, and auto-start-break.

This is easy but does not satisfy the request that plan settings also save to the server. It would leave users with a partial and surprising cloud sync.

## Selected Design

Use the account cloud snapshot approach.

The server stores one `CloudAccountData` record per account:

```ts
interface CloudAccountData {
    schemaVersion: 1;
    updatedAt: number;
    pomodoro: {
        focusDurationSeconds: number;
        breakDurationSeconds: number;
        totalRounds: number;
        autoStartBreak: boolean;
        endActionMode: 'topWindow' | 'playVideo';
        endActionVideo: {
            sourceKind: 'builtin' | 'custom';
            builtinVideoId: string;
            customVideoPath: string;
        };
    };
    settings: {
        uiScale: number;
        showActiveAppWindowTitle: boolean;
        autostartEnabled: boolean;
        autoPinOnFocusEnd: boolean;
    };
    checkin: {
        weeklyPlan: WeeklyCheckinPlan;
        dailyRecords: Record<string, DailyCheckinRecord>;
    };
}
```

The snapshot intentionally excludes volatile runtime state:

- current Pomodoro phase, remaining time, current round, running/paused state, and completed-focus streak;
- room code, remote players, account token, and server URL;
- active app, icons, key press counts, and transient bridge/window state.

These values either do not belong to account cloud storage or are unsafe to restore across machines.

## Server Architecture

Add a focused server module, `Server/src/UserDataStore.js`, responsible only for loading, validating, merging, and atomically saving account cloud snapshots.

Default file path:

```text
Server/data/user-data.json
```

Shape:

```json
{
  "users": {
    "user-id": {
      "schemaVersion": 1,
      "updatedAt": 1779360000000,
      "pomodoro": {},
      "settings": {},
      "checkin": {}
    }
  }
}
```

The store uses the same atomic temp-file-and-rename pattern as `AuthStore`. It normalizes every incoming snapshot through explicit whitelists so unknown fields cannot be persisted or later echoed back to clients.

The server remains single-node. The JSON store is a lightweight beta persistence layer, not a distributed database.

## Protocol

Keep `PROTOCOL_VERSION = 1` and add two authenticated WebSocket client messages:

- `user_data_get`: request the current account snapshot.
- `user_data_save`: send a full normalized snapshot plus `baseUpdatedAt`.

Add server messages:

- `user_data_snapshot`: `{ data: CloudAccountData | null }`
- `user_data_saved`: `{ updatedAt: number }`

Errors use the existing `error` message with new stable codes:

- `AUTH_REQUIRED`
- `INVALID_USER_DATA`
- `USER_DATA_CONFLICT`

Both new messages require an authenticated connection. If the connection has no `userId`, the server returns `AUTH_REQUIRED`.

## Client Architecture

Add a new domain helper rather than growing `network.ts` into a settings persistence module:

- `app/src/domain/cloudAccountData.ts`: types, normalization, snapshot builders, merge helpers, and equality helpers.
- `app/src/domain/cloudAccountSync.ts`: startup/login pull, local-change subscription, debounced save, and conflict handling.

The `network` store owns transport because it owns the WebSocket. It gets narrow actions:

- `requestUserData()`
- `saveUserData(snapshot, baseUpdatedAt)`

It also stores cloud-sync status:

```ts
type CloudSyncStatus = 'idle' | 'pulling' | 'saving' | 'synced' | 'offline' | 'conflict' | 'error';
```

Settings and check-in windows remain mirrors. They dispatch local store actions as they do today; the main window observes the authoritative stores and saves cloud snapshots.

## Data Flow

### Startup Without Account

1. Main window hydrates local settings and check-in data exactly as today.
2. Account restore runs.
3. If no saved session exists, cloud sync stays `idle`.
4. Local persistence remains active.

### Login Or Session Restore

1. Server returns `auth_ok`.
2. Client immediately sends `user_data_get`.
3. If the server returns `null`, the client uploads the current local snapshot.
4. If the server returns data, the client hydrates local stores from server data, then writes the same data to local persistence as offline cache.

### Local Changes

1. User applies Pomodoro settings, changes global settings, edits the check-in plan, or increments check-in records.
2. Existing local persistence writes continue.
3. Cloud sync observes the supported stores and schedules one save after a short debounce.
4. The client sends a full `user_data_save` snapshot with the last known server `updatedAt`.
5. Server validates and saves atomically, then replies `user_data_saved`.

Use a debounce of `500ms` for ordinary setting edits and `1500ms` for check-in count bursts. If implementation uses one shared debounce, use `1000ms`.

### Conflict Handling

The server rejects `user_data_save` when `baseUpdatedAt` is older than the current stored `updatedAt`.

On conflict:

1. Client requests the latest server snapshot.
2. Server snapshot wins for Pomodoro settings and global settings.
3. Check-in `weeklyPlan` uses the latest server plan.
4. Check-in `dailyRecords` merge per date:
   - for `countsByItemId`, keep the maximum count for each item id;
   - for `processedPomodoroEndEventIds`, keep the union of event ids;
   - keep records from either side when the other side has no date entry.
5. Client saves the merged snapshot back to the server.

This avoids losing completed check-ins while keeping plan editing simple.

## Field Behavior

Pomodoro settings saved to cloud:

- focus duration;
- break duration;
- total rounds;
- auto start break;
- end action mode;
- selected built-in video id;
- custom video path.

Custom video paths may not exist on another device. The cloud value still saves, but playback must keep the existing missing-file fallback behavior.

Global settings saved to cloud:

- UI scale;
- active app window title visibility;
- autostart setting;
- auto-pin-on-focus-end setting.

The autostart setting is cloud-synced as user intent, but startup still reads the native OS autostart state and reconciles it with the existing `readAutostartEnabled` behavior.

Check-in data saved to cloud:

- current `weeklyPlan`;
- all `dailyRecords` currently retained by the client.

## Offline Behavior

If cloud pull or save fails:

- Keep all local stores usable.
- Keep local persistence writes active.
- Set cloud sync status to `offline` or `error`.
- Retry on the next successful auth/session restore or explicit account action.
- Do not block the Pomodoro timer, settings apply button, today check-in panel, or plan editor.

Logging out stops cloud saves and leaves local cached data intact.

## UI

No new settings screen is required for this pass.

The Online tab can show a compact status line in the account card:

- `云同步中`
- `已同步`
- `离线保存中`
- `同步失败`
- `数据冲突已合并`

Do not add a modal or gate local settings behind account state. Logged-out users can keep using local settings.

## Testing

Server tests:

- `UserDataStore` returns `null` for users with no snapshot.
- `UserDataStore` saves and reloads a normalized snapshot.
- Unknown fields are dropped.
- Invalid Pomodoro/settings/check-in shapes are rejected with `INVALID_USER_DATA`.
- `user_data_get` and `user_data_save` require authentication.
- `user_data_save` returns `USER_DATA_CONFLICT` for stale `baseUpdatedAt`.

Frontend domain tests:

- Build a cloud snapshot from current Pomodoro, settings, and check-in stores.
- Hydrate stores from a server snapshot without restoring volatile timer runtime state.
- First login with no server data uploads current local data.
- Server data after login updates local stores and local persistence.
- Local setting/check-in changes trigger debounced cloud saves only when logged in.
- Conflict merge keeps max check-in counts and unions processed Pomodoro event ids.

Regression tests:

- Existing `network.ts` generation guard behavior remains covered.
- Existing local settings and check-in persistence tests still pass.
- Pomodoro accumulator and phase transition behavior are not changed by cloud hydration.

## Non-Goals

- No shared room settings.
- No historical weekly-plan archive.
- No database migration.
- No encryption-at-rest layer beyond the existing server file storage model.
- No password/account management changes.
- No migration of active app, icon cache, binding key counts, or remote-player state.

## Risks

- Saving full snapshots too often could create unnecessary WebSocket traffic. Debouncing and equality checks are required.
- Multi-device conflicts are possible. The selected conflict policy is deterministic and favors not losing check-in completions.
- Autostart is platform-native state. Cloud sync stores intent, but the client must still reconcile with native availability.
- Custom video paths are machine-local. Syncing them is useful on the same device profile but not guaranteed cross-device.

## Spec Self-Review

- Placeholder scan: no unresolved placeholders remain.
- Consistency check: server storage, protocol, client sync, and offline behavior all use one account-level snapshot model.
- Scope check: this is one implementation plan covering account cloud data persistence, not a room-sharing or database project.
- Ambiguity check: "settings and plan" means Pomodoro settings, global settings currently persisted locally, check-in weekly plan, and check-in daily records; volatile runtime state is explicitly excluded.
