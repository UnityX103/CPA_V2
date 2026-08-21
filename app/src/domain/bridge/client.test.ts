import { beforeEach, describe, expect, it } from 'vitest';
import { usePomodoroStore } from '../pomodoro';
import { useSettingsStore } from '../settings';
import { usePresenceStore } from '../presence';
import { applySnapshotToMirrors } from './client';
import { BRIDGE_VERSION, type BridgeSnapshot } from './protocol';

function snapshot(): BridgeSnapshot {
    return {
        v: BRIDGE_VERSION,
        settings: { uiScale: 1.25, committedUiScale: 1.25, autostartEnabled: true, dangerousChange: null },
        pomodoro: {
            focusDurationSeconds: 900,
            breakDurationSeconds: 180,
            totalRounds: 5,
            autoStartBreak: true,
            autoPinAfterFocus: false,
            endActionMode: 'topWindow',
            endActionVideo: {
                sourceKind: 'custom',
                builtinVideoId: 'qianqian',
                customVideoPath: '/Users/xpy/Videos/focus-end.webm',
            },
            endSounds: {
                focus: { sourceKind: 'builtin', builtinSoundId: 'light-success', customSoundPath: '' },
                break: { sourceKind: 'custom', builtinSoundId: 'triple-ping', customSoundPath: '/Users/xpy/Music/rest.mp3' },
            },
        },
        presence: {
            enabled: true,
            intervalSeconds: 30,
            presentThresholdSeconds: 90,
            platform: 'macos',
            availability: 'ready',
            latestObservation: 'present',
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
}

beforeEach(() => {
    useSettingsStore.setState({ uiScale: 1, committedUiScale: 1, autostartEnabled: false, dangerousChange: null });
    usePresenceStore.setState({ enabled: false, availability: 'disabled', latestObservation: 'unknown' });
});

describe('bridge client', () => {
    it('applies retained mirrored state', () => {
        applySnapshotToMirrors(snapshot());

        expect(useSettingsStore.getState()).toEqual(expect.objectContaining({
            uiScale: 1.25,
            autostartEnabled: true,
        }));
        expect(usePomodoroStore.getState()).toEqual(expect.objectContaining({
            focusDurationSeconds: 900,
            autoPinAfterFocus: false,
            endActionMode: 'topWindow',
            endActionVideo: {
                sourceKind: 'custom',
                builtinVideoId: 'qianqian',
                customVideoPath: '/Users/xpy/Videos/focus-end.webm',
            },
            endSounds: {
                focus: { sourceKind: 'builtin', builtinSoundId: 'light-success', customSoundPath: '' },
                break: { sourceKind: 'custom', builtinSoundId: 'triple-ping', customSoundPath: '/Users/xpy/Music/rest.mp3' },
            },
        }));
        expect(usePresenceStore.getState()).toEqual(expect.objectContaining({
            enabled: true,
            intervalSeconds: 30,
            presentThresholdSeconds: 90,
            availability: 'ready',
            latestObservation: 'present',
        }));
    });

    it('ignores snapshots from another bridge version', () => {
        const invalid = { ...snapshot(), v: 2 } as unknown as BridgeSnapshot;
        applySnapshotToMirrors(invalid);

        expect(useSettingsStore.getState().uiScale).toBe(1);
    });
});
