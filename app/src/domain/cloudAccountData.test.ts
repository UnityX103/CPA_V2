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
