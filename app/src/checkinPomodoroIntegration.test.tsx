import '@testing-library/jest-dom/vitest';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCheckinStore, type WeeklyCheckinPlan } from './domain/checkin';
import { usePomodoroStore } from './domain/pomodoro';
import { useSettingsStore } from './domain/settings';

const {
    hydrateAppUpdate,
    loadPersistedCheckinMock,
    loadPersistedSettingsMock,
    loadPersistedUserPreferencesMock,
    openCheckinEditorWindowMock,
    openTodayCheckinWindowMock,
    readAutostartEnabledMock,
    savePersistedCheckinMock,
    savePersistedSettingsMock,
    savePersistedUserPreferencesMock,
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
    function createMockStore(initialState: Record<string, unknown>): any {
        let state = { ...initialState };
        const subscribers = new Set<(next: any, previous: any) => void>();
        return Object.assign(vi.fn((selector?: (value: any) => unknown) => (
            selector ? selector(state) : state
        )), {
            getState: vi.fn(() => state),
            setState: vi.fn((patch: any) => {
                const previous = state;
                const next = typeof patch === 'function' ? patch(state) : patch;
                state = { ...state, ...next };
                subscribers.forEach((subscriber) => subscriber(state, previous));
            }),
            subscribe: vi.fn((subscriber: (next: any, previous: any) => void) => {
                subscribers.add(subscriber);
                return () => subscribers.delete(subscriber);
            }),
            reset: (nextState: Record<string, unknown>) => {
                state = { ...nextState };
                subscribers.clear();
            },
        });
    }

    const hydrateAppUpdate = vi.fn(() => Promise.resolve());
    const startAutomaticChecks = vi.fn(() => vi.fn());
    const useAppUpdateStore = createMockStore({
        autoUpdateEnabled: true,
        status: 'idle',
        currentVersion: null,
        availableVersion: null,
        releaseNotes: null,
        lastCheckedAt: null,
        errorMessage: null,
        hydrate: hydrateAppUpdate,
        startAutomaticChecks,
    });

    return {
        hydrateAppUpdate,
        loadPersistedCheckinMock: vi.fn(),
        loadPersistedSettingsMock: vi.fn(),
        loadPersistedUserPreferencesMock: vi.fn(),
        openCheckinEditorWindowMock: vi.fn(),
        openTodayCheckinWindowMock: vi.fn(),
        readAutostartEnabledMock: vi.fn(),
        savePersistedCheckinMock: vi.fn(),
        savePersistedSettingsMock: vi.fn(),
        savePersistedUserPreferencesMock: vi.fn(),
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
vi.mock('./domain/bindingKey', async (importOriginal) => {
    const actual = await importOriginal<typeof import('./domain/bindingKey')>();
    return { ...actual, useBindingKeyListener };
});
vi.mock('./domain/bridge/host', () => ({ useBridgeHost }));
vi.mock('./domain/checkinWindow', () => ({
    openCheckinEditorWindow: openCheckinEditorWindowMock,
    openTodayCheckinWindow: openTodayCheckinWindowMock,
    useCheckinWindowController,
}));
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
vi.mock('./domain/userPreferencesPersistence', () => ({
    loadPersistedUserPreferences: loadPersistedUserPreferencesMock,
    savePersistedUserPreferences: savePersistedUserPreferencesMock,
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
    openCheckinEditorWindowMock.mockReset();
    openCheckinEditorWindowMock.mockResolvedValue(undefined);
    openTodayCheckinWindowMock.mockReset();
    openTodayCheckinWindowMock.mockResolvedValue(undefined);
    readAutostartEnabledMock.mockReset();
    readAutostartEnabledMock.mockResolvedValue(false);
    savePersistedSettingsMock.mockReset();
    savePersistedSettingsMock.mockResolvedValue(undefined);
    loadPersistedUserPreferencesMock.mockReset();
    loadPersistedUserPreferencesMock.mockResolvedValue(null);
    savePersistedUserPreferencesMock.mockReset();
    savePersistedUserPreferencesMock.mockResolvedValue(undefined);
    hydrateAppUpdate.mockClear();
    startAutomaticChecks.mockClear();
    useAppUpdateStore.reset({
        autoUpdateEnabled: true,
        status: 'idle',
        currentVersion: null,
        availableVersion: null,
        releaseNotes: null,
        lastCheckedAt: null,
        errorMessage: null,
        hydrate: hydrateAppUpdate,
        startAutomaticChecks,
    });
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
    useSettingsStore.setState({
        uiScale: 1,
        committedUiScale: 1,
        autostartEnabled: false,
        checkinEnabled: true,
        dangerousChange: null,
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

    it('counts later Pomodoro sessions after reset because end event ids keep increasing', () => {
        render(<App />);

        act(() => {
            usePomodoroStore.getState().applySettings(1, 60, 4, true, false);
            usePomodoroStore.getState().start();
            usePomodoroStore.getState().tick(1);
        });
        act(() => {
            usePomodoroStore.getState().reset();
            usePomodoroStore.getState().start();
            usePomodoroStore.getState().tick(1);
        });

        const record = useCheckinStore.getState().dailyRecords['2026-05-19'];
        expect(record.countsByItemId.pomo).toBe(2);
        expect(record.processedPomodoroEndEventIds).toEqual([1, 2]);
    });

    it('opens the check-in panel, not the plan editor, when a focus timer naturally ends', () => {
        render(<App />);

        act(() => {
            usePomodoroStore.setState({
                lastEndEvent: { id: 11, fromPhase: 'focus', toPhase: 'break', triggeredBy: 'timer' },
            });
        });

        expect(openTodayCheckinWindowMock).toHaveBeenCalledTimes(1);
        expect(openCheckinEditorWindowMock).not.toHaveBeenCalled();
    });

    it('does not open the check-in editor when focus is skipped manually', () => {
        render(<App />);

        act(() => {
            usePomodoroStore.setState({
                lastEndEvent: { id: 12, fromPhase: 'focus', toPhase: 'break', triggeredBy: 'skip' },
            });
        });

        expect(openCheckinEditorWindowMock).not.toHaveBeenCalled();
    });

    it('does not auto-pin the main window when focus naturally ends', () => {
        const setPinnedSpy = vi.spyOn(usePomodoroStore.getState(), 'setPinned');
        render(<App />);

        act(() => {
            usePomodoroStore.setState({
                lastEndEvent: { id: 13, fromPhase: 'focus', toPhase: 'break', triggeredBy: 'timer' },
            });
        });

        expect(setPinnedSpy).not.toHaveBeenCalled();
        expect(usePomodoroStore.getState().isPinned).toBe(false);
        setPinnedSpy.mockRestore();
    });

    it('does not write check-in records or open check-in panel when check-in is disabled', () => {
        useSettingsStore.setState({ checkinEnabled: false });
        render(<App />);

        act(() => {
            usePomodoroStore.setState({
                lastEndEvent: { id: 14, fromPhase: 'focus', toPhase: 'break', triggeredBy: 'timer' },
            });
        });

        expect(useCheckinStore.getState().dailyRecords).toEqual({});
        expect(openTodayCheckinWindowMock).not.toHaveBeenCalled();
    });
});
