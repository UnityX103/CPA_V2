# Local-First Settings Sync Design

**Date**: 2026-05-22
**Status**: Approved by user default policy
**Scope**: Persist every user-owned CPA_V2 setting locally first, then synchronize the same durable settings to account cloud data when logged in.

## Goal

CPA_V2 should keep all user-owned settings after app restart even when the user never logs in. When the user is logged in, the same durable settings should sync through the existing account cloud snapshot so another device can restore them. Local persistence is the first write target and offline source of truth; cloud sync is an optional replication layer.

## Current Context

The app already has several persistence paths:

- `settingsPersistence.ts` saves UI scale and autostart intent to Tauri store.
- `checkinPersistence.ts` saves weekly plans and daily records to `localStorage`.
- `appUpdatePersistence.ts` saves the updater auto-install toggle to Tauri store.
- `cloudAccountData.ts` saves Pomodoro, global settings, and check-in data to account cloud data when logged in.
- Pomodoro settings, network preferences, and binding-key settings are not fully restored locally after restart.

The main window is the authoritative domain owner. Settings, today check-in, check-in editor, input-counter, and remote-player windows mirror state through the bridge. This design keeps that model.

## Durable Settings

Persist and cloud-sync these user-owned settings:

- Pomodoro settings: focus duration, break duration, total rounds, auto-start break, end-action mode, built-in video id, and custom video path.
- Check-in settings: weekly plan, carry-forward flag, item definitions, icons, per-use metadata, and daily records.
- Global settings: committed UI scale and autostart intent.
- App update settings: automatic update enablement.
- Online settings: auto-connect preference and player display name.
- Binding-key settings: input-counter panel enabled, binding definitions, enabled flags, labels, bound keyboard/mouse inputs, and selected synced binding id.

Do not persist or cloud-sync these volatile or unsafe values:

- Account password, account token, and logged-in session metadata beyond the existing account session persistence.
- Current room membership, remote players, room snapshot, room connection status, and last transient network error.
- Pomodoro current phase, remaining seconds, running state, current round, pinned state, completed-focus streak, and last end event.
- Binding-key press counts, capture-in-progress id, permission state, listener health, listener diagnostics, and listener errors.
- App update status, current/available versions, release notes, last checked time, download/install state, and restart-ready state.
- Active app information and icons.

## Approaches Considered

### Recommended: Unified Local User Preferences Snapshot

Create a versioned local snapshot for durable user preferences and data, backed by Tauri store. Main-window startup hydrates from this snapshot before account cloud sync starts. Store subscriptions write local snapshots immediately and schedule cloud saves when logged in.

This makes the local-first rule explicit, avoids partial persistence scattered across UI components, and gives cloud sync one canonical payload.

### Alternative: Add A Separate Persistence File Per Store

Add `pomodoroPersistence`, `networkPreferencesPersistence`, and `bindingKeyPersistence` while keeping existing settings/check-in/update files.

This is lower-risk for individual modules, but it leaves startup ordering and cloud snapshot assembly spread across many effects. It also makes it easier for future settings to forget either local save or cloud save.

### Alternative: Cloud Snapshot Only With Local Cache After Login

Keep storing full settings only in account cloud data and use local cache only for logged-in users.

This fails the main requirement because logged-out users would still lose settings after restart.

## Selected Architecture

Add `app/src/domain/userPreferencesPersistence.ts` as the local-first durable snapshot boundary.

```ts
interface UserPreferencesSnapshot {
    schemaVersion: 1;
    pomodoro: {
        focusDurationSeconds: number;
        breakDurationSeconds: number;
        totalRounds: number;
        autoStartBreak: boolean;
        endActionMode: PomodoroEndActionMode;
        endActionVideo: PomodoroEndActionVideo;
    };
    settings: {
        uiScale: number;
        autostartEnabled: boolean;
    };
    appUpdate: {
        autoUpdateEnabled: boolean;
    };
    network: {
        autoConnect: boolean;
        playerName: string;
    };
    bindingKey: {
        panelEnabled: boolean;
        entries: PersistedBindingKeyEntry[];
        syncedKeyId: string | null;
    };
    checkin: {
        weeklyPlan: WeeklyCheckinPlan;
        dailyRecords: Record<string, DailyCheckinRecord>;
    };
}
```

The module validates and normalizes every field on load. Malformed sections fall back to current defaults for that section rather than preventing the whole app from starting.

Existing focused persistence modules can remain for compatibility during migration, but the unified snapshot becomes the canonical startup hydrate and save path for settings covered by this design. Compatibility loading should read older focused stores when the unified snapshot is absent.

## Client Data Flow

### Startup

