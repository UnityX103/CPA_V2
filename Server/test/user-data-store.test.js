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
    return {
        path,
        store: new UserDataStore({
            filePath: path,
            now: () => 1779360000000
        })
    };
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
        appUpdate: {
            autoUpdateEnabled: false
        },
        network: {
            autoConnect: true,
            playerName: 'Alice'
        },
        bindingKey: {
            panelEnabled: false,
            entries: [{
                id: 'space',
                label: 'Space',
                keyCode: 49,
                input: { kind: 'keyboard', code: 49 },
                enabled: true,
                pressCount: 99
            }],
            syncedKeyId: 'space'
        },
        checkin: {
            weeklyPlan: {
                weekStartDate: '2026-05-18',
                carryToNextWeek: true,
                days: {
                    mon: {
                        kind: 'items',
                        items: [{
                            id: 'pomodoro-focus',
                            title: '专注番茄',
                            type: 'pomodoroFocus',
                            targetCount: 4,
                            icon: 'clock',
                            perUseAmount: 25,
                            perUseUnit: '分钟'
                        }]
                    },
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
    assert.deepEqual(loaded.settings, { uiScale: 1, autostartEnabled: false });
    assert.deepEqual(loaded.appUpdate, { autoUpdateEnabled: false });
    assert.deepEqual(loaded.network, { autoConnect: true, playerName: 'Alice' });
    assert.deepEqual(loaded.bindingKey, {
        panelEnabled: false,
        entries: [{
            id: 'space',
            label: 'Space',
            keyCode: 49,
            input: { kind: 'keyboard', code: 49 },
            enabled: true
        }],
        syncedKeyId: 'space'
    });

    const raw = JSON.parse(await readFile(path, 'utf8'));
    assert.equal(raw.users['user-1'].pomodoro.focusDurationSeconds, 1500);
});

test('UserDataStore accepts old v1 snapshots without newer preference sections', async (t) =>
{
    const { store } = await createTempStore(t);
    const oldSnapshot = validSnapshot();
    delete oldSnapshot.appUpdate;
    delete oldSnapshot.network;
    delete oldSnapshot.bindingKey;

    const saved = await store.saveUserData({
        userId: 'user-1',
        data: oldSnapshot,
        baseUpdatedAt: null
    });

    assert.deepEqual(saved.appUpdate, { autoUpdateEnabled: true });
    assert.deepEqual(saved.network, { autoConnect: false, playerName: '我' });
    assert.deepEqual(saved.bindingKey, { panelEnabled: true, entries: [], syncedKeyId: null });
});

test('UserDataStore drops invalid binding entries and clears missing syncedKeyId', async (t) =>
{
    const { store } = await createTempStore(t);
    const saved = await store.saveUserData({
        userId: 'user-1',
        data: validSnapshot({
            bindingKey: {
                panelEnabled: true,
                entries: [
                    { id: 'ok', label: 'OK', keyCode: -1, input: null, enabled: true },
                    { id: 'bad', label: 'Bad', keyCode: 1, input: { kind: 'keyboard', code: -5 }, enabled: true }
                ],
                syncedKeyId: 'bad'
            }
        }),
        baseUpdatedAt: null
    });

    assert.deepEqual(saved.bindingKey, {
        panelEnabled: true,
        entries: [{ id: 'ok', label: 'OK', keyCode: -1, input: null, enabled: true }],
        syncedKeyId: null
    });
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
