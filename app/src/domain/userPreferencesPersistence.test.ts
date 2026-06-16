import { beforeEach, describe, expect, it, vi } from 'vitest';
import { create } from 'zustand';
import {
    buildUserPreferencesSnapshot,
    hydrateUserPreferencesSnapshot,
    normalizeUserPreferencesSnapshot,
    type UserPreferencesStores,
} from './userPreferences';

const storeData = new Map<string, unknown>();
const save = vi.fn(async () => {});

vi.mock('@tauri-apps/plugin-store', () => ({
    load: vi.fn(async () => ({
        get: async (key: string) => storeData.get(key),
        set: async (key: string, value: unknown) => { storeData.set(key, value); },
        save,
    })),
}));

const persistence = await import('./userPreferencesPersistence');

function makeStores(): UserPreferencesStores {
    const pomodoro = create<any>((set) => ({
        focusDurationSeconds: 1500,
        breakDurationSeconds: 300,
        totalRounds: 4,
        currentRound: 3,
        remainingSeconds: 123,
        currentPhase: 'break',
        isRunning: true,
        isPinned: true,
        autoStartBreak: false,
        consecutiveCompletedFocus: 2,
        endActionMode: 'playVideo',
        endActionVideo: { sourceKind: 'builtin', builtinVideoId: 'qianqian', customVideoPath: '' },
        lastEndEvent: { id: 9, fromPhase: 'focus', toPhase: 'break', triggeredBy: 'timer' },
        applySettings: (focusDurationSeconds: number, breakDurationSeconds: number, totalRounds: number, resetProgress: boolean, autoStartBreak: boolean) => {
            set({
                focusDurationSeconds,
                breakDurationSeconds,
                totalRounds,
                autoStartBreak,
                ...(resetProgress ? { currentRound: 1, remainingSeconds: focusDurationSeconds, isRunning: false } : {}),
            });
        },
        applyEndActionSettings: (endActionMode: string, endActionVideo: object) => set({ endActionMode, endActionVideo }),
    }));
    const settings = create<any>((set) => ({
        activeTab: 'pomodoro',
        uiScale: 1,
        committedUiScale: 1.25,
        autostartEnabled: true,
        checkinEnabled: false,
        dangerousChange: null,
        hydrateSettings: (snapshot: { uiScale: number; autostartEnabled?: boolean; checkinEnabled?: boolean }) => set({
            uiScale: snapshot.uiScale,
            committedUiScale: snapshot.uiScale,
            autostartEnabled: snapshot.autostartEnabled ?? false,
            checkinEnabled: snapshot.checkinEnabled ?? true,
            dangerousChange: null,
        }),
    }));
    const appUpdate = create<any>(() => ({
        autoUpdateEnabled: false,
        status: 'error',
        currentVersion: '0.1.4',
        availableVersion: '0.1.5',
        releaseNotes: 'notes',
        lastCheckedAt: 123,
        errorMessage: 'network',
    }));
    const network = create<any>(() => ({
        status: 'joined',
        serverUrl: 'ws://example.test',
        autoConnect: true,
        roomCode: 'ROOM-1',
        playerName: 'Alice',
        playerId: 'player-1',
        players: {},
        lastError: 'NOPE',
        accountStatus: 'guest',
        accountUser: null,
        accountToken: null,
        accountError: null,
        cloudSyncStatus: 'idle',
        cloudData: null,
        cloudDataUpdatedAt: null,
        cloudError: null,
    }));
    const bindingKey = create<any>(() => ({
        panelEnabled: false,
        entries: [{
            id: 'space',
            label: 'Space',
            keyCode: 49,
            input: { kind: 'keyboard', code: 49 },
            pressCount: 42,
            enabled: true,
        }],
        syncedKeyId: 'space',
        capturingId: 'space',
    }));
    const checkin = create<any>((set) => ({
        planTemplate: {
            schemaVersion: 2,
            carryToNextWeek: true,
            items: [{
                id: 'pomo',
                title: '专注番茄',
                type: 'pomodoroFocus',
                targetCount: 4,
                repeatDays: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'],
                editMode: 'cycle',
            }],
        },
        dailyRecords: {
            '2026-05-18': { date: '2026-05-18', countsByItemId: { pomo: 1 }, processedPomodoroEndEventIds: [1] },
        },
        hydrateCheckin: (snapshot: object) => set(snapshot),
    }));

    return { pomodoro, settings, appUpdate, network, bindingKey, checkin } as UserPreferencesStores;
}

beforeEach(() => {
    storeData.clear();
    save.mockClear();
});

