import { describe, it, expect, beforeEach } from 'vitest';
import { applySnapshotToMirrors } from './client';
import { useSettingsStore } from '../settings';
import { usePomodoroStore } from '../pomodoro';
import { useNetworkStore } from '../network';
import { useBindingKeyStore } from '../bindingKey';
import { BRIDGE_VERSION, type BridgeSnapshot } from './protocol';

const SAMPLE: BridgeSnapshot = {
    v: BRIDGE_VERSION,
    settings: { uiScale: 2.0 },
    pomodoro: {
        focusDurationSeconds: 600,
        breakDurationSeconds: 120,
        totalRounds: 6,
        autoStartBreak: true,
    },
    network: {
        autoConnect: true, playerName: 'host', playerId: 'p-host',
        roomCode: 'R9', status: 'joined',
        players: {}, lastError: null,
    },
    bindingKey: { entries: [], capturingId: 'bk-cap', syncedKeyId: 'bk-sync' },
};

beforeEach(() => {
    useSettingsStore.setState({ uiScale: 1.0, activeTab: 'pomodoro' });
});

describe('applySnapshotToMirrors', () => {
    it('writes every snapshot section into the corresponding store', () => {
        applySnapshotToMirrors(SAMPLE);
        expect(useSettingsStore.getState().uiScale).toBe(2.0);
        expect('targetMonitorIndex' in useSettingsStore.getState()).toBe(false);
        expect(usePomodoroStore.getState().focusDurationSeconds).toBe(600);
        expect(usePomodoroStore.getState().breakDurationSeconds).toBe(120);
        expect(usePomodoroStore.getState().totalRounds).toBe(6);
        expect(usePomodoroStore.getState().autoStartBreak).toBe(true);
        expect(useNetworkStore.getState().status).toBe('joined');
        expect(useNetworkStore.getState().roomCode).toBe('R9');
        expect(useBindingKeyStore.getState().capturingId).toBe('bk-cap');
        expect(useBindingKeyStore.getState().syncedKeyId).toBe('bk-sync');
    });

    it('ignores snapshots with a mismatched bridge version', () => {
        const before = useSettingsStore.getState().uiScale;
        applySnapshotToMirrors({ ...SAMPLE, v: 999 as 1 });
        expect(useSettingsStore.getState().uiScale).toBe(before);
    });

    it('does not mutate activeTab (settings-window-local state)', () => {
        useSettingsStore.setState({ activeTab: 'global' });
        applySnapshotToMirrors(SAMPLE);
        expect(useSettingsStore.getState().activeTab).toBe('global');
    });
});
