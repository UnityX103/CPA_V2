# Pomodoro Cloud Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Save Pomodoro settings, global settings, and check-in plan data to the CPA_V2 server under the logged-in account while preserving offline local use.

**Architecture:** Add a server-side `UserDataStore` for account snapshots, extend the existing WebSocket protocol with authenticated `user_data_get` and `user_data_save` messages, and add a client cloud sync layer that builds, hydrates, debounces, and conflict-merges snapshots. Local persistence remains active and acts as the offline cache.

**Tech Stack:** Node.js `node:test`, `ws`, React, TypeScript, Zustand, Vitest, Tauri store, existing bridge protocol.

---

## File Structure

- Create `Server/src/UserDataStore.js`: file-backed account snapshot storage, schema normalization, atomic writes, stale-save conflict detection.
- Create `Server/test/user-data-store.test.js`: unit tests for normalization, persistence, unknown-field stripping, invalid data, and conflict handling.
- Modify `Server/src/protocol.js`: parse new cloud messages and encode new server replies.
- Modify `Server/src/index.js`: instantiate `UserDataStore`, handle cloud messages, require authenticated connections.
- Modify `Server/test/protocol.test.js`: protocol coverage for `user_data_get` and `user_data_save`.
- Modify `Server/test/integration.test.js`: authenticated get/save flow and unauthenticated rejection.
- Create `app/src/domain/cloudAccountData.ts`: cloud snapshot types, snapshot builders, hydration helpers, equality, conflict merge.
- Create `app/src/domain/cloudAccountData.test.ts`: pure client data tests.
- Create `app/src/domain/cloudAccountSync.ts`: React hook that pulls after login, observes local changes, debounces saves, handles conflicts.
- Create `app/src/domain/cloudAccountSync.test.tsx`: hook-level save/pull/debounce tests.
- Modify `app/src/domain/network.ts`: add transport state/actions for cloud data messages and message handling.
- Modify `app/src/domain/network.test.ts`: transport tests for new messages and status transitions.
- Modify `app/src/App.tsx`: mount `useCloudAccountSync`.
- Modify `app/src/App.test.tsx`: assert sync hook is mounted.
- Modify `app/src/ui/SettingsPanel.tsx`: show compact cloud sync status in the account card.
- Modify `app/src/ui/SettingsPanel.css`: small status-line styling.
- Modify `app/src/ui/SettingsPanel.test.tsx`: UI coverage for status copy.

## Task 1: Server UserDataStore

**Files:**
- Create: `Server/src/UserDataStore.js`
- Create: `Server/test/user-data-store.test.js`

- [ ] **Step 1: Write failing UserDataStore tests**

Create `Server/test/user-data-store.test.js`:

```js
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { UserDataStore, UserDataStoreError } from '../src/UserDataStore.js';

async function createTempStore(t)
{
    const dir = await mkdtemp(join(tmpdir(), 'cpa-user-data-'));
    const path = join(dir, 'user-data.json');
    t.after(async () =>
    {
        await rm(dir, { recursive: true, force: true });
    });
    return { path, store: new UserDataStore({ filePath: path, now: () => 1779360000000 }) };
}

function validSnapshot(overrides = {})
{
    return {
        schemaVersion: 1,
        pomodoro: {
            focusDurationSeconds: 1500,
            breakDurationSeconds: 300,
            totalRounds: 4,
            autoStartBreak: false,
            endActionMode: 'playVideo',
            endActionVideo: {
                sourceKind: 'builtin',
                builtinVideoId: 'default',
                customVideoPath: ''
            }
        },
        settings: {
            uiScale: 1,
            showActiveAppWindowTitle: true,
            autostartEnabled: false,
            autoPinOnFocusEnd: true
        },
        checkin: {
            weeklyPlan: {
                weekStartDate: '2026-05-18',
                carryToNextWeek: true,
                days: {
                    mon: { kind: 'items', items: [{ id: 'pomodoro-focus', title: '专注番茄', type: 'pomodoroFocus', targetCount: 4, icon: 'clock', perUseAmount: 25, perUseUnit: '分钟' }] },
                    tue: { kind: 'inherit' },
                    wed: { kind: 'inherit' },
                    thu: { kind: 'inherit' },
                    fri: { kind: 'inherit' },
                    sat: { kind: 'inherit' },
                    sun: { kind: 'rest' }
                }
            },
            dailyRecords: {
                '2026-05-21': {
                    date: '2026-05-21',
                    countsByItemId: { 'pomodoro-focus': 2 },
                    processedPomodoroEndEventIds: [1, 2]
                }
            }
        },
        ...overrides
    };
}

test('UserDataStore returns null when a user has no snapshot', async (t) =>
{
    const { store } = await createTempStore(t);
    assert.equal(await store.getUserData('user-1'), null);
});

test('UserDataStore saves, normalizes, and reloads a snapshot', async (t) =>
{
    const { path, store } = await createTempStore(t);
    const saved = await store.saveUserData({
        userId: 'user-1',
        data: {
            ...validSnapshot(),
            unknown: 'strip-me',
            pomodoro: { ...validSnapshot().pomodoro, extra: 'strip-me' }
        },
        baseUpdatedAt: null
    });

    assert.equal(saved.updatedAt, 1779360000000);
    const loaded = await store.getUserData('user-1');
    assert.equal(loaded.updatedAt, 1779360000000);
    assert.equal(Object.hasOwn(loaded, 'unknown'), false);
    assert.equal(Object.hasOwn(loaded.pomodoro, 'extra'), false);

    const raw = JSON.parse(await readFile(path, 'utf8'));
    assert.equal(raw.users['user-1'].pomodoro.focusDurationSeconds, 1500);
});

test('UserDataStore rejects invalid snapshots', async (t) =>
{
    const { store } = await createTempStore(t);
    await assert.rejects(
        () => store.saveUserData({
            userId: 'user-1',
            data: validSnapshot({ pomodoro: { focusDurationSeconds: 'bad' } }),
            baseUpdatedAt: null
        }),
        (error) => error instanceof UserDataStoreError && error.code === 'INVALID_USER_DATA'
    );
});

test('UserDataStore rejects stale saves with USER_DATA_CONFLICT', async (t) =>
{
    const { store } = await createTempStore(t);
    await store.saveUserData({ userId: 'user-1', data: validSnapshot(), baseUpdatedAt: null });

    await assert.rejects(
        () => store.saveUserData({ userId: 'user-1', data: validSnapshot(), baseUpdatedAt: 1 }),
        (error) => error instanceof UserDataStoreError && error.code === 'USER_DATA_CONFLICT'
    );
});
```

- [ ] **Step 2: Run the failing server test**

Run:

```bash
cd Server && node --test test/user-data-store.test.js
```

Expected: FAIL with `Cannot find module '../src/UserDataStore.js'`.

- [ ] **Step 3: Create UserDataStore**

Create `Server/src/UserDataStore.js`:

```js
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const DEFAULT_FILE_PATH = join(process.cwd(), 'data', 'user-data.json');
const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const CHECKIN_ITEM_ICONS = new Set([
    'activity', 'dumbbell', 'bookOpen', 'droplet', 'listChecks', 'sparkle',
    'coffee', 'moon', 'sun', 'leaf', 'music', 'pencil', 'target', 'flame',
    'heart', 'apple', 'clock', 'meditation'
]);

export class UserDataStoreError extends Error
{
    constructor(code, message)
    {
        super(message);
        this.code = code;
    }
}

export class UserDataStore
{
    constructor(options = {})
    {
        this._filePath = options.filePath ?? DEFAULT_FILE_PATH;
        this._now = options.now ?? (() => Date.now());
        this._data = null;
        this._writeChain = Promise.resolve();
    }

    async getUserData(userId)
    {
        const normalizedUserId = normalizeUserId(userId);
        const data = await this._load();
        const snapshot = data.users[normalizedUserId];
        return snapshot ? cloneSnapshot(snapshot) : null;
    }

    async saveUserData({ userId, data, baseUpdatedAt })
    {
        const normalizedUserId = normalizeUserId(userId);
        const fileData = await this._load();
        const current = fileData.users[normalizedUserId] ?? null;
        if (
            current &&
            baseUpdatedAt !== null &&
            baseUpdatedAt !== undefined &&
            Number.isInteger(baseUpdatedAt) &&
            baseUpdatedAt < current.updatedAt
        )
        {
            throw new UserDataStoreError('USER_DATA_CONFLICT', '云端数据已更新');
        }

        const normalized = {
            ...normalizeSnapshot(data),
            updatedAt: this._now()
        };
        fileData.users[normalizedUserId] = normalized;
        await this._save(fileData);
        return cloneSnapshot(normalized);
    }

    async _load()
    {
        if (this._data) return this._data;
        try
        {
            const parsed = JSON.parse(await readFile(this._filePath, 'utf8'));
            this._data = normalizeDataFile(parsed);
        }
        catch
        {
            this._data = { users: {} };
        }
        return this._data;
    }

    async _save(data)
    {
        this._writeChain = this._writeChain.then(async () =>
        {
            await mkdir(dirname(this._filePath), { recursive: true });
            const tempPath = `${this._filePath}.${process.pid}.${Date.now()}.tmp`;
            await writeFile(tempPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
            await rename(tempPath, this._filePath);
        });
        await this._writeChain;
    }
}

function normalizeUserId(userId)
{
    if (typeof userId !== 'string' || !userId.trim())
    {
        throw new UserDataStoreError('AUTH_REQUIRED', '账号未登录');
    }
    return userId.trim();
}

function normalizeDataFile(value)
{
    if (!value || typeof value !== 'object' || !value.users || typeof value.users !== 'object')
    {
        return { users: {} };
    }
    const users = {};
    for (const [userId, snapshot] of Object.entries(value.users))
    {
        try
        {
            users[userId] = normalizeStoredSnapshot(snapshot);
        }
        catch
        {
            continue;
        }
    }
    return { users };
}

function normalizeStoredSnapshot(value)
{
    if (!value || typeof value !== 'object' || !Number.isInteger(value.updatedAt))
    {
        throw new UserDataStoreError('INVALID_USER_DATA', '云端数据格式不正确');
    }
    return { ...normalizeSnapshot(value), updatedAt: value.updatedAt };
}

function normalizeSnapshot(value)
{
    if (!value || typeof value !== 'object' || value.schemaVersion !== 1)
    {
        throw new UserDataStoreError('INVALID_USER_DATA', '云端数据格式不正确');
    }
    return {
        schemaVersion: 1,
        pomodoro: normalizePomodoro(value.pomodoro),
        settings: normalizeSettings(value.settings),
        checkin: normalizeCheckin(value.checkin)
    };
}

function normalizePomodoro(value)
{
    if (!value || typeof value !== 'object')
    {
        throw new UserDataStoreError('INVALID_USER_DATA', '番茄设置缺失');
    }
    const endActionMode = value.endActionMode === 'topWindow' || value.endActionMode === 'playVideo'
        ? value.endActionMode
        : null;
    if (!endActionMode || !value.endActionVideo || typeof value.endActionVideo !== 'object')
    {
        throw new UserDataStoreError('INVALID_USER_DATA', '番茄结束动作不正确');
    }
    const sourceKind = value.endActionVideo.sourceKind === 'custom' ? 'custom' : 'builtin';
    return {
        focusDurationSeconds: normalizePositiveInteger(value.focusDurationSeconds),
        breakDurationSeconds: normalizeNonNegativeInteger(value.breakDurationSeconds),
        totalRounds: normalizePositiveInteger(value.totalRounds),
        autoStartBreak: Boolean(value.autoStartBreak),
        endActionMode,
        endActionVideo: {
            sourceKind,
            builtinVideoId: clampString(value.endActionVideo.builtinVideoId, 128),
            customVideoPath: clampString(value.endActionVideo.customVideoPath, 1024)
        }
    };
}

function normalizeSettings(value)
{
    if (!value || typeof value !== 'object')
    {
        throw new UserDataStoreError('INVALID_USER_DATA', '设置缺失');
    }
    return {
        uiScale: clampNumber(value.uiScale, 0.5, 2),
        showActiveAppWindowTitle: Boolean(value.showActiveAppWindowTitle),
        autostartEnabled: Boolean(value.autostartEnabled),
        autoPinOnFocusEnd: Boolean(value.autoPinOnFocusEnd)
    };
}

function normalizeCheckin(value)
{
    if (!value || typeof value !== 'object')
    {
        throw new UserDataStoreError('INVALID_USER_DATA', '计划缺失');
    }
    return {
        weeklyPlan: normalizeWeeklyPlan(value.weeklyPlan),
        dailyRecords: normalizeDailyRecords(value.dailyRecords)
    };
}

function normalizeWeeklyPlan(value)
{
    if (!value || typeof value !== 'object' || !value.days || typeof value.days !== 'object')
    {
        throw new UserDataStoreError('INVALID_USER_DATA', '周计划格式不正确');
    }
    const days = {};
    for (const day of WEEKDAYS)
    {
        days[day] = normalizeDayPlan(value.days[day]);
    }
    return {
        weekStartDate: clampString(value.weekStartDate, 32),
        carryToNextWeek: Boolean(value.carryToNextWeek),
        days
    };
}

function normalizeDayPlan(value)
{
    if (!value || typeof value !== 'object')
    {
        throw new UserDataStoreError('INVALID_USER_DATA', '日计划格式不正确');
    }
    if (value.kind === 'inherit' || value.kind === 'rest') return { kind: value.kind };
    if (value.kind !== 'items' || !Array.isArray(value.items))
    {
        throw new UserDataStoreError('INVALID_USER_DATA', '日计划项目格式不正确');
    }
    return { kind: 'items', items: value.items.map(normalizeCheckinItem) };
}

function normalizeCheckinItem(value)
{
    if (!value || typeof value !== 'object')
    {
        throw new UserDataStoreError('INVALID_USER_DATA', '计划项格式不正确');
    }
    if (value.type !== 'manual' && value.type !== 'pomodoroFocus')
    {
        throw new UserDataStoreError('INVALID_USER_DATA', '计划项类型不正确');
    }
    const icon = typeof value.icon === 'string' && CHECKIN_ITEM_ICONS.has(value.icon)
        ? value.icon
        : undefined;
    return stripUndefinedFields({
        id: clampString(value.id, 128),
        title: clampString(value.title, 128),
        type: value.type,
        targetCount: normalizePositiveInteger(value.targetCount),
        icon,
        perUseAmount: value.perUseAmount === undefined ? undefined : Math.max(0, Number(value.perUseAmount) || 0),
        perUseUnit: value.perUseUnit === undefined ? undefined : clampString(value.perUseUnit, 32)
    });
}

function normalizeDailyRecords(value)
{
    if (!value || typeof value !== 'object' || Array.isArray(value))
    {
        throw new UserDataStoreError('INVALID_USER_DATA', '打卡记录格式不正确');
    }
    return Object.fromEntries(
        Object.entries(value).map(([date, record]) => [clampString(date, 32), normalizeDailyRecord(record)])
    );
}

function normalizeDailyRecord(value)
{
    if (!value || typeof value !== 'object' || !value.countsByItemId || typeof value.countsByItemId !== 'object')
    {
        throw new UserDataStoreError('INVALID_USER_DATA', '打卡记录格式不正确');
    }
    return {
        date: clampString(value.date, 32),
        countsByItemId: Object.fromEntries(
            Object.entries(value.countsByItemId).map(([id, count]) => [
                clampString(id, 128),
                Math.max(0, Number.isFinite(count) ? Number(count) : 0)
            ])
        ),
        processedPomodoroEndEventIds: Array.isArray(value.processedPomodoroEndEventIds)
            ? value.processedPomodoroEndEventIds.filter(Number.isInteger)
            : []
    };
}

function normalizePositiveInteger(value)
{
    if (!Number.isInteger(value) || value < 1)
    {
        throw new UserDataStoreError('INVALID_USER_DATA', '数值必须为正整数');
    }
    return value;
}

function normalizeNonNegativeInteger(value)
{
    if (!Number.isInteger(value) || value < 0)
    {
        throw new UserDataStoreError('INVALID_USER_DATA', '数值必须为非负整数');
    }
    return value;
}

function clampNumber(value, min, max)
{
    if (typeof value !== 'number' || !Number.isFinite(value))
    {
        throw new UserDataStoreError('INVALID_USER_DATA', '数值格式不正确');
    }
    return Math.max(min, Math.min(max, value));
}

function clampString(value, maxLength)
{
    return typeof value === 'string' ? value.slice(0, maxLength) : '';
}

function stripUndefinedFields(value)
{
    return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}

function cloneSnapshot(snapshot)
{
    return JSON.parse(JSON.stringify(snapshot));
}
```