1. Main window loads the unified local snapshot.
2. If no unified snapshot exists, it reads existing focused persistence files for compatibility: settings, check-in, and app update.
3. It hydrates authoritative stores in this order: settings, app update, Pomodoro, network preferences, binding-key preferences, check-in.
4. It reconciles native autostart with persisted autostart intent using the existing `readAutostartEnabled` behavior.
5. It rolls the check-in plan forward to the current week.
6. It writes a unified local snapshot after hydration so future launches use one path.
7. It starts account session restore and cloud sync only after local hydration completes.

### Local Changes

Store subscriptions in the main window observe durable fields. When any durable field changes:

1. Save the unified local snapshot immediately or after a short debounce.
2. If logged in, schedule the existing cloud save debounce.
3. Emit bridge snapshots to mirror windows as today.

Runtime-only changes such as timer ticks, press counts, listener health, update status, and active app changes must not trigger local preference writes.

### Login Or Cloud Pull

When cloud data arrives:

1. Normalize it using the same durable snapshot rules.
2. Hydrate local stores from cloud data.
3. Save the resulting snapshot to local storage.
4. Continue normal local-first writes for future changes.

If the server has no cloud data, upload the current local snapshot.

## Cloud Data Expansion

Extend `CloudAccountData` to include the same durable local fields:

```ts
interface CloudAccountData {
    schemaVersion: 1;
    updatedAt?: number;
    pomodoro: UserPreferencesSnapshot['pomodoro'];
    settings: UserPreferencesSnapshot['settings'];
    appUpdate: UserPreferencesSnapshot['appUpdate'];
    network: UserPreferencesSnapshot['network'];
    bindingKey: UserPreferencesSnapshot['bindingKey'];
    checkin: UserPreferencesSnapshot['checkin'];
}
```

Server normalization in `Server/src/UserDataStore.js` must whitelist the new sections and keep accepting existing v1 snapshots that only contain `pomodoro`, `settings`, and `checkin`. Missing new sections normalize to defaults.

## Conflict Handling

Keep the existing optimistic `baseUpdatedAt` conflict behavior.

On conflict:

- Server wins for Pomodoro settings, global settings, app update settings, network preferences, and binding-key settings.
- Check-in `weeklyPlan` uses the latest server plan.
- Check-in `dailyRecords` merge by date:
  - `countsByItemId` keeps the maximum count for each item id.
  - `processedPomodoroEndEventIds` keeps the union of event ids.
  - Records present on only one side are kept.

After merge, the client hydrates stores, saves the merged snapshot locally, and saves it back to cloud.

## UI Behavior

The Settings UI does not need new controls for this change.

The online tab's cloud status text already distinguishes local and cloud states. Logged-out users continue seeing local-save behavior. Logged-in users see cloud sync states. Failed cloud sync must not disable apply buttons, plan saving, Pomodoro controls, update toggles, or input binding edits.

The static `结束提示音` row remains non-persistent because it is not currently an editable setting.

## Error Handling

- If local load fails, use store defaults and log a warning.
- If local save fails, keep in-memory state and log a warning. User actions should still apply.
- If cloud save fails, keep local data and mark cloud sync `offline` or `error`.
- If a custom video path does not exist on another device, retain the selected path and let the existing playback fallback handle missing files.
- If a persisted binding input is malformed, drop that binding entry rather than crashing hydration.
- If `syncedKeyId` points to a missing binding entry, normalize it to `null`.

## Testing

Add or update tests for:

- Unified preference persistence loads valid snapshots and normalizes malformed snapshots.
- Compatibility startup reads older focused settings/check-in/app-update persistence when the unified snapshot is absent.
- Pomodoro settings survive app restart without login.
- Network auto-connect and player name survive app restart without login.
- Binding-key panel settings and bindings survive app restart without preserving press counts or capture state.
- App update auto-update setting survives through the unified snapshot.
- Cloud snapshot builder includes new durable sections.
- Cloud hydration writes new durable sections into stores without restoring volatile runtime state.
- Cloud conflict merge preserves check-in count maxima and uses server preferences for non-check-in settings.
- Server `UserDataStore` accepts old v1 cloud snapshots and normalizes new v1 snapshots with app update, network, and binding-key sections.

## Manual Verification

1. Change Pomodoro settings, input bindings, online nickname, auto-connect, app-update toggle, UI scale, and check-in plan while logged out.
2. Restart the app.
3. Confirm every durable setting restored.
4. Log in and wait for sync.
5. Start a second app instance or clear local data on another machine profile, log in, and confirm the same durable settings restore from cloud.
6. Confirm timer runtime state, input press counts, room membership, and update transient status did not restore.
