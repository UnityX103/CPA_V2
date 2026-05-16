import { describe, it, expect, beforeEach } from 'vitest';
import {
    applyDispatch,
    bindingKeySig,
    buildSnapshot,
    networkSig,
    pomoSig,
    settingsSig,
} from './host';
import { useSettingsStore } from '../settings';
import { usePomodoroStore } from '../pomodoro';
import { useNetworkStore } from '../network';
import { useBindingKeyStore } from '../bindingKey';
import { BRIDGE_VERSION } from './protocol';

const sampleEndActionVideo = {
    sourceKind: 'custom' as const,
    builtinVideoId: 'builtin-ocean',
    customVideoPath: '/Users/xpy/Videos/focus-complete.mp4',
};

beforeEach(() => {
    useSettingsStore.setState({ uiScale: 1.0, activeTab: 'pomodoro' });
    usePomodoroStore.getState().applyEndActionSettings('playVideo', {
        sourceKind: 'builtin',
        builtinVideoId: 'default',
        customVideoPath: '',
    });
    useNetworkStore.setState({
        autoConnect: false,
        playerName: '我',
        playerId: null,
        roomCode: '',
        status: 'idle',
        players: {},
        lastError: null,
    });
    useBindingKeyStore.setState({
        entries: [],
        capturingId: null,
        syncedKeyId: null,
        permissionGranted: true,
        platform: null,
    });
});

describe('buildSnapshot', () => {
    it('reads from every source store and stamps the version', () => {
        useSettingsStore.setState({ uiScale: 1.5 });
        const snap = buildSnapshot();
        expect(snap.v).toBe(BRIDGE_VERSION);
        expect(snap.settings.uiScale).toBe(1.5);
        expect('targetMonitorIndex' in snap.settings).toBe(false);
        expect(snap.pomodoro.focusDurationSeconds).toBe(usePomodoroStore.getState().focusDurationSeconds);
        expect(snap.pomodoro.endActionMode).toBe(usePomodoroStore.getState().endActionMode);
        expect(snap.pomodoro.endActionVideo).toEqual(usePomodoroStore.getState().endActionVideo);
        expect(snap.network.status).toBe(useNetworkStore.getState().status);
        expect(snap.bindingKey.entries).toEqual(useBindingKeyStore.getState().entries);
        expect(snap.bindingKey.entries).not.toBe(useBindingKeyStore.getState().entries);
    });

    it('detaches nested snapshot values from source store references', () => {
        usePomodoroStore.getState().applyEndActionSettings('playVideo', sampleEndActionVideo);
        useNetworkStore.setState({
            players: {
                'p-1': {
                    playerId: 'p-1',
                    playerName: 'Player One',
                    state: null,
                },
            },
        });
        useBindingKeyStore.setState({
            entries: [{
                id: 'bk-1',
                label: 'A',
                keyCode: 0,
                pressCount: 2,
                enabled: true,
            }],
        });

        const snap = buildSnapshot();

        expect(snap.pomodoro.endActionVideo).toEqual(usePomodoroStore.getState().endActionVideo);
        expect(snap.pomodoro.endActionVideo).not.toBe(usePomodoroStore.getState().endActionVideo);
        expect(snap.network.players).toEqual(useNetworkStore.getState().players);
        expect(snap.network.players).not.toBe(useNetworkStore.getState().players);
        expect(snap.network.players['p-1']).not.toBe(useNetworkStore.getState().players['p-1']);
        expect(snap.bindingKey.entries).toEqual(useBindingKeyStore.getState().entries);
        expect(snap.bindingKey.entries).not.toBe(useBindingKeyStore.getState().entries);
        expect(snap.bindingKey.entries[0]).not.toBe(useBindingKeyStore.getState().entries[0]);

        snap.pomodoro.endActionVideo.customVideoPath = '/mutated.mp4';
        snap.network.players['p-1'].playerName = 'Mutated';
        snap.bindingKey.entries[0].label = 'Mutated';

        expect(usePomodoroStore.getState().endActionVideo.customVideoPath).toBe('/Users/xpy/Videos/focus-complete.mp4');
        expect(useNetworkStore.getState().players['p-1'].playerName).toBe('Player One');
        expect(useBindingKeyStore.getState().entries[0].label).toBe('A');
    });

    it('does NOT include transient timer fields like remainingSeconds', () => {
        const snap = buildSnapshot();
        // @ts-expect-error remainingSeconds is intentionally absent from the snapshot type
        expect(snap.pomodoro.remainingSeconds).toBeUndefined();
    });
});