- [ ] **Step 4: Run UserDataStore tests**

Run:

```bash
cd Server && node --test test/user-data-store.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit server store**

```bash
git add Server/src/UserDataStore.js Server/test/user-data-store.test.js
git commit -m "feat(server): add account user data store"
```

## Task 2: Server Protocol And WebSocket Handlers

**Files:**
- Modify: `Server/src/protocol.js`
- Modify: `Server/src/index.js`
- Modify: `Server/test/protocol.test.js`
- Modify: `Server/test/integration.test.js`

- [ ] **Step 1: Add failing protocol tests**

Append to `Server/test/protocol.test.js`:

```js
test('parseClientMessage accepts user_data_get', () =>
{
    const message = parseClientMessage(JSON.stringify({
        v: PROTOCOL_VERSION,
        type: 'user_data_get'
    }));

    assert.deepEqual(message, { v: PROTOCOL_VERSION, type: 'user_data_get' });
});

test('parseClientMessage accepts user_data_save with baseUpdatedAt', () =>
{
    const message = parseClientMessage(JSON.stringify({
        v: PROTOCOL_VERSION,
        type: 'user_data_save',
        baseUpdatedAt: 1779360000000,
        data: {
            schemaVersion: 1,
            pomodoro: {
                focusDurationSeconds: 1500,
                breakDurationSeconds: 300,
                totalRounds: 4,
                autoStartBreak: false,
                endActionMode: 'playVideo',
                endActionVideo: { sourceKind: 'builtin', builtinVideoId: 'default', customVideoPath: '' }
            },
            settings: {
                uiScale: 1,
                showActiveAppWindowTitle: true,
                autostartEnabled: false,
                autoPinOnFocusEnd: true
            },
            checkin: {
                weeklyPlan: {
                    weekStartDate: '2026-05-18',
                    carryToNextWeek: true,
                    days: {
                        mon: { kind: 'items', items: [] },
                        tue: { kind: 'inherit' },
                        wed: { kind: 'inherit' },
                        thu: { kind: 'inherit' },
                        fri: { kind: 'inherit' },
                        sat: { kind: 'inherit' },
                        sun: { kind: 'rest' }
                    }
                },
                dailyRecords: {}
            }
        }
    }));

    assert.equal(message.type, 'user_data_save');
    assert.equal(message.baseUpdatedAt, 1779360000000);
    assert.equal(message.data.schemaVersion, 1);
});
```

- [ ] **Step 2: Run protocol tests to verify failure**

Run:

```bash
cd Server && node --test test/protocol.test.js
```

Expected: FAIL with `UNSUPPORTED_MESSAGE` for `user_data_get`.

- [ ] **Step 3: Extend protocol parsing and response builders**

In `Server/src/protocol.js`, add `user_data_get` and `user_data_save` to `SUPPORTED_CLIENT_MESSAGE_TYPES`. Add switch cases:

```js
        case 'user_data_get':
            return {
                v: PROTOCOL_VERSION,
                type: 'user_data_get'
            };

        case 'user_data_save':
            return {
                v: PROTOCOL_VERSION,
                type: 'user_data_save',
                baseUpdatedAt: normalizeOptionalUpdatedAt(parsedMessage.baseUpdatedAt),
                data: normalizeUserDataPayload(parsedMessage.data)
            };
```

Add server message builders:

```js
export function createUserDataSnapshotMessage({ data })
{
    return {
        type: 'user_data_snapshot',
        data: data ?? null
    };
}

export function createUserDataSavedMessage({ updatedAt })
{
    return {
        type: 'user_data_saved',
        updatedAt
    };
}
```

Add helpers near the other normalizers:

```js
function normalizeOptionalUpdatedAt(value)
{
    if (value === null || value === undefined) return null;
    if (!Number.isInteger(value))
    {
        throw new ProtocolError('INVALID_USER_DATA', 'baseUpdatedAt 必须是整数或 null');
    }
    return value;
}

function normalizeUserDataPayload(value)
{
    if (!value || typeof value !== 'object')
    {
        throw new ProtocolError('INVALID_USER_DATA', '云端数据必须是对象');
    }
    return value;
}
```

- [ ] **Step 4: Wire WebSocket handlers**

In `Server/src/index.js`, import the new store and message builders:

```js
import { UserDataStore, UserDataStoreError } from './UserDataStore.js';
import {
    createUserDataSavedMessage,
    createUserDataSnapshotMessage
} from './protocol.js';
```

Create the store in `createPomodoroServer`:

```js
    const userDataStore = options.userDataStore ?? new UserDataStore({
        filePath: options.userDataFilePath
    });
```

Pass `userDataStore` into `handleMessage` context:

```js
                    userDataStore,
```

Add cases in `handleMessage`:

```js
        case 'user_data_get':
            await handleUserDataGet(context);
            return;

        case 'user_data_save':
            await handleUserDataSave(message, context);
            return;
```

Add handlers:

```js
async function handleUserDataGet(context)
{
    ensureAuthenticated(context.connection);
    const data = await context.userDataStore.getUserData(context.connection.userId);
    safeSend(context.connection.socket, createUserDataSnapshotMessage({ data }));
}

