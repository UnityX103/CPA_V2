import { act, cleanup, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { applySnapshotToMirrors, useBridgeClient } from './client';
import { useSettingsStore } from '../settings';
import { usePomodoroStore } from '../pomodoro';
import { useNetworkStore } from '../network';
import { useBindingKeyStore } from '../bindingKey';
import { useActiveAppStore } from '../activeApp';
import { useAppUpdateStore } from '../appUpdate';
import { BRIDGE_VERSION, EVT_STATE, type BridgeSnapshot } from './protocol';
import { defaultPlanTemplate, useCheckinStore } from '../checkin';

const { emitMock, listenMock, eventHandlers } = vi.hoisted(() => {
    const handlers = new Map<string, (event: { payload: unknown }) => void>();
    return {
        emitMock: vi.fn(),
        listenMock: vi.fn((eventName: string, handler: (event: { payload: unknown }) => void) => {
            handlers.set(eventName, handler);
            return Promise.resolve(() => {
                if (handlers.get(eventName) === handler) {
                    handlers.delete(eventName);
                }
            });
        }),
        eventHandlers: handlers,
    };
});

vi.mock('@tauri-apps/api/webviewWindow', () => ({
    WebviewWindow: {
        getByLabel: vi.fn(() => Promise.resolve({ emit: emitMock })),
    },
}));
vi.mock('@tauri-apps/api/event', () => ({ listen: listenMock }));

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
            autostartEnabled: true,
            checkinEnabled: false,
            planPanelEnabled: false,
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
            autoPinAfterFocus: false,
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
            accountStatus: 'loggedIn',
            accountUser: { userId: 'u-host', username: 'host' },
            accountToken: 'token-host',
            accountError: null,
            cloudSyncStatus: 'synced',
            cloudData: null,
            cloudDataUpdatedAt: null,
            cloudError: null,
        },
        activeApp: {
            name: 'VS Code',
            bundle_id: 'com.microsoft.VSCode',
            window_title: 'README.md - CPA_V2',
            icon_data_url: null,
        },
        bindingKey: {
            panelEnabled: true,
            entries: [{
                id: 'bk-1',
                label: 'A',
                keyCode: 0,
                input: { kind: 'keyboard', code: 0 },
                pressCount: 2,
                enabled: true,
            }],
            capturingId: 'bk-cap',
            syncedKeyId: 'bk-sync',
        },
        appUpdate: {
            autoUpdateEnabled: true,
            status: 'readyToRestart',
            currentVersion: '0.1.0',
            availableVersion: '0.1.1',
            releaseNotes: 'Quiet update',
            lastCheckedAt: 1700000000000,
            errorMessage: null,
        },
        checkin: {
            planTemplate: {
                ...defaultPlanTemplate(),
                items: [{
                    id: 'manual-1',
                    title: 'Read',
                    type: 'manual',
                    targetCount: 2,
                    repeatDays: ['mon' as const],
                    editMode: 'cycle',
                }],
            },
            dailyRecords: {
                '2026-05-18': {
                    date: '2026-05-18',
                    countsByItemId: { 'manual-1': 1 },
                    processedPomodoroEndEventIds: [42],
                },
            },
            lastError: 'save failed',
        },
    };
}

beforeEach(() => {
    vi.useRealTimers();
    emitMock.mockClear();
    listenMock.mockClear();
    eventHandlers.clear();
    useSettingsStore.setState({
        uiScale: 1.0,
        committedUiScale: 1.0,
        autostartEnabled: false,
        checkinEnabled: true,
        planPanelEnabled: true,
        dangerousChange: null,
        activeTab: 'pomodoro',
    });
    usePomodoroStore.setState({
        autoStartBreak: false,
        autoPinAfterFocus: true,
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
        panelEnabled: true,
        entries: [],
        capturingId: null,
        syncedKeyId: null,
        permissionGranted: true,
        platform: null,
    });
    useActiveAppStore.setState({ current: null });
    useAppUpdateStore.setState({
        autoUpdateEnabled: true,
        status: 'idle',
        currentVersion: null,
        availableVersion: null,
        releaseNotes: null,
        lastCheckedAt: null,
        errorMessage: null,
    });
    useCheckinStore.setState({
        planTemplate: defaultPlanTemplate(),
        dailyRecords: {},
        lastError: null,
    });
});

afterEach(() => {
    cleanup();
    vi.useRealTimers();
});

function BridgeClientHost() {
    const ready = useBridgeClient();
    return createElement('div', { 'data-testid': 'bridge-ready' }, ready ? 'ready' : 'waiting');
}

