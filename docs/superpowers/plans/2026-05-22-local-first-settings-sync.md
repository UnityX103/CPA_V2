# Local-First Settings Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every durable CPA_V2 user setting save locally first and sync through account cloud data when logged in.

**Architecture:** Add a single versioned user-preferences snapshot for local persistence, reuse that snapshot shape for cloud account data, and hydrate the authoritative main-window stores before cloud session restore. Mirror windows continue to receive bridge snapshots and dispatch mutations to the main window.

**Tech Stack:** React, TypeScript, Zustand, Tauri plugin-store, Vitest, Node.js WebSocket server tests.

---

### Task 1: Add Durable User Preference Snapshot

**Files:**
- Create: `app/src/domain/userPreferences.ts`
- Create: `app/src/domain/userPreferencesPersistence.ts`
- Test: `app/src/domain/userPreferencesPersistence.test.ts`

- [ ] Define `UserPreferencesSnapshot` with `pomodoro`, `settings`, `appUpdate`, `network`, `bindingKey`, and `checkin` sections.
- [ ] Implement `buildUserPreferencesSnapshot(stores)` so it excludes timer runtime state, room state, update status, binding capture state, listener state, and binding press counts.
- [ ] Implement `hydrateUserPreferencesSnapshot({ stores, snapshot })` so it restores only durable fields and clears volatile binding capture state.
- [ ] Implement `normalizeUserPreferencesSnapshot(value)` and Tauri-store load/save helpers for `user-preferences.json`.
- [ ] Write tests for valid snapshots, malformed snapshots, dropping press counts, and normalizing missing `syncedKeyId`.

### Task 2: Hydrate Local Preferences Before Cloud Sync

**Files:**
- Modify: `app/src/App.tsx`
- Modify: `app/src/domain/appUpdate.ts` if a narrow durable hydrate helper is useful.
- Test: `app/src/App.test.tsx`

- [ ] Replace the split startup effects with one local-hydration path that loads unified preferences first.
- [ ] If unified preferences are absent, read old focused stores: settings, check-in, and app-update settings.
- [ ] Reconcile autostart with `readAutostartEnabled`.
- [ ] Hydrate Pomodoro, settings, app update, network preferences, binding-key preferences, and check-in.
- [ ] Roll check-in forward to today and save a unified snapshot.
- [ ] Start account session restore and `useCloudAccountSync` only after local hydration completes.
- [ ] Subscribe to durable store signatures and save unified preferences whenever durable fields change.
- [ ] Test logged-out restart restoration for Pomodoro, network preferences, binding keys, app update, and check-in compatibility.

### Task 3: Extend Cloud Account Data

**Files:**
- Modify: `app/src/domain/cloudAccountData.ts`
- Modify: `app/src/domain/cloudAccountSync.ts`
- Test: `app/src/domain/cloudAccountData.test.ts`
- Test: `app/src/domain/cloudAccountSync.test.tsx`

- [ ] Expand `CloudAccountData` with `appUpdate`, `network`, and `bindingKey`.
- [ ] Reuse user-preference snapshot builders for cloud snapshot creation and hydration.
- [ ] Save a local unified snapshot after applying cloud data.
- [ ] Keep server preferences as conflict winner for non-check-in sections and keep the existing check-in daily-record merge.
- [ ] Test that cloud build/hydrate includes new durable fields and still avoids volatile runtime fields.

### Task 4: Extend Bridge Snapshots If Needed

**Files:**
- Modify: `app/src/domain/bridge/host.ts`
- Modify: `app/src/domain/bridge/client.ts`
- Modify: `app/src/domain/bridge/protocol.ts`
- Test: `app/src/domain/bridge/host.test.ts`
- Test: `app/src/domain/bridge/client.test.ts`
- Test: `app/src/domain/bridge/protocol.test.ts`

- [ ] Confirm bridge snapshots already include the durable fields used by settings, app update, network, binding-key, Pomodoro, and check-in UI.
- [ ] Update tests if cloud/local preference shape changes require stricter clone assertions.
- [ ] Do not add volatile local-only fields to mirror snapshots.

### Task 5: Extend Server Cloud Snapshot Validation

**Files:**
- Modify: `Server/src/UserDataStore.js`
- Test: `Server/test/user-data-store.test.js`

- [ ] Normalize `appUpdate`, `network`, and `bindingKey` sections.
- [ ] Accept older v1 snapshots missing the new sections by filling defaults.
- [ ] Keep rejecting malformed required legacy sections.
- [ ] Strip binding press counts and invalid binding inputs.
- [ ] Normalize `syncedKeyId` to `null` if the entry no longer exists.
- [ ] Test old snapshot compatibility and new snapshot persistence.

### Task 6: Verification

**Files:**
- No source changes unless verification exposes defects.

- [ ] Install app dependencies if `node_modules` is missing: `cd app && npm install`.
- [ ] Run focused client tests: `cd app && npm test -- --run src/domain/userPreferencesPersistence.test.ts src/domain/cloudAccountData.test.ts src/App.test.tsx`.
- [ ] Run bridge tests if touched: `cd app && npm test -- --run src/domain/bridge/host.test.ts src/domain/bridge/client.test.ts src/domain/bridge/protocol.test.ts`.
- [ ] Run server tests: `cd Server && npm test`.
- [ ] Run app build: `cd app && npm run build`.
- [ ] Report any tests that cannot run with the exact failure.