async function handleUserDataSave(message, context)
{
    ensureAuthenticated(context.connection);
    const saved = await context.userDataStore.saveUserData({
        userId: context.connection.userId,
        data: message.data,
        baseUpdatedAt: message.baseUpdatedAt
    });
    safeSend(context.connection.socket, createUserDataSavedMessage({ updatedAt: saved.updatedAt }));
}
```

Update `handleKnownError` so `UserDataStoreError` maps to `error`:

```js
    if (error instanceof UserDataStoreError)
    {
        safeSend(socket, createErrorMessage(error.code));
        return;
    }
```

- [ ] **Step 5: Add integration tests**

Append to `Server/test/integration.test.js` using the existing helpers `createTestServer`, `openClient`, `createMessageCollector`, `authClient`, and `sendJson`:

```js
test('authenticated clients can save and load user data', async (t) =>
{
    const app = await createTestServer(t);
    t.after(() => app.close());

    const ws = await openClient(app.url);
    const inbox = createMessageCollector(ws);
    t.after(() => ws.close());

    await authClient(ws, inbox, 'cloud-sync-a');

    sendJson(ws, {
        type: 'user_data_save',
        baseUpdatedAt: null,
        data: validUserDataPayload()
    });
    const saved = await inbox.waitFor('user_data_saved');
    assert.equal(Number.isInteger(saved.updatedAt), true);

    sendJson(ws, { type: 'user_data_get' });
    const snapshot = await inbox.waitFor('user_data_snapshot');
    assert.equal(snapshot.data.pomodoro.focusDurationSeconds, 1500);
});

test('user_data_get requires authentication', async (t) =>
{
    const app = await createTestServer(t);
    t.after(() => app.close());

    const ws = await openClient(app.url);
    const inbox = createMessageCollector(ws);
    t.after(() => ws.close());

    sendJson(ws, { type: 'user_data_get' });
    const error = await inbox.waitFor('error');
    assert.equal(error.error, 'AUTH_REQUIRED');
});
```

Add this helper beside `authClient`:

```js
function validUserDataPayload()
{
    return {
        schemaVersion: 1,
        pomodoro: {
            focusDurationSeconds: 1500,
            breakDurationSeconds: 300,
            totalRounds: 4,
            autoStartBreak: false,
            endActionMode: 'playVideo',
            endActionVideo: { sourceKind: 'builtin', builtinVideoId: 'default', customVideoPath: '' }
        },
        settings: {
            uiScale: 1,
            showActiveAppWindowTitle: true,
            autostartEnabled: false,
            autoPinOnFocusEnd: true
        },
        checkin: {
            weeklyPlan: {
                weekStartDate: '2026-05-18',
                carryToNextWeek: true,
                days: {
                    mon: { kind: 'items', items: [] },
                    tue: { kind: 'inherit' },
                    wed: { kind: 'inherit' },
                    thu: { kind: 'inherit' },
                    fri: { kind: 'inherit' },
                    sat: { kind: 'inherit' },
                    sun: { kind: 'rest' }
                }
            },
            dailyRecords: {}
        }
    };
}
```

- [ ] **Step 6: Run server tests**

Run:

```bash
cd Server && npm test
```

Expected: PASS.

- [ ] **Step 7: Commit server protocol**

```bash
git add Server/src/protocol.js Server/src/index.js Server/test/protocol.test.js Server/test/integration.test.js
git commit -m "feat(server): add account cloud data messages"
```

## Task 3: Client CloudAccountData Pure Module

**Files:**
- Create: `app/src/domain/cloudAccountData.ts`
- Create: `app/src/domain/cloudAccountData.test.ts`

- [ ] **Step 1: Write failing cloud data tests**

Create `app/src/domain/cloudAccountData.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createPomodoroStore } from './pomodoro';
import { createSettingsStore } from './settings';
import { createCheckinStore, defaultWeeklyPlan } from './checkin';
import {
    buildCloudAccountData,
    hydrateCloudAccountData,
    mergeCloudAccountDataConflict,
} from './cloudAccountData';

describe('cloudAccountData', () => {
    it('builds a snapshot from pomodoro, settings, and checkin stores', () => {
        const pomodoro = createPomodoroStore({ isSettingsWindow: false });
        const settings = createSettingsStore({ isSettingsWindow: false });
        const checkin = createCheckinStore({ isMirrorWindow: false });

        pomodoro.getState().applySettings(1200, 180, 3, true, true);
        settings.getState().setShowActiveAppWindowTitle(false);
        checkin.getState().setWeeklyPlan(defaultWeeklyPlan('2026-05-18'));

        const snapshot = buildCloudAccountData({ pomodoro, settings, checkin });

        expect(snapshot.schemaVersion).toBe(1);
        expect(snapshot.pomodoro.focusDurationSeconds).toBe(1200);
        expect(snapshot.settings.showActiveAppWindowTitle).toBe(false);
        expect(snapshot.checkin.weeklyPlan.weekStartDate).toBe('2026-05-18');
    });

    it('hydrates settings without restoring volatile timer runtime state', () => {
        const pomodoro = createPomodoroStore({ isSettingsWindow: false });
        const settings = createSettingsStore({ isSettingsWindow: false });
        const checkin = createCheckinStore({ isMirrorWindow: false });
        pomodoro.getState().start();

        hydrateCloudAccountData({
            stores: { pomodoro, settings, checkin },
            data: {
                schemaVersion: 1,
                updatedAt: 10,
                pomodoro: {
                    focusDurationSeconds: 600,
                    breakDurationSeconds: 60,
                    totalRounds: 2,
                    autoStartBreak: true,
                    endActionMode: 'topWindow',
                    endActionVideo: { sourceKind: 'builtin', builtinVideoId: 'default', customVideoPath: '' },
                },
                settings: {
                    uiScale: 1.5,
                    showActiveAppWindowTitle: false,
                    autostartEnabled: false,
                    autoPinOnFocusEnd: false,
                },
                checkin: {
                    weeklyPlan: defaultWeeklyPlan('2026-05-18'),
                    dailyRecords: {},
                },
            },
        });

        expect(pomodoro.getState().focusDurationSeconds).toBe(600);
        expect(pomodoro.getState().isRunning).toBe(true);
        expect(settings.getState().uiScale).toBe(1.5);
        expect(checkin.getState().weeklyPlan.weekStartDate).toBe('2026-05-18');
    });

    it('merges conflicting daily records by max counts and event id union', () => {
        const server = {
            schemaVersion: 1 as const,
            updatedAt: 100,
            pomodoro: {
                focusDurationSeconds: 1500,
                breakDurationSeconds: 300,
                totalRounds: 4,
                autoStartBreak: false,
                endActionMode: 'playVideo' as const,
                endActionVideo: { sourceKind: 'builtin' as const, builtinVideoId: 'default', customVideoPath: '' },
            },
            settings: {
                uiScale: 1,
                showActiveAppWindowTitle: true,
                autostartEnabled: false,
                autoPinOnFocusEnd: true,
            },
            checkin: {
                weeklyPlan: defaultWeeklyPlan('2026-05-18'),
                dailyRecords: {
                    '2026-05-21': {
                        date: '2026-05-21',
                        countsByItemId: { a: 1, b: 4 },
                        processedPomodoroEndEventIds: [1, 3],
                    },
                },
            },
        };
        const local = {
            ...server,
            updatedAt: 99,
            checkin: {
                weeklyPlan: defaultWeeklyPlan('2026-05-18'),
                dailyRecords: {
                    '2026-05-21': {
                        date: '2026-05-21',
                        countsByItemId: { a: 3, c: 2 },
                        processedPomodoroEndEventIds: [2, 3],
                    },
                },
            },
        };

        const merged = mergeCloudAccountDataConflict({ server, local });

        expect(merged.checkin.dailyRecords['2026-05-21'].countsByItemId).toEqual({ a: 3, b: 4, c: 2 });
        expect(merged.checkin.dailyRecords['2026-05-21'].processedPomodoroEndEventIds).toEqual([1, 3, 2]);
    });
});
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
cd app && npx vitest run src/domain/cloudAccountData.test.ts
```

Expected: FAIL with missing `cloudAccountData` module.

- [ ] **Step 3: Create cloudAccountData module**

Create `app/src/domain/cloudAccountData.ts`:

```ts
import type { StoreApi, UseBoundStore } from 'zustand';
import type { CheckinState, DailyCheckinRecord, WeeklyCheckinPlan } from './checkin';
import type { PomodoroActions, PomodoroEndActionMode, PomodoroEndActionVideo, PomodoroState } from './pomodoro';
import type { SettingsState } from './settings';