describe('user preferences persistence', () => {
    it('builds durable snapshots without volatile runtime fields', () => {
        const snapshot = buildUserPreferencesSnapshot(makeStores());

        expect(snapshot.pomodoro).toEqual({
            focusDurationSeconds: 1500,
            breakDurationSeconds: 300,
            totalRounds: 4,
            autoStartBreak: false,
            endActionMode: 'playVideo',
            endActionVideo: { sourceKind: 'builtin', builtinVideoId: 'qianqian', customVideoPath: '' },
        });
        expect(snapshot.network).toEqual({ autoConnect: true, playerName: 'Alice' });
        expect(snapshot.settings).toEqual({
            uiScale: 1.25,
            autostartEnabled: true,
            checkinEnabled: false,
        });
        expect(snapshot.bindingKey.entries[0]).toEqual({
            id: 'space',
            label: 'Space',
            keyCode: 49,
            input: { kind: 'keyboard', code: 49 },
            enabled: true,
        });
        expect('pressCount' in snapshot.bindingKey.entries[0]).toBe(false);
        expect(snapshot.checkin.planTemplate.items[0]).toMatchObject({
            id: 'pomo',
            repeatDays: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'],
            editMode: 'cycle',
        });
    });

    it('hydrates durable fields without restoring volatile fields', () => {
        const stores = makeStores();
        const snapshot = buildUserPreferencesSnapshot(stores);
        snapshot.pomodoro.focusDurationSeconds = 900;
        snapshot.settings.checkinEnabled = true;
        snapshot.appUpdate.autoUpdateEnabled = true;
        snapshot.bindingKey.entries[0].label = 'Changed';

        hydrateUserPreferencesSnapshot({ stores, snapshot });

        expect(stores.pomodoro.getState().focusDurationSeconds).toBe(900);
        expect(stores.settings.getState().checkinEnabled).toBe(true);
        expect(stores.pomodoro.getState().currentRound).toBe(3);
        expect(stores.appUpdate.getState().autoUpdateEnabled).toBe(true);
        expect(stores.appUpdate.getState().status).toBe('idle');
        expect(stores.bindingKey.getState().capturingId).toBe(null);
        expect(stores.bindingKey.getState().entries[0]).toEqual(expect.objectContaining({
            label: 'Changed',
            pressCount: 0,
        }));
    });

    it('normalizes malformed sections to defaults and clears missing synced key ids', () => {
        const normalized = normalizeUserPreferencesSnapshot({
            schemaVersion: 1,
            pomodoro: { focusDurationSeconds: 'bad' },
            settings: { uiScale: 99, autostartEnabled: true, checkinEnabled: false },
            appUpdate: { autoUpdateEnabled: false },
            network: { autoConnect: true, playerName: '  Bob  ' },
            bindingKey: {
                panelEnabled: false,
                entries: [{ id: 'a', label: 'A', keyCode: 1, input: { kind: 'keyboard', code: 1 }, enabled: true }],
                syncedKeyId: 'missing',
            },
            checkin: { planTemplate: 'bad', dailyRecords: {} },
        });

        expect(normalized?.pomodoro.focusDurationSeconds).toBe(25 * 60);
        expect(normalized?.settings.uiScale).toBe(2);
        expect(normalized?.settings.checkinEnabled).toBe(false);
        expect(normalized?.network.playerName).toBe('Bob');
        expect(normalized?.bindingKey.syncedKeyId).toBe(null);
        expect(normalized?.bindingKey.entries).toHaveLength(1);
        expect(normalized?.checkin.planTemplate.schemaVersion).toBe(2);
    });

    it('normalizes legacy weeklyPlan check-in preferences into planTemplate', () => {
        const normalized = normalizeUserPreferencesSnapshot({
            schemaVersion: 1,
            pomodoro: {},
            settings: {},
            appUpdate: {},
            network: {},
            bindingKey: {},
            checkin: {
                weeklyPlan: {
                    weekStartDate: '2026-05-18',
                    carryToNextWeek: true,
                    days: {
                        mon: {
                            kind: 'items',
                            items: [{ id: 'read', title: '阅读', type: 'manual', targetCount: 2 }],
                        },
                        tue: { kind: 'inherit' },
                        wed: { kind: 'rest' },
                        thu: { kind: 'inherit' },
                        fri: { kind: 'inherit' },
                        sat: { kind: 'inherit' },
                        sun: { kind: 'rest' },
                    },
                },
                dailyRecords: {},
            },
        });

        expect(normalized?.checkin.planTemplate.items[0]).toMatchObject({
            id: 'read',
            repeatDays: ['mon', 'tue', 'thu', 'fri', 'sat'],
        });
    });

    it('loads and saves v1 snapshots through Tauri store', async () => {
        const snapshot = buildUserPreferencesSnapshot(makeStores());
        storeData.set('userPreferences', snapshot);

        await expect(persistence.loadPersistedUserPreferences()).resolves.toEqual(snapshot);

        await persistence.savePersistedUserPreferences(snapshot);
        expect(storeData.get('userPreferences')).toEqual(snapshot);
        expect(save).toHaveBeenCalledTimes(1);
    });
});
