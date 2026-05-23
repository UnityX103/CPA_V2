import { describe, it, expect } from 'vitest';
import {
    type PomodoroEndActionMode,
    type PomodoroEndActionVideo,
} from '../pomodoro';
import { defaultWeeklyPlan } from '../checkin';
import {
    BRIDGE_VERSION,
    EVT_DISPATCH,
    EVT_STATE,
    EVT_STATE_REQUEST,
    type BridgeSnapshot,
    type DispatchPayload,
} from './protocol';

const sampleEndActionMode: PomodoroEndActionMode = 'playVideo';
const sampleEndActionVideo: PomodoroEndActionVideo = {
    sourceKind: 'custom',
    builtinVideoId: 'builtin-rain',
    customVideoPath: '/tmp/focus-finished.mp4',
};

describe('bridge protocol', () => {
    it('defines stable event names', () => {
        expect(EVT_STATE_REQUEST).toBe('app:state:request');
        expect(EVT_STATE).toBe('app:state');
        expect(EVT_DISPATCH).toBe('app:dispatch');
    });

    it('uses BRIDGE_VERSION = 1', () => {
        expect(BRIDGE_VERSION).toBe(1);
    });

    it('BridgeSnapshot accepts a fully-populated payload', () => {
        const snap: BridgeSnapshot = {
            v: 1,
            settings: {
                uiScale: 1.5,
                committedUiScale: 1.0,
                autostartEnabled: true,
                checkinEnabled: false,
                dangerousChange: null,
            },
            pomodoro: {
                focusDurationSeconds: 1500,
                breakDurationSeconds: 300,
                totalRounds: 4,
                autoStartBreak: false,
                endActionMode: sampleEndActionMode,
                endActionVideo: sampleEndActionVideo,
            },
            network: {
                autoConnect: false, playerName: 'me', playerId: 'p-1',
                roomCode: 'R1', status: 'idle',
                players: {}, lastError: null,
                accountStatus: 'guest',
                accountUser: null,
                accountToken: null,
                accountError: null,
                cloudSyncStatus: 'idle',
                cloudData: null,
                cloudDataUpdatedAt: null,
                cloudError: null,
            },
            activeApp: null,
            bindingKey: { panelEnabled: true, entries: [], capturingId: null, syncedKeyId: null },
            appUpdate: {
                autoUpdateEnabled: true,
                status: 'upToDate',
                currentVersion: '0.1.0',
                availableVersion: null,
                releaseNotes: null,
                lastCheckedAt: 1700000000000,
                errorMessage: null,
            },
            checkin: {
                weeklyPlan: defaultWeeklyPlan('2026-05-18'),
                dailyRecords: {
                    '2026-05-18': {
                        date: '2026-05-18',
                        countsByItemId: { 'pomodoro-focus': 2 },
                        processedPomodoroEndEventIds: [101],
                    },
                },
                lastError: null,
            },
        };
        expect(snap.v).toBe(1);
        expect(snap.pomodoro.endActionMode).toBe(sampleEndActionMode);
        expect(snap.pomodoro.endActionVideo).toEqual(sampleEndActionVideo);
        expect(snap.settings.autostartEnabled).toBe(true);
        expect(snap.settings.checkinEnabled).toBe(false);
        expect(('showActiveApp' + 'WindowTitle') in snap.settings).toBe(false);
        expect(('autoPinOn' + 'FocusEnd') in snap.settings).toBe(false);
        expect('targetMonitorIndex' in snap.settings).toBe(false);
        expect(snap.appUpdate.status).toBe('upToDate');
        expect(snap.checkin.dailyRecords['2026-05-18'].countsByItemId['pomodoro-focus']).toBe(2);
    });

    it('DispatchPayload accepts every action shape', () => {
        const samples: DispatchPayload[] = [
            { v: 1, store: 'settings',   action: 'setUiScale',     args: [1.5] },
            { v: 1, store: 'settings',   action: 'previewDangerousUiScale', args: [1.5] },
            { v: 1, store: 'settings',   action: 'setAutostartEnabled', args: [true] },
            { v: 1, store: 'settings',   action: 'setCheckinEnabled', args: [false] },
            { v: 1, store: 'settings',   action: 'applyDangerousChange', args: ['pending-id'] },
            { v: 1, store: 'settings',   action: 'revertDangerousChange', args: ['pending-id'] },
            { v: 1, store: 'pomodoro',   action: 'applySettings',  args: [1500, 300, 4, true, false] },
            { v: 1, store: 'pomodoro',   action: 'applyEndActionSettings', args: [sampleEndActionMode, sampleEndActionVideo] },
            { v: 1, store: 'network',    action: 'createRoom',     args: ['R1'] },
            { v: 1, store: 'network',    action: 'joinRoom',       args: ['R1'] },
            { v: 1, store: 'network',    action: 'leaveRoom',      args: [] },
            { v: 1, store: 'network',    action: 'setAutoConnect', args: [true] },
            { v: 1, store: 'network',    action: 'setPlayerName',  args: ['me'] },
            { v: 1, store: 'bindingKey', action: 'beginCapture',   args: ['bk-1'] },
            { v: 1, store: 'bindingKey', action: 'removeEntry',    args: ['bk-1'] },
            { v: 1, store: 'bindingKey', action: 'setPanelEnabled', args: [false] },
            { v: 1, store: 'bindingKey', action: 'setSynced',      args: [null] },
            { v: 1, store: 'bindingKey', action: 'completeCapture', args: [{ kind: 'keyboard', code: 32 }, 'Space'] },
            { v: 1, store: 'bindingKey', action: 'addEntry',       args: [] },
            { v: 1, store: 'appUpdate',  action: 'setAutoUpdateEnabled', args: [false] },
            { v: 1, store: 'appUpdate',  action: 'checkNow',       args: [] },
            { v: 1, store: 'appUpdate',  action: 'restartForUpdate', args: [] },
            { v: 1, store: 'checkin',    action: 'setWeeklyPlan',  args: [defaultWeeklyPlan('2026-05-25')] },
            { v: 1, store: 'checkin',    action: 'incrementItem',  args: ['2026-05-25', 'pomodoro-focus'] },
        ];
        expect(samples).toHaveLength(24);
        expect(samples[7]).toEqual({
            v: 1,
            store: 'pomodoro',
            action: 'applyEndActionSettings',
            args: [sampleEndActionMode, sampleEndActionVideo],
        });
    });
});