export interface CloudAccountData {
    schemaVersion: 1;
    updatedAt?: number;
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
        showActiveAppWindowTitle: boolean;
        autostartEnabled: boolean;
        autoPinOnFocusEnd: boolean;
    };
    checkin: {
        weeklyPlan: WeeklyCheckinPlan;
        dailyRecords: Record<string, DailyCheckinRecord>;
    };
}

type PomodoroStore = UseBoundStore<StoreApi<PomodoroState & PomodoroActions>>;
type SettingsStore = UseBoundStore<StoreApi<SettingsState & { hydrateSettings: (snapshot: {
    uiScale: number;
    showActiveAppWindowTitle?: boolean;
    autostartEnabled?: boolean;
    autoPinOnFocusEnd?: boolean;
}) => void }>>;
type CheckinStore = UseBoundStore<StoreApi<CheckinState & {
    hydrateCheckin: (snapshot: Pick<CheckinState, 'weeklyPlan' | 'dailyRecords'>) => void;
}>>;

export interface CloudStores {
    pomodoro: PomodoroStore;
    settings: SettingsStore;
    checkin: CheckinStore;
}

export function buildCloudAccountData(stores: CloudStores): CloudAccountData {
    const p = stores.pomodoro.getState();
    const s = stores.settings.getState();
    const c = stores.checkin.getState();
    return {
        schemaVersion: 1,
        pomodoro: {
            focusDurationSeconds: p.focusDurationSeconds,
            breakDurationSeconds: p.breakDurationSeconds,
            totalRounds: p.totalRounds,
            autoStartBreak: p.autoStartBreak,
            endActionMode: p.endActionMode,
            endActionVideo: { ...p.endActionVideo },
        },
        settings: {
            uiScale: s.committedUiScale,
            showActiveAppWindowTitle: s.showActiveAppWindowTitle,
            autostartEnabled: s.autostartEnabled,
            autoPinOnFocusEnd: s.autoPinOnFocusEnd,
        },
        checkin: {
            weeklyPlan: cloneWeeklyPlan(c.weeklyPlan),
            dailyRecords: cloneDailyRecords(c.dailyRecords),
        },
    };
}

export function hydrateCloudAccountData({ stores, data }: { stores: CloudStores; data: CloudAccountData }): void {
    stores.pomodoro.getState().applySettings(
        data.pomodoro.focusDurationSeconds,
        data.pomodoro.breakDurationSeconds,
        data.pomodoro.totalRounds,
        false,
        data.pomodoro.autoStartBreak,
    );
    stores.pomodoro.getState().applyEndActionSettings(data.pomodoro.endActionMode, data.pomodoro.endActionVideo);
    stores.settings.getState().hydrateSettings(data.settings);
    stores.checkin.getState().hydrateCheckin({
        weeklyPlan: cloneWeeklyPlan(data.checkin.weeklyPlan),
        dailyRecords: cloneDailyRecords(data.checkin.dailyRecords),
    });
}

export function mergeCloudAccountDataConflict({ server, local }: {
    server: CloudAccountData;
    local: CloudAccountData;
}): CloudAccountData {
    return {
        ...server,
        checkin: {
            weeklyPlan: cloneWeeklyPlan(server.checkin.weeklyPlan),
            dailyRecords: mergeDailyRecords(server.checkin.dailyRecords, local.checkin.dailyRecords),
        },
    };
}

export function cloudAccountDataKey(data: CloudAccountData): string {
    const { updatedAt: _updatedAt, ...payload } = data;
    return JSON.stringify(payload);
}

function mergeDailyRecords(
    server: Record<string, DailyCheckinRecord>,
    local: Record<string, DailyCheckinRecord>,
): Record<string, DailyCheckinRecord> {
    const dates = new Set([...Object.keys(server), ...Object.keys(local)]);
    const result: Record<string, DailyCheckinRecord> = {};
    for (const date of dates) {
        const a = server[date];
        const b = local[date];
        if (!a) {
            result[date] = cloneDailyRecord(b);
            continue;
        }
        if (!b) {
            result[date] = cloneDailyRecord(a);
            continue;
        }
        const ids = new Set([...Object.keys(a.countsByItemId), ...Object.keys(b.countsByItemId)]);
        const countsByItemId: Record<string, number> = {};
        for (const id of ids) {
            countsByItemId[id] = Math.max(a.countsByItemId[id] ?? 0, b.countsByItemId[id] ?? 0);
        }
        result[date] = {
            date,
            countsByItemId,
            processedPomodoroEndEventIds: [
                ...a.processedPomodoroEndEventIds,
                ...b.processedPomodoroEndEventIds.filter((id) => !a.processedPomodoroEndEventIds.includes(id)),
            ],
        };
    }
    return result;
}

function cloneWeeklyPlan(plan: WeeklyCheckinPlan): WeeklyCheckinPlan {
    return JSON.parse(JSON.stringify(plan)) as WeeklyCheckinPlan;
}

function cloneDailyRecord(record: DailyCheckinRecord): DailyCheckinRecord {
    return {
        date: record.date,
        countsByItemId: { ...record.countsByItemId },
        processedPomodoroEndEventIds: [...record.processedPomodoroEndEventIds],
    };
}

function cloneDailyRecords(records: Record<string, DailyCheckinRecord>): Record<string, DailyCheckinRecord> {
    return Object.fromEntries(Object.entries(records).map(([date, record]) => [date, cloneDailyRecord(record)]));
}
```

- [ ] **Step 4: Run cloudAccountData tests**

Run:

```bash
cd app && npx vitest run src/domain/cloudAccountData.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit client data module**

```bash
git add app/src/domain/cloudAccountData.ts app/src/domain/cloudAccountData.test.ts
git commit -m "feat(app): add cloud account data helpers"
```

## Task 4: Network Transport For Cloud Data

**Files:**
- Modify: `app/src/domain/network.ts`
- Modify: `app/src/domain/network.test.ts`

- [ ] **Step 1: Add failing network tests**