describe('applyDispatch', () => {
    it('routes settings/setUiScale to useSettingsStore.setUiScale', () => {
        applyDispatch({ v: BRIDGE_VERSION, store: 'settings', action: 'setUiScale', args: [1.75] });
        expect(useSettingsStore.getState().uiScale).toBe(1.75);
    });

    it('routes pomodoro/applyEndActionSettings to the main pomodoro store', () => {
        applyDispatch({
            v: BRIDGE_VERSION,
            store: 'pomodoro',
            action: 'applyEndActionSettings',
            args: ['topWindow', sampleEndActionVideo],
        });

        expect(usePomodoroStore.getState().endActionMode).toBe('topWindow');
        expect(usePomodoroStore.getState().endActionVideo).toEqual(sampleEndActionVideo);
    });

    it('ignores payloads with a mismatched bridge version', () => {
        const before = useSettingsStore.getState().uiScale;
        applyDispatch({ v: 999 as 1, store: 'settings', action: 'setUiScale', args: [2.5] });
        expect(useSettingsStore.getState().uiScale).toBe(before);
    });
});

describe('bridge host subscription signatures', () => {
    it('settingsSig ignores settings-window-local fields and includes mirrored fields', () => {
        expect(settingsSig({ uiScale: 1.25, activeTab: 'pomodoro' }))
            .toBe(settingsSig({ uiScale: 1.25, activeTab: 'global' }));
        expect(settingsSig({ uiScale: 1.25, activeTab: 'pomodoro' }))
            .not.toBe(settingsSig({ uiScale: 1.5, activeTab: 'pomodoro' }));
    });

    it('pomoSig includes end-action settings and ignores transient timer fields', () => {
        const base = {
            ...usePomodoroStore.getState(),
            endActionMode: 'playVideo' as const,
            endActionVideo: sampleEndActionVideo,
        };

        expect(pomoSig({ ...base, remainingSeconds: 1 })).toBe(pomoSig({ ...base, remainingSeconds: 99 }));
        expect(pomoSig(base)).not.toBe(pomoSig({ ...base, endActionMode: 'topWindow' }));
        expect(pomoSig(base)).not.toBe(pomoSig({
            ...base,
            endActionVideo: { ...sampleEndActionVideo, customVideoPath: '/other.mp4' },
        }));
    });

    it('networkSig ignores omitted network fields and includes mirrored fields', () => {
        const base = {
            ...useNetworkStore.getState(),
            status: 'joined' as const,
            serverUrl: 'ws://one.example',
            players: {
                'p-1': {
                    playerId: 'p-1',
                    playerName: 'Player One',
                    state: null,
                },
            },
        };

        expect(networkSig(base)).toBe(networkSig({ ...base, serverUrl: 'ws://two.example' }));
        expect(networkSig(base)).not.toBe(networkSig({
            ...base,
            players: {
                'p-1': {
                    playerId: 'p-1',
                    playerName: 'Renamed',
                    state: null,
                },
            },
        }));
    });

    it('bindingKeySig ignores omitted permission fields and includes mirrored fields', () => {
        const base = {
            ...useBindingKeyStore.getState(),
            permissionGranted: true,
            platform: 'macos' as const,
            entries: [{
                id: 'bk-1',
                label: 'A',
                keyCode: 0,
                pressCount: 1,
                enabled: true,
            }],
        };

        expect(bindingKeySig(base)).toBe(bindingKeySig({
            ...base,
            permissionGranted: false,
            platform: 'windows',
        }));
        expect(bindingKeySig(base)).not.toBe(bindingKeySig({
            ...base,
            entries: [{ ...base.entries[0], pressCount: 2 }],
        }));
    });
});
