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
                audioOutputDeviceId: null,
                soundVolume: 1,
                dangerousChange: null,
            },
            pomodoro: {
                focusDurationSeconds: 1500,
                breakDurationSeconds: 300,
                totalRounds: 4,
                autoStartBreak: false,
                autoPinAfterFocus: true,
                endActionMode: 'topWindow',
                endActionVideo: {
                    sourceKind: 'builtin',
                    builtinVideoId: 'qianqian',
                    customVideoPath: '',
                },
                endSounds: {
                    focus: { sourceKind: 'builtin', builtinSoundId: 'clear-success', customSoundPath: '' },
                    break: { sourceKind: 'builtin', builtinSoundId: 'triple-ping', customSoundPath: '' },
                },
            },
            presence: {
                enabled: true,
                intervalSeconds: 60,
                absenceSensitivity: 'strict',
                platform: 'macos',
                availability: 'ready',
                confirmedPresence: 'present',
                lastSuccessfulAt: 123,
                lastError: null,
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
                downloadedBytes: 0,
                downloadTotalBytes: null,
            },
        };

        expect(snapshot.pomodoro.endActionMode).toBe('topWindow');
        expect(snapshot.pomodoro.endActionVideo.builtinVideoId).toBe('qianqian');
    });

    it('keeps retained dispatch actions typed', () => {
        const payloads: DispatchPayload[] = [
            { v: BRIDGE_VERSION, store: 'settings', action: 'setAutostartEnabled', args: [true] },
            { v: BRIDGE_VERSION, store: 'pomodoro', action: 'applySettings', args: [900, 180, 4, true, false] },
            { v: BRIDGE_VERSION, store: 'pomodoro', action: 'applyEndActionSettings', args: ['playVideo', {
                sourceKind: 'builtin', builtinVideoId: 'qianqian', customVideoPath: '',
            }] },
            { v: BRIDGE_VERSION, store: 'pomodoro', action: 'applyEndSoundSettings', args: [{
                focus: { sourceKind: 'builtin', builtinSoundId: 'clear-success', customSoundPath: '' },
                break: { sourceKind: 'builtin', builtinSoundId: 'triple-ping', customSoundPath: '' },
            }] },
            { v: BRIDGE_VERSION, store: 'presence', action: 'applySettings', args: [{ enabled: true, intervalSeconds: 60, absenceSensitivity: 'strict' }] },
            { v: BRIDGE_VERSION, store: 'presence', action: 'requestAccess', args: [] },
            { v: BRIDGE_VERSION, store: 'presence', action: 'retry', args: [] },
            { v: BRIDGE_VERSION, store: 'presence', action: 'openPrivacySettings', args: [] },
            { v: BRIDGE_VERSION, store: 'network', action: 'leaveRoom', args: [] },
        ];

        expect(payloads).toHaveLength(9);
    });
});