Add tests to `app/src/domain/network.test.ts` near the existing auth tests:

```ts
function sentMessages(socket: FakeWebSocket | undefined) {
    return socket?.sent.map((raw) => JSON.parse(raw)) ?? [];
}

function makeCloudSnapshot() {
    return {
        schemaVersion: 1,
        updatedAt: 10,
        pomodoro: {
            focusDurationSeconds: 1500,
            breakDurationSeconds: 300,
            totalRounds: 4,
            autoStartBreak: false,
            endActionMode: 'playVideo',
            endActionVideo: { sourceKind: 'builtin', builtinVideoId: 'default', customVideoPath: '' },
        },
        settings: {
            uiScale: 1,
            showActiveAppWindowTitle: true,
            autostartEnabled: false,
            autoPinOnFocusEnd: true,
        },
        checkin: {
            weeklyPlan: {
                weekStartDate: '2026-05-18',
                carryToNextWeek: true,
                days: {
                    mon: { kind: 'items', items: [] },
                    tue: { kind: 'inherit' },
                    wed: { kind: 'inherit' },
                    thu: { kind: 'inherit' },
                    fri: { kind: 'inherit' },
                    sat: { kind: 'inherit' },
                    sun: { kind: 'rest' },
                },
            },
            dailyRecords: {},
        },
    };
}

it('requests user data after auth_ok and handles user_data_snapshot', async () => {
    const snapshot = makeCloudSnapshot();

    await useNetworkStore.getState().login('Alice', 'secret');
    await new Promise((r) => setTimeout(r, 5));
    const socket = latestSocket();
    expect(sentMessages(socket)).toContainEqual({ v: 1, type: 'auth_login', username: 'Alice', password: 'secret' });

    socket?.onmessage?.({
        data: JSON.stringify({ v: 1, type: 'auth_ok', user: { userId: 'u1', username: 'Alice' }, token: 'token' }),
    } as MessageEvent);
    expect(sentMessages(socket)).toContainEqual({ v: 1, type: 'user_data_get' });

    socket?.onmessage?.({
        data: JSON.stringify({ v: 1, type: 'user_data_snapshot', data: snapshot }),
    } as MessageEvent);
    expect(useNetworkStore.getState().cloudData).toEqual(snapshot);
    expect(useNetworkStore.getState().cloudSyncStatus).toBe('synced');
});

it('sends user_data_save with the current baseUpdatedAt', async () => {
    const snapshot = makeCloudSnapshot();

    await useNetworkStore.getState().login('Alice', 'secret');
    await new Promise((r) => setTimeout(r, 5));
    const socket = latestSocket();
    socket?.onmessage?.({
        data: JSON.stringify({ v: 1, type: 'auth_ok', user: { userId: 'u1', username: 'Alice' }, token: 'token' }),
    } as MessageEvent);
    socket?.sent.splice(0);
    useNetworkStore.setState({ cloudDataUpdatedAt: 10 });

    useNetworkStore.getState().saveUserData(snapshot, 10);

    expect(sentMessages(socket)).toContainEqual({
        v: 1,
        type: 'user_data_save',
        baseUpdatedAt: 10,
        data: snapshot,
    });
});
```

- [ ] **Step 2: Run network tests to verify failure**

Run:

```bash
cd app && npx vitest run src/domain/network.test.ts
```

Expected: FAIL because `cloudData`, `cloudSyncStatus`, `requestUserData`, and `saveUserData` do not exist.

- [ ] **Step 3: Extend network types and initial state**

In `app/src/domain/network.ts`, import the type:

```ts
import type { CloudAccountData } from './cloudAccountData';
```

Add:

```ts
export type CloudSyncStatus = 'idle' | 'pulling' | 'saving' | 'synced' | 'offline' | 'conflict' | 'error';
```

Extend `NetworkStateShape`:

```ts
    cloudSyncStatus: CloudSyncStatus;
    cloudData: CloudAccountData | null;
    cloudDataUpdatedAt: number | null;
    cloudError: string | null;
```

Extend `NetworkActions`:

```ts
    requestUserData: () => void;
    saveUserData: (data: CloudAccountData, baseUpdatedAt: number | null) => void;
```

Add to `INITIAL_STATE`:

```ts
    cloudSyncStatus: 'idle',
    cloudData: null,
    cloudDataUpdatedAt: null,
    cloudError: null,
```

- [ ] **Step 4: Handle cloud messages and actions**

In `handleMessage`, add:

```ts
                    case 'user_data_snapshot': {
                        const data = msg.data ?? null;
                        set({
                            cloudSyncStatus: 'synced',
                            cloudData: data,
                            cloudDataUpdatedAt: data?.updatedAt ?? null,
                            cloudError: null,
                        });
                        break;
                    }
                    case 'user_data_saved': {
                        const updatedAt = Number.isInteger(msg.updatedAt) ? msg.updatedAt : null;
                        set({
                            cloudSyncStatus: 'synced',
                            cloudDataUpdatedAt: updatedAt,
                            cloudError: null,
                        });
                        break;
                    }
```

In the existing `auth_ok` case, after saving the token, request user data on the authenticated socket:

```ts
                        send(internal.socket, { type: 'user_data_get' });
                        set({ cloudSyncStatus: 'pulling' });
```

In `error` handling, add before generic account handling:

```ts
                        if (error === 'USER_DATA_CONFLICT') {
                            set({ cloudSyncStatus: 'conflict', cloudError: error, lastError: error });
                            break;
                        }
                        if (error === 'INVALID_USER_DATA') {
                            set({ cloudSyncStatus: 'error', cloudError: error, lastError: error });
                            break;
                        }
```

Add main-window actions:

```ts
            requestUserData: () => {
                if (get().accountStatus !== 'loggedIn') return;
                const didSend = send(internal.socket, { type: 'user_data_get' });
                set({ cloudSyncStatus: didSend ? 'pulling' : 'offline', cloudError: didSend ? null : 'CONNECTION_ERROR' });
            },
            saveUserData: (data, baseUpdatedAt) => {
                if (get().accountStatus !== 'loggedIn') return;
                const didSend = send(internal.socket, {
                    type: 'user_data_save',
                    baseUpdatedAt,
                    data,
                });
                set({
                    cloudSyncStatus: didSend ? 'saving' : 'offline',
                    cloudError: didSend ? null : 'CONNECTION_ERROR',
                });
            },
```

Add settings-window no-op dispatching actions if the TypeScript store requires them. The settings window should not perform real cloud saves.

- [ ] **Step 5: Run network tests**

Run:

```bash
cd app && npx vitest run src/domain/network.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit network transport**

```bash
git add app/src/domain/network.ts app/src/domain/network.test.ts
git commit -m "feat(app): add cloud data network transport"
```

## Task 5: Cloud Sync Hook And App Integration

**Files:**
- Create: `app/src/domain/cloudAccountSync.ts`
- Create: `app/src/domain/cloudAccountSync.test.tsx`
- Modify: `app/src/App.tsx`
- Modify: `app/src/App.test.tsx`

- [ ] **Step 1: Write failing hook tests**

Create `app/src/domain/cloudAccountSync.test.tsx`:

```tsx
import { renderHook, act } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useCloudAccountSync } from './cloudAccountSync';
import { useNetworkStore } from './network';
import { usePomodoroStore } from './pomodoro';
import { defaultWeeklyPlan, useCheckinStore } from './checkin';

