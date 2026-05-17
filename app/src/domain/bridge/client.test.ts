import { describe, it, expect, beforeEach } from 'vitest';
import { applySnapshotToMirrors } from './client';
import { useSettingsStore } from '../settings';
import { usePomodoroStore } from '../pomodoro';
import { useNetworkStore } from '../network';
import { useBindingKeyStore } from '../bindingKey';
import { BRIDGE_VERSION, type BridgeSnapshot } from './protocol';

const sampleRemoteState = {
    pomodoro: {
        phase: 1,
        remainingSeconds: 42,
        currentRound: 2,
        totalRounds: 4,
        isRunning: true,
    },
    activeApp: {
        name: 'Focus App',
        bundleId: 'com.example.focus',
        iconId: 'icon-focus',
    },
    bindingKey: {
        keyLabel: 'A',
        pressCount: 7,
    },
};

function makeSample(): BridgeSnapshot {
    return {
        v: BRIDGE_VERSION,
        settings: {
            uiScale: 2.0,
            committedUiScale: 1.0,
            dangerousChange: {
                id: 'scale-pending',
                kind: 'uiScale',
                previousValue: 1.0,
                nextValue: 2.0,
                expiresAt: 12345,
            },
        },
        pomodoro: {
            focusDurationSeconds: 600,
            breakDurationSeconds: 120,
            totalRounds: 6,
            autoStartBreak: true,
            endActionMode: 'topWindow',
            endActionVideo: {
                sourceKind: 'custom',
                builtinVideoId: 'builtin-fireworks',
                customVideoPath: '/Users/xpy/Videos/focus-complete.mp4',
            },
        },
        network: {
            autoConnect: true,
            playerName: 'host',
            playerId: 'p-host',
            roomCode: 'R9',
            status: 'joined',
            players: {
                'p-1': {
                    playerId: 'p-1',
                    playerName: 'Player One',
                    state: sampleRemoteState,
                },
            },
            lastError: null,
        },
        bindingKey: {
            entries: [{
                id: 'bk-1',
                label: 'A',
                keyCode: 0,
                pressCount: 2,
                enabled: true,
            }],
            capturingId: 'bk-cap',
            syncedKeyId: 'bk-sync',
        },
    };
}

beforeEach(() => {
    useSettingsStore.setState({
        uiScale: 1.0,
        committedUiScale: 1.0,
        dangerousChange: null,
        activeTab: 'pomodoro',
    });
    usePomodoroStore.setState({
        autoStartBreak: false,
        endActionMode: 'playVideo',
        endActionVideo: {
            sourceKind: 'builtin',
            builtinVideoId: 'default',
            customVideoPath: '',
        },
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

describe('applySnapshotToMirrors', () => {
    it('writes every snapshot section into the corresponding store', () => {
        applySnapshotToMirrors(makeSample());
        expect(useSettingsStore.getState().uiScale).toBe(2.0);
        expect(useSettingsStore.getState().committedUiScale).toBe(1.0);
        expect(useSettingsStore.getState().dangerousChange?.id).toBe('scale-pending');
        expect('targetMonitorIndex' in useSettingsStore.getState()).toBe(false);
        expect(usePomodoroStore.getState().focusDurationSeconds).toBe(600);
        expect(usePomodoroStore.getState().breakDurationSeconds).toBe(120);
        expect(usePomodoroStore.getState().totalRounds).toBe(6);
        expect(usePomodoroStore.getState().autoStartBreak).toBe(true);
        expect(usePomodoroStore.getState().endActionMode).toBe('topWindow');
        expect(usePomodoroStore.getState().endActionVideo).toEqual({
            sourceKind: 'custom',
            builtinVideoId: 'builtin-fireworks',
            customVideoPath: '/Users/xpy/Videos/focus-complete.mp4',
        });
        expect(useNetworkStore.getState().status).toBe('joined');
        expect(useNetworkStore.getState().roomCode).toBe('R9');
        expect(useBindingKeyStore.getState().capturingId).toBe('bk-cap');
        expect(useBindingKeyStore.getState().syncedKeyId).toBe('bk-sync');
    });

    it('detaches nested mirror state from the incoming snapshot object', () => {
        const sample = makeSample();
        applySnapshotToMirrors(sample);

        expect(usePomodoroStore.getState().endActionVideo).toEqual(sample.pomodoro.endActionVideo);
        expect(usePomodoroStore.getState().endActionVideo).not.toBe(sample.pomodoro.endActionVideo);
        expect(useNetworkStore.getState().players).toEqual(sample.network.players);
        expect(useNetworkStore.getState().players).not.toBe(sample.network.players);
        expect(useNetworkStore.getState().players['p-1']).not.toBe(sample.network.players['p-1']);
        expect(useNetworkStore.getState().players['p-1'].state).not.toBe(sample.network.players['p-1'].state);
        expect(useNetworkStore.getState().players['p-1'].state?.pomodoro).not.toBe(sample.network.players['p-1'].state?.pomodoro);
        expect(useNetworkStore.getState().players['p-1'].state?.activeApp).not.toBe(sample.network.players['p-1'].state?.activeApp);
        expect(useNetworkStore.getState().players['p-1'].state?.bindingKey).not.toBe(sample.network.players['p-1'].state?.bindingKey);
        expect(useBindingKeyStore.getState().entries).toEqual(sample.bindingKey.entries);
        expect(useBindingKeyStore.getState().entries).not.toBe(sample.bindingKey.entries);
        expect(useBindingKeyStore.getState().entries[0]).not.toBe(sample.bindingKey.entries[0]);

        sample.pomodoro.endActionVideo.customVideoPath = '/mutated.mp4';
        sample.network.players['p-1'].playerName = 'Mutated';
        sample.network.players['p-1'].state!.pomodoro.remainingSeconds = 1;
        sample.network.players['p-1'].state!.activeApp!.name = 'Mutated App';
        sample.network.players['p-1'].state!.bindingKey!.pressCount = 99;
        sample.bindingKey.entries[0].label = 'Mutated';

        expect(usePomodoroStore.getState().endActionVideo.customVideoPath).toBe('/Users/xpy/Videos/focus-complete.mp4');
        expect(useNetworkStore.getState().players['p-1'].playerName).toBe('Player One');
        expect(useNetworkStore.getState().players['p-1'].state?.pomodoro.remainingSeconds).toBe(42);
        expect(useNetworkStore.getState().players['p-1'].state?.activeApp?.name).toBe('Focus App');
        expect(useNetworkStore.getState().players['p-1'].state?.bindingKey?.pressCount).toBe(7);
        expect(useBindingKeyStore.getState().entries[0].label).toBe('A');
    });

    it('ignores snapshots with a mismatched bridge version', () => {
        const before = useSettingsStore.getState().uiScale;
        applySnapshotToMirrors({ ...makeSample(), v: 999 as 1 });
        expect(useSettingsStore.getState().uiScale).toBe(before);
    });

    it('does not mutate activeTab (settings-window-local state)', () => {
        useSettingsStore.setState({ activeTab: 'global' });
        applySnapshotToMirrors(makeSample());
        expect(useSettingsStore.getState().activeTab).toBe('global');
    });
});