describe('applySnapshotToMirrors', () => {
    it('writes every snapshot section into the corresponding store', () => {
        applySnapshotToMirrors(makeSample());
        expect(useSettingsStore.getState().uiScale).toBe(2.0);
        expect(useSettingsStore.getState().committedUiScale).toBe(1.0);
        expect(useSettingsStore.getState().autostartEnabled).toBe(true);
        expect(useSettingsStore.getState().checkinEnabled).toBe(false);
        expect(useSettingsStore.getState().planPanelEnabled).toBe(false);
        expect(useSettingsStore.getState().dangerousChange?.id).toBe('scale-pending');
        expect(('showActiveApp' + 'WindowTitle') in useSettingsStore.getState()).toBe(false);
        expect(('autoPinOn' + 'FocusEnd') in useSettingsStore.getState()).toBe(false);
        expect('targetMonitorIndex' in useSettingsStore.getState()).toBe(false);
        expect(usePomodoroStore.getState().focusDurationSeconds).toBe(600);
        expect(usePomodoroStore.getState().breakDurationSeconds).toBe(120);
        expect(usePomodoroStore.getState().totalRounds).toBe(6);
        expect(usePomodoroStore.getState().autoStartBreak).toBe(true);
        expect(usePomodoroStore.getState().autoPinAfterFocus).toBe(false);
        expect(usePomodoroStore.getState().endActionMode).toBe('topWindow');
        expect(usePomodoroStore.getState().endActionVideo).toEqual({
            sourceKind: 'custom',
            builtinVideoId: 'builtin-fireworks',
            customVideoPath: '/Users/xpy/Videos/focus-complete.mp4',
        });
        expect(useNetworkStore.getState().status).toBe('joined');
        expect(useNetworkStore.getState().roomCode).toBe('R9');
        expect(useNetworkStore.getState().players['p-1'].state?.bindingKey).toEqual({
            keyLabel: 'A',
            pressCount: 7,
        });
        expect(useBindingKeyStore.getState().capturingId).toBe('bk-cap');
        expect(useBindingKeyStore.getState().syncedKeyId).toBe('bk-sync');
        expect(useAppUpdateStore.getState()).toMatchObject({
            status: 'readyToRestart',
            currentVersion: '0.1.0',
            availableVersion: '0.1.1',
            releaseNotes: 'Quiet update',
            lastCheckedAt: 1700000000000,
            errorMessage: null,
        });
        expect(useCheckinStore.getState().planTemplate.items[0]).toEqual({
            id: 'manual-1',
            title: 'Read',
            type: 'manual',
            targetCount: 2,
            repeatDays: ['mon'],
            editMode: 'cycle',
        });
        expect(useCheckinStore.getState().dailyRecords['2026-05-18']).toEqual({
            date: '2026-05-18',
            countsByItemId: { 'manual-1': 1 },
            processedPomodoroEndEventIds: [42],
        });
        expect(useCheckinStore.getState().lastError).toBe('save failed');
    });

    it('detaches nested mirror state from the incoming snapshot object', () => {
        const sample = makeSample();
        applySnapshotToMirrors(sample);

        expect(useSettingsStore.getState().dangerousChange).toEqual(sample.settings.dangerousChange);
        expect(useSettingsStore.getState().dangerousChange).not.toBe(sample.settings.dangerousChange);
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
        expect(useCheckinStore.getState().planTemplate).toEqual(sample.checkin.planTemplate);
        expect(useCheckinStore.getState().planTemplate).not.toBe(sample.checkin.planTemplate);
        expect(useCheckinStore.getState().planTemplate.items).not.toBe(sample.checkin.planTemplate.items);
        expect(useCheckinStore.getState().planTemplate.items[0]).not.toBe(sample.checkin.planTemplate.items[0]);
        expect(useCheckinStore.getState().dailyRecords).toEqual(sample.checkin.dailyRecords);
        expect(useCheckinStore.getState().dailyRecords).not.toBe(sample.checkin.dailyRecords);
        expect(useCheckinStore.getState().dailyRecords['2026-05-18']).not.toBe(sample.checkin.dailyRecords['2026-05-18']);

        sample.settings.dangerousChange!.nextValue = 1.25;
        sample.pomodoro.endActionVideo.customVideoPath = '/mutated.mp4';
        sample.network.players['p-1'].playerName = 'Mutated';
        sample.network.players['p-1'].state!.pomodoro.remainingSeconds = 1;
        sample.network.players['p-1'].state!.activeApp!.name = 'Mutated App';
        sample.network.players['p-1'].state!.bindingKey!.pressCount = 99;
        sample.bindingKey.entries[0].label = 'Mutated';
        sample.bindingKey.entries[0].input = { kind: 'mouse', button: 'right' };
        sample.checkin.dailyRecords['2026-05-18'].countsByItemId['manual-1'] = 99;
        sample.checkin.planTemplate.items[0].title = 'Mutated';

        expect(useSettingsStore.getState().dangerousChange?.nextValue).toBe(2.0);
        expect(usePomodoroStore.getState().endActionVideo.customVideoPath).toBe('/Users/xpy/Videos/focus-complete.mp4');
        expect(useNetworkStore.getState().players['p-1'].playerName).toBe('Player One');
        expect(useNetworkStore.getState().players['p-1'].state?.pomodoro.remainingSeconds).toBe(42);
        expect(useNetworkStore.getState().players['p-1'].state?.activeApp?.name).toBe('Focus App');
        expect(useNetworkStore.getState().players['p-1'].state?.bindingKey?.pressCount).toBe(7);
        expect(useBindingKeyStore.getState().entries[0].label).toBe('A');
        expect(useBindingKeyStore.getState().entries[0].input).toEqual({ kind: 'keyboard', code: 0 });
        expect(useCheckinStore.getState().dailyRecords['2026-05-18'].countsByItemId['manual-1']).toBe(1);
        expect(useCheckinStore.getState().planTemplate.items[0].title).toBe('Read');
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

    it('preserves the previous active app icon when a lightweight snapshot omits it', () => {
        applySnapshotToMirrors({
            ...makeSample(),
            activeApp: {
                name: 'Rider',
                bundle_id: 'com.jetbrains.rider',
                window_title: 'CPA_V2',
                icon_data_url: 'data:image/png;base64,heavy-icon',
            },
        });

        applySnapshotToMirrors({
            ...makeSample(),
            activeApp: {
                name: 'Rider',
                bundle_id: 'com.jetbrains.rider',
                window_title: 'CPA_V2 - host.ts',
            },
            bindingKey: {
                panelEnabled: true,
                entries: [{
                    id: 'bk-1',
                    label: 'A',
                    keyCode: 0,
                    pressCount: 3,
                    enabled: true,
                }],
                capturingId: null,
                syncedKeyId: null,
            },
        });

        expect(useActiveAppStore.getState().current).toEqual({
            name: 'Rider',
            bundle_id: 'com.jetbrains.rider',
            window_title: 'CPA_V2 - host.ts',
            icon_data_url: 'data:image/png;base64,heavy-icon',
        });
    });

    it('replaces the active app icon when an active-app-change snapshot includes a new one', () => {
        applySnapshotToMirrors({
            ...makeSample(),
            activeApp: {
                name: 'Rider',
                bundle_id: 'com.jetbrains.rider',
                window_title: 'CPA_V2',
                icon_data_url: 'data:image/png;base64,rider-icon',
            },
        });

        applySnapshotToMirrors({
            ...makeSample(),
            activeApp: {
                name: 'Safari',
                bundle_id: 'com.apple.Safari',
                window_title: 'Docs',
                icon_data_url: 'data:image/png;base64,safari-icon',
            },
        });

        expect(useActiveAppStore.getState().current).toEqual({
            name: 'Safari',
            bundle_id: 'com.apple.Safari',
            window_title: 'Docs',
            icon_data_url: 'data:image/png;base64,safari-icon',
        });
    });
});

describe('useBridgeClient', () => {
    it('keeps requesting the initial host snapshot until a mirror window is hydrated', async () => {
        vi.useFakeTimers();
        render(createElement(BridgeClientHost));

        await act(async () => {
            await Promise.resolve();
            await Promise.resolve();
        });
        expect(emitMock).toHaveBeenCalledTimes(1);

        await act(async () => {
            vi.advanceTimersByTime(1500);
            await Promise.resolve();
        });

        expect(emitMock).toHaveBeenCalledTimes(2);

        act(() => {
            eventHandlers.get(EVT_STATE)?.({ payload: makeSample() });
        });
        expect(screen.getByTestId('bridge-ready').textContent).toBe('ready');

        emitMock.mockClear();
        await act(async () => {
            vi.advanceTimersByTime(1500);
            await Promise.resolve();
        });

        expect(emitMock).not.toHaveBeenCalled();
    });
});