vi.useFakeTimers();

describe('useCloudAccountSync', () => {
    beforeEach(() => {
        useNetworkStore.setState({
            accountStatus: 'guest',
            cloudData: null,
            cloudDataUpdatedAt: null,
            cloudSyncStatus: 'idle',
        });
        usePomodoroStore.setState({
            focusDurationSeconds: 1500,
            breakDurationSeconds: 300,
            totalRounds: 4,
            autoStartBreak: false,
        });
        useCheckinStore.getState().hydrateCheckin({
            weeklyPlan: defaultWeeklyPlan('2026-05-18'),
            dailyRecords: {},
        });
    });

    it('uploads local data when login returns no server snapshot', () => {
        const save = vi.spyOn(useNetworkStore.getState(), 'saveUserData');
        renderHook(() => useCloudAccountSync());

        act(() => {
            useNetworkStore.setState({
                accountStatus: 'loggedIn',
                accountUser: { userId: 'u1', username: 'Alice' },
                cloudData: null,
                cloudDataUpdatedAt: null,
                cloudSyncStatus: 'synced',
            });
        });

        expect(save).toHaveBeenCalledWith(expect.objectContaining({ schemaVersion: 1 }), null);
    });

    it('hydrates from server data and does not immediately echo-save it', () => {
        const save = vi.spyOn(useNetworkStore.getState(), 'saveUserData');
        renderHook(() => useCloudAccountSync());

        act(() => {
            useNetworkStore.setState({
                accountStatus: 'loggedIn',
                accountUser: { userId: 'u1', username: 'Alice' },
                cloudData: {
                    schemaVersion: 1,
                    updatedAt: 10,
                    pomodoro: {
                        focusDurationSeconds: 600,
                        breakDurationSeconds: 60,
                        totalRounds: 2,
                        autoStartBreak: true,
                        endActionMode: 'topWindow',
                        endActionVideo: { sourceKind: 'builtin', builtinVideoId: 'default', customVideoPath: '' },
                    },
                    settings: {
                        uiScale: 1,
                        showActiveAppWindowTitle: true,
                        autostartEnabled: false,
                        autoPinOnFocusEnd: true,
                    },
                    checkin: {
                        weeklyPlan: defaultWeeklyPlan('2026-05-18'),
                        dailyRecords: {},
                    },
                },
                cloudDataUpdatedAt: 10,
                cloudSyncStatus: 'synced',
            });
        });

        expect(usePomodoroStore.getState().focusDurationSeconds).toBe(600);
        expect(save).not.toHaveBeenCalled();
    });

    it('debounces local changes while logged in', () => {
        const save = vi.spyOn(useNetworkStore.getState(), 'saveUserData');
        renderHook(() => useCloudAccountSync());
        act(() => {
            useNetworkStore.setState({
                accountStatus: 'loggedIn',
                accountUser: { userId: 'u1', username: 'Alice' },
                cloudData: null,
                cloudDataUpdatedAt: null,
                cloudSyncStatus: 'synced',
            });
            save.mockClear();
            usePomodoroStore.getState().applySettings(900, 120, 4, true, false);
            vi.advanceTimersByTime(999);
        });
        expect(save).not.toHaveBeenCalled();

        act(() => {
            vi.advanceTimersByTime(1);
        });
        expect(save).toHaveBeenCalledTimes(1);
    });
});
```

- [ ] **Step 2: Run failing hook tests**

Run:

```bash
cd app && npx vitest run src/domain/cloudAccountSync.test.tsx
```

Expected: FAIL with missing `cloudAccountSync` module.

- [ ] **Step 3: Create cloudAccountSync hook**

Create `app/src/domain/cloudAccountSync.ts`:

```ts
import { useEffect, useRef } from 'react';
import { buildCloudAccountData, cloudAccountDataKey, hydrateCloudAccountData } from './cloudAccountData';
import { useCheckinStore } from './checkin';
import { useNetworkStore } from './network';
import { usePomodoroStore } from './pomodoro';
import { useSettingsStore } from './settings';

const SAVE_DEBOUNCE_MS = 1000;

export function useCloudAccountSync() {
    const hydratingRef = useRef(false);
    const lastAppliedCloudKeyRef = useRef('');
    const lastSavedLocalKeyRef = useRef('');
    const saveTimerRef = useRef<number | null>(null);

    useEffect(() => {
        const stores = {
            pomodoro: usePomodoroStore,
            settings: useSettingsStore,
            checkin: useCheckinStore,
        };

        const clearTimer = () => {
            if (saveTimerRef.current != null) {
                window.clearTimeout(saveTimerRef.current);
                saveTimerRef.current = null;
            }
        };

        const saveNow = () => {
            const net = useNetworkStore.getState();
            if (net.accountStatus !== 'loggedIn') return;
            const snapshot = buildCloudAccountData(stores);
            const key = cloudAccountDataKey(snapshot);
            if (key === lastSavedLocalKeyRef.current || key === lastAppliedCloudKeyRef.current) return;
            lastSavedLocalKeyRef.current = key;
            net.saveUserData(snapshot, net.cloudDataUpdatedAt);
        };

        const scheduleSave = () => {
            if (hydratingRef.current) return;
            if (useNetworkStore.getState().accountStatus !== 'loggedIn') return;
            clearTimer();
            saveTimerRef.current = window.setTimeout(saveNow, SAVE_DEBOUNCE_MS);
        };

        const unsubNetwork = useNetworkStore.subscribe((state, previous) => {
            if (state.accountStatus !== 'loggedIn') {
                clearTimer();
                lastAppliedCloudKeyRef.current = '';
                lastSavedLocalKeyRef.current = '';
                return;
            }

            const cloudChanged = state.cloudData !== previous.cloudData;
            if (!cloudChanged) return;

            if (!state.cloudData) {
                saveNow();
                return;
            }

            hydratingRef.current = true;
            hydrateCloudAccountData({ stores, data: state.cloudData });
            lastAppliedCloudKeyRef.current = cloudAccountDataKey(state.cloudData);
            lastSavedLocalKeyRef.current = lastAppliedCloudKeyRef.current;
            hydratingRef.current = false;
        });

        const unsubPomodoro = usePomodoroStore.subscribe((s, p) => {
            if (
                s.focusDurationSeconds !== p.focusDurationSeconds ||
                s.breakDurationSeconds !== p.breakDurationSeconds ||
                s.totalRounds !== p.totalRounds ||
                s.autoStartBreak !== p.autoStartBreak ||
                s.endActionMode !== p.endActionMode ||
                s.endActionVideo !== p.endActionVideo
            ) {
                scheduleSave();
            }
        });
        const unsubSettings = useSettingsStore.subscribe((s, p) => {
            if (
                s.committedUiScale !== p.committedUiScale ||
                s.showActiveAppWindowTitle !== p.showActiveAppWindowTitle ||
                s.autostartEnabled !== p.autostartEnabled ||
                s.autoPinOnFocusEnd !== p.autoPinOnFocusEnd
            ) {
                scheduleSave();
            }
        });
        const unsubCheckin = useCheckinStore.subscribe((s, p) => {
            if (s.weeklyPlan !== p.weeklyPlan || s.dailyRecords !== p.dailyRecords) {
                scheduleSave();
            }
        });

        return () => {
            clearTimer();
            unsubNetwork();
            unsubPomodoro();
            unsubSettings();
            unsubCheckin();
        };
    }, []);
}
```

- [ ] **Step 4: Mount sync hook in App**

In `app/src/App.tsx`, import and call it:

```ts
import { useCloudAccountSync } from './domain/cloudAccountSync';
```

Inside `App()` near `useStateSync()`:

```ts
    useCloudAccountSync();
