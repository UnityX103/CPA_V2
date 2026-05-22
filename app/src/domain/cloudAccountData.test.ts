import { describe, expect, it } from 'vitest';
import { create } from 'zustand';
import { createPomodoroStore } from './pomodoro';
import { createSettingsStore } from './settings';
import { createCheckinStore, defaultWeeklyPlan } from './checkin';
import {
    buildCloudAccountData,
    hydrateCloudAccountData,
    mergeCloudAccountDataConflict,
} from './cloudAccountData';

function makeCloudStores() {
    return {
        pomodoro: createPomodoroStore({ isSettingsWindow: false }),
        settings: createSettingsStore({ isSettingsWindow: false }),
        appUpdate: create<any>(() => ({
            autoUpdateEnabled: true,
            status: 'idle',
            currentVersion: null,
            availableVersion: null,
            releaseNotes: null,
            lastCheckedAt: null,
            errorMessage: null,
        })),
        network: create<any>(() => ({
            status: 'idle',
            serverUrl: 'ws://127.0.0.1:8039',
            autoConnect: false,
            roomCode: '',
            playerName: '我',
            playerId: null,
            players: {},
            lastError: null,
            accountStatus: 'guest',
            accountUser: null,
            accountToken: null,
            accountError: null,
            cloudSyncStatus: 'idle',
            cloudData: null,
            cloudDataUpdatedAt: null,
            cloudError: null,
        })),
        bindingKey: create<any>(() => ({
            panelEnabled: true,
            entries: [],
            syncedKeyId: null,
            capturingId: null,
        })),
        checkin: createCheckinStore({ isMirrorWindow: false }),
    };
}

function cloudSnapshot(overrides = {}) {
    return {
        schemaVersion: 1 as const,
        updatedAt: 10,
        pomodoro: {
            focusDurationSeconds: 600,
            breakDurationSeconds: 60,
            totalRounds: 2,
            autoStartBreak: true,
            endActionMode: 'topWindow' as const,
            endActionVideo: { sourceKind: 'builtin' as const, builtinVideoId: 'default', customVideoPath: '' },
        },
        settings: {
            uiScale: 1.5,
            autostartEnabled: false,
        },
        appUpdate: {
            autoUpdateEnabled: false,
        },
        network: {
            autoConnect: true,
            playerName: 'Alice',
        },
        bindingKey: {
            panelEnabled: false,
            entries: [{
                id: 'space',
                label: 'Space',
                keyCode: 49,
                input: { kind: 'keyboard' as const, code: 49 },
                enabled: true,
            }],
            syncedKeyId: 'space',
        },
        checkin: {
            weeklyPlan: defaultWeeklyPlan('2026-05-18'),
            dailyRecords: {},
        },
        ...overrides,
    };
}

describe('cloudAccountData', () => {
    it('builds a snapshot from durable local preference stores', () => {
        const stores = makeCloudStores();
        const { pomodoro, settings, checkin, appUpdate, network, bindingKey } = stores;

        pomodoro.getState().applySettings(1200, 180, 3, true, true);
        settings.getState().hydrateSettings({ uiScale: 1.25, autostartEnabled: true });
        appUpdate.setState({ autoUpdateEnabled: false, status: 'readyToRestart' });
        network.setState({ autoConnect: true, playerName: 'Alice', roomCode: 'ROOM-1' });
        bindingKey.setState({
            panelEnabled: false,
            entries: [{
                id: 'space',
                label: 'Space',
                keyCode: 49,
                input: { kind: 'keyboard', code: 49 },
                pressCount: 99,
                enabled: true,
            }],
            syncedKeyId: 'space',
            capturingId: 'space',
        });
        checkin.getState().setWeeklyPlan(defaultWeeklyPlan('2026-05-18'));

        const snapshot = buildCloudAccountData(stores);

        expect(snapshot.schemaVersion).toBe(1);
        expect(snapshot.pomodoro.focusDurationSeconds).toBe(1200);
        expect(snapshot.settings).toEqual({ uiScale: 1.25, autostartEnabled: true });
        expect(snapshot.appUpdate).toEqual({ autoUpdateEnabled: false });
        expect(snapshot.network).toEqual({ autoConnect: true, playerName: 'Alice' });
        expect(snapshot.bindingKey.entries[0]).not.toHaveProperty('pressCount');
        expect(snapshot.checkin.weeklyPlan.weekStartDate).toBe('2026-05-18');
    });

    it('hydrates settings without restoring volatile timer runtime state', () => {
        const stores = makeCloudStores();
        const { pomodoro, settings, checkin, appUpdate, network, bindingKey } = stores;
        pomodoro.getState().start();

        hydrateCloudAccountData({
            stores,
            data: cloudSnapshot(),
        });

        expect(pomodoro.getState().focusDurationSeconds).toBe(600);
        expect(pomodoro.getState().isRunning).toBe(true);
        expect(settings.getState().uiScale).toBe(1.5);
        expect(appUpdate.getState().autoUpdateEnabled).toBe(false);
        expect(network.getState().autoConnect).toBe(true);
        expect(bindingKey.getState().capturingId).toBe(null);
        expect(bindingKey.getState().entries[0]).toEqual(expect.objectContaining({ pressCount: 0 }));
        expect(checkin.getState().weeklyPlan.weekStartDate).toBe('2026-05-18');
    });

    it('merges conflicting daily records by max counts and event id union', () => {
        const server = cloudSnapshot({
            updatedAt: 100,
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
        });
        const local = {
            ...server,
            network: { autoConnect: false, playerName: 'Local' },
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
        expect(merged.network).toEqual(server.network);
    });
});
