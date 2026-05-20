import '@testing-library/jest-dom/vitest';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCheckinStore, type WeeklyCheckinPlan } from './domain/checkin';
import { usePomodoroStore } from './domain/pomodoro';

const {
    hydrateAppUpdate,
    loadPersistedCheckinMock,
    loadPersistedSettingsMock,
    readAutostartEnabledMock,
    savePersistedCheckinMock,
    savePersistedSettingsMock,
    startAutomaticChecks,
    useActiveAppListener,
    useBindingKeyListener,
    useBridgeHost,
    useCheckinWindowController,
    useInputCounterWindowController,
    useRemotePlayerWindowController,
    useStateSync,
    useAppUpdateStore,
} = vi.hoisted(() => {
    const hydrateAppUpdate = vi.fn(() => Promise.resolve());
    const startAutomaticChecks = vi.fn(() => vi.fn());
    const useAppUpdateStore = Object.assign(vi.fn(), {
        getState: vi.fn(() => ({
            hydrate: hydrateAppUpdate,
            startAutomaticChecks,
        })),
    });

    return {
        hydrateAppUpdate,
        loadPersistedCheckinMock: vi.fn(),
        loadPersistedSettingsMock: vi.fn(),
        readAutostartEnabledMock: vi.fn(),
        savePersistedCheckinMock: vi.fn(),
        savePersistedSettingsMock: vi.fn(),
        startAutomaticChecks,
        useActiveAppListener: vi.fn(),
        useBindingKeyListener: vi.fn(),
        useBridgeHost: vi.fn(),
        useCheckinWindowController: vi.fn(),
        useInputCounterWindowController: vi.fn(),
        useRemotePlayerWindowController: vi.fn(),
        useStateSync: vi.fn(),
        useAppUpdateStore,
    };
});

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(() => Promise.resolve()) }));
vi.mock('./domain/stateSync', () => ({ useStateSync }));
vi.mock('./domain/activeApp', () => ({ useActiveAppListener }));
vi.mock('./domain/bindingKey', () => ({ useBindingKeyListener }));
vi.mock('./domain/bridge/host', () => ({ useBridgeHost }));
vi.mock('./domain/checkinWindow', () => ({ useCheckinWindowController }));
vi.mock('./domain/inputCounterWindow', () => ({ useInputCounterWindowController }));
vi.mock('./domain/remotePlayerWindows', () => ({ useRemotePlayerWindowController }));
vi.mock('./domain/appUpdate', () => ({ useAppUpdateStore }));
vi.mock('./domain/autostart', () => ({ readAutostartEnabled: readAutostartEnabledMock }));
vi.mock('./domain/settingsPersistence', () => ({
    loadPersistedSettings: loadPersistedSettingsMock,
    savePersistedSettings: savePersistedSettingsMock,
}));
vi.mock('./domain/checkinPersistence', () => ({
    loadPersistedCheckin: loadPersistedCheckinMock,
    savePersistedCheckin: savePersistedCheckinMock,
}));
vi.mock('./ui/PomodoroPanel', () => ({
    PomodoroPanel: () => <div data-testid="pomodoro-panel" />,
}));
vi.mock('./ui/PomodoroEndActionLayer', () => ({
    PomodoroEndActionLayer: () => <div data-testid="pomodoro-end-layer" />,
}));
vi.mock('./ui/AppUpdateReadyNotice', () => ({
    AppUpdateReadyNotice: () => <div data-testid="app-update-ready-notice" />,
}));

const { default: App } = await import('./App');

const weeklyPlan: WeeklyCheckinPlan = {
    weekStartDate: '2026-05-18',
    carryToNextWeek: true,
    days: {
        mon: { kind: 'inherit' },
        tue: {
            kind: 'items',
            items: [{ id: 'pomo', title: '专注番茄', type: 'pomodoroFocus', targetCount: 2 }],
        },
        wed: { kind: 'rest' },
        thu: { kind: 'inherit' },
        fri: { kind: 'inherit' },
        sat: { kind: 'inherit' },
        sun: { kind: 'rest' },
    },
};

beforeEach(() => {
    vi.setSystemTime(new Date('2026-05-19T10:00:00+08:00'));
    loadPersistedCheckinMock.mockReset();
    loadPersistedCheckinMock.mockResolvedValue(null);
    savePersistedCheckinMock.mockReset();
    savePersistedCheckinMock.mockResolvedValue(undefined);
    loadPersistedSettingsMock.mockReset();
    loadPersistedSettingsMock.mockResolvedValue(null);
    readAutostartEnabledMock.mockReset();
    readAutostartEnabledMock.mockResolvedValue(false);
    savePersistedSettingsMock.mockReset();
    savePersistedSettingsMock.mockResolvedValue(undefined);
    hydrateAppUpdate.mockClear();
    startAutomaticChecks.mockClear();
    useStateSync.mockClear();
    useActiveAppListener.mockClear();
    useBindingKeyListener.mockClear();
    useBridgeHost.mockClear();
    useCheckinWindowController.mockClear();
    useInputCounterWindowController.mockClear();
    useRemotePlayerWindowController.mockClear();
    useCheckinStore.setState({
        weeklyPlan,
        dailyRecords: {},
        lastError: null,
    });
    usePomodoroStore.setState({
        focusDurationSeconds: 25 * 60,
        breakDurationSeconds: 5 * 60,
        totalRounds: 4,
        currentRound: 1,
        remainingSeconds: 25 * 60,
        currentPhase: 'focus',
        isRunning: false,
        isPinned: false,
        autoStartBreak: false,
        consecutiveCompletedFocus: 0,
        endActionMode: 'playVideo',
        endActionVideo: {
            sourceKind: 'builtin',
            builtinVideoId: 'nap',
            customVideoPath: '',
        },
        lastEndEvent: null,
    });
});

afterEach(() => {
    cleanup();
    vi.useRealTimers();
});

describe('checkin Pomodoro integration', () => {
    it('increments today pomodoroFocus items once per focus end event', () => {
        render(<App />);

        act(() => {
            usePomodoroStore.setState({
                lastEndEvent: { id: 9, fromPhase: 'focus', toPhase: 'break', triggeredBy: 'timer' },
            });
        });
        act(() => {
            usePomodoroStore.setState({
                lastEndEvent: { id: 9, fromPhase: 'focus', toPhase: 'break', triggeredBy: 'timer' },
            });
        });

        expect(useCheckinStore.getState().dailyRecords['2026-05-19'].countsByItemId.pomo).toBe(1);
    });

    it('ignores non-focus Pomodoro end events and keeps the checkin window controller mounted', () => {
        render(<App />);

        act(() => {
            usePomodoroStore.setState({
                lastEndEvent: { id: 10, fromPhase: 'break', toPhase: 'focus', triggeredBy: 'timer' },
            });
        });

        expect(useCheckinStore.getState().dailyRecords['2026-05-19']).toBeUndefined();
        expect(useCheckinWindowController).toHaveBeenCalledTimes(1);
    });
});