```

In `app/src/App.test.tsx`, mock it with the other hooks:

```ts
const useCloudAccountSync = vi.fn();
vi.mock('./domain/cloudAccountSync', () => ({ useCloudAccountSync }));
```

Add assertion to the startup test:

```ts
expect(useCloudAccountSync).toHaveBeenCalledTimes(1);
```

- [ ] **Step 5: Run hook and app tests**

Run:

```bash
cd app && npx vitest run src/domain/cloudAccountSync.test.tsx src/App.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit sync hook**

```bash
git add app/src/domain/cloudAccountSync.ts app/src/domain/cloudAccountSync.test.tsx app/src/App.tsx app/src/App.test.tsx
git commit -m "feat(app): sync cloud account data"
```

## Task 6: Local Persistence Coordination

**Files:**
- Modify: `app/src/domain/cloudAccountSync.ts`
- Modify: `app/src/domain/cloudAccountSync.test.tsx`
- Modify: `app/src/App.tsx`

- [ ] **Step 1: Add failing persistence coordination test**

Extend `app/src/domain/cloudAccountSync.test.tsx`:

```tsx
it('does not save default local data before startup hydration has completed', () => {
    const save = vi.spyOn(useNetworkStore.getState(), 'saveUserData');
    renderHook(() => useCloudAccountSync({ enabled: false }));

    act(() => {
        useNetworkStore.setState({
            accountStatus: 'loggedIn',
            accountUser: { userId: 'u1', username: 'Alice' },
            cloudData: null,
            cloudDataUpdatedAt: null,
            cloudSyncStatus: 'synced',
        });
    });

    expect(save).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run test to verify failure**

Run:

```bash
cd app && npx vitest run src/domain/cloudAccountSync.test.tsx
```

Expected: FAIL because `useCloudAccountSync` does not accept an options object.

- [ ] **Step 3: Add enabled gate**

Change signature in `app/src/domain/cloudAccountSync.ts`:

```ts
export function useCloudAccountSync(opts: { enabled?: boolean } = {}) {
    const enabled = opts.enabled ?? true;
```

At the top of the main `useEffect` body:

```ts
        if (!enabled) return () => {};
```

Add `enabled` to the effect dependency array:

```ts
    }, [enabled]);
```

In `app/src/App.tsx`, pass `settingsHydrated` so cloud sync starts after local settings/check-in hydration has had a chance to run:

```ts
    useCloudAccountSync({ enabled: settingsHydrated });
```

- [ ] **Step 4: Run app and hook tests**

Run:

```bash
cd app && npx vitest run src/domain/cloudAccountSync.test.tsx src/App.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit hydration gate**

```bash
git add app/src/domain/cloudAccountSync.ts app/src/domain/cloudAccountSync.test.tsx app/src/App.tsx app/src/App.test.tsx
git commit -m "fix(app): start cloud sync after local hydration"
```

## Task 7: Settings UI Cloud Status

**Files:**
- Modify: `app/src/ui/SettingsPanel.tsx`
- Modify: `app/src/ui/SettingsPanel.css`
- Modify: `app/src/ui/SettingsPanel.test.tsx`

- [ ] **Step 1: Add failing UI test**

Add to `app/src/ui/SettingsPanel.test.tsx` near online account tests:

```tsx
it('renders cloud sync status in the logged-in account card', () => {
    useSettingsStore.setState({ activeTab: 'online' });
    useNetworkStore.setState({
        accountStatus: 'loggedIn',
        accountUser: { userId: 'u1', username: 'Alice' },
        accountToken: 'token',
        cloudSyncStatus: 'saving',
        cloudError: null,
    });

    render(<SettingsPanel />);

    expect(screen.getByText('云同步中')).toBeInTheDocument();
});
```

- [ ] **Step 2: Run failing UI test**

Run:

```bash
cd app && npx vitest run src/ui/SettingsPanel.test.tsx
```

Expected: FAIL because `云同步中` is not rendered.

- [ ] **Step 3: Add status copy helper**

In `app/src/ui/SettingsPanel.tsx`, add:

```ts
function cloudSyncStatusText(status: ReturnType<typeof useNetworkStore.getState>['cloudSyncStatus']): string {
    switch (status) {
        case 'pulling':
        case 'saving':
            return '云同步中';
        case 'synced':
            return '已同步';
        case 'offline':
            return '离线保存中';
        case 'conflict':
            return '数据冲突已合并';
        case 'error':
            return '同步失败';
        default:
            return '本地保存';
    }
}
```

Inside the logged-in account summary, render:

```tsx
                            <span className="cloud-sync-status">
                                {cloudSyncStatusText(net.cloudSyncStatus)}
                            </span>
```

- [ ] **Step 4: Add styling**

In `app/src/ui/SettingsPanel.css`, add:

```css
.cloud-sync-status {
    width: 100%;
    font-size: 12px;
    color: var(--font-secondary);
    line-height: 1.3;
}
```

- [ ] **Step 5: Run UI tests**

Run:

```bash
cd app && npx vitest run src/ui/SettingsPanel.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit UI status**

```bash
git add app/src/ui/SettingsPanel.tsx app/src/ui/SettingsPanel.css app/src/ui/SettingsPanel.test.tsx
git commit -m "feat(app): show cloud sync status"
```

## Task 8: Full Verification

**Files:**
- Modify only files required by failures from the commands below.

- [ ] **Step 1: Run all app tests**

Run:

```bash
cd app && npm test
```

Expected: PASS.

- [ ] **Step 2: Run app build**

Run:

```bash
cd app && npm run build
```

Expected: PASS with Vite build output and no TypeScript errors.

- [ ] **Step 3: Run all server tests**

Run:

```bash
cd Server && npm test
```

Expected: PASS.

- [ ] **Step 4: Manual smoke test with local server**

Start the server:

```bash
cd Server && npm start
```

In another terminal, start the frontend:

```bash
cd app && npm run dev
```

Manual expected behavior:

- create or log into an account from Settings > 联机;
- account card shows `已同步` after the first server round trip;
- changing Pomodoro settings eventually returns to `已同步`;
- editing the check-in plan eventually returns to `已同步`;
- restarting the app and logging in restores server values.

- [ ] **Step 5: Commit verification fixes when the commands above required code changes**

Run this after making verification fixes:

```bash
git add app Server
git commit -m "fix: stabilize cloud settings sync"
```

When the verification commands pass without code changes, skip this commit step.

## Self-Review

- Spec coverage: the plan covers server storage, protocol, client snapshot helpers, sync lifecycle, startup hydration coordination, status UI, conflict behavior through pure merge helpers, and verification.
- Placeholder scan: no unresolved requirement markers remain.
- Type consistency: `CloudAccountData`, `cloudSyncStatus`, `cloudData`, `cloudDataUpdatedAt`, `requestUserData`, and `saveUserData` use the same names across tasks.
- Scope check: this plan implements account-level cloud snapshots only; room-shared settings, databases, and account-management changes are outside this feature.
