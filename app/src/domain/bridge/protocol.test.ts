import { describe, expect, it } from 'vitest';
import { BRIDGE_VERSION, type BridgeSnapshot, type DispatchPayload } from './protocol';

describe('bridge protocol', () => {
    it('describes only retained settings and pomodoro fields', () => {
        const snapshot: BridgeSnapshot = {
            v: BRIDGE_VERSION,
            settings: {
                uiScale: 1,
                committedUiScale: 1,
                autostartEnabled: false,
                dangerousChange: null,
            },
            pomodoro: {
                focusDurationSeconds: 1500,
                breakDurationSeconds: 300,
                totalRounds: 4,
                autoStartBreak: false,
                autoPinAfterFocus: true,
                endActionMode: 'topWindow',
            },
            network: {
                autoConnect: false,
                playerName: '我',
                playerId: null,
                roomCode: '',
                status: 'idle',
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
            },
            activeApp: null,
            bindingKey: { panelEnabled: true, entries: [], capturingId: null, syncedKeyId: null },
            appUpdate: {
                autoUpdateEnabled: true,
                status: 'idle',
                currentVersion: '0.1.10',
                availableVersion: null,
                releaseNotes: null,
                lastCheckedAt: null,
                errorMessage: null,
            },
        };

        expect(snapshot.pomodoro.endActionMode).toBe('topWindow');
    });

    it('keeps retained dispatch actions typed', () => {
        const payloads: DispatchPayload[] = [
            { v: BRIDGE_VERSION, store: 'settings', action: 'setAutostartEnabled', args: [true] },
            { v: BRIDGE_VERSION, store: 'pomodoro', action: 'applySettings', args: [900, 180, 4, true, false] },
            { v: BRIDGE_VERSION, store: 'network', action: 'leaveRoom', args: [] },
        ];

        expect(payloads).toHaveLength(3);
    });
});
