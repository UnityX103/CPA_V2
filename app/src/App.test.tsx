import '@testing-library/jest-dom/vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSettingsStore } from './domain/settings';
import { defaultWeeklyPlan, useCheckinStore, type WeeklyCheckinPlan } from './domain/checkin';
import { usePomodoroStore } from './domain/pomodoro';

const {
    appUpdateCleanup,
    hydrateAppUpdate,
    invokeMock,
    loadPersistedCheckinMock,
    loadPersistedSettingsMock,
    loadPersistedUserPreferencesMock,
    readAutostartEnabledMock,
    savePersistedCheckinMock,
    savePersistedSettingsMock,
    savePersistedUserPreferencesMock,
    startAutomaticChecks,
    restoreAccountSession,
    useStateSync,
    useCloudAccountSync,
    useActiveAppListener,
    useBindingKeyListener,
    useBridgeHost,
    useInputCounterWindowController,
    useRemotePlayerWindowController,
    useAppUpdateStore,
    useBindingKeyStore,
    useNetworkStore,
} = vi.hoisted(() => {
    function createMockStore(initialState: Record<string, unknown>): any {
        let state = { ...initialState };
        const subscribers = new Set<(next: any, previous: any) => void>();
        const store = Object.assign(vi.fn((selector?: (value: any) => unknown) => (
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
        return store;
    }

    const appUpdateCleanup = vi.fn();
    const hydrateAppUpdate = vi.fn(() => Promise.resolve());
    const startAutomaticChecks = vi.fn(() => appUpdateCleanup);
    const restoreAccountSession = vi.fn(() => Promise.resolve());
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
    const useBindingKeyStore = createMockStore({
        panelEnabled: true,
        entries: [],
        syncedKeyId: null,
        capturingId: null,
    });
    const useNetworkStore = createMockStore({
        status: 'idle',
        serverUrl: 'ws://127.0.0.1:8039',
        autoConnect: false,
        roomCode: '',
        playerName: '我',
        playerId: null,
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
        restoreAccountSession,
    });
    return {
        appUpdateCleanup,
        hydrateAppUpdate,
        invokeMock: vi.fn(),
        loadPersistedCheckinMock: vi.fn(),
        loadPersistedSettingsMock: vi.fn(),
        loadPersistedUserPreferencesMock: vi.fn(),
        readAutostartEnabledMock: vi.fn(),
        savePersistedCheckinMock: vi.fn(),
        savePersistedSettingsMock: vi.fn(),
        savePersistedUserPreferencesMock: vi.fn(),
        startAutomaticChecks,
        restoreAccountSession,
        useStateSync: vi.fn(),
        useCloudAccountSync: vi.fn(),
        useActiveAppListener: vi.fn(),
        useBindingKeyListener: vi.fn(),
        useBridgeHost: vi.fn(),
        useInputCounterWindowController: vi.fn(),
        useRemotePlayerWindowController: vi.fn(),
        useAppUpdateStore,
        useBindingKeyStore,
        useNetworkStore,
    };
});

vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));
vi.mock('./domain/stateSync', () => ({ useStateSync }));
vi.mock('./domain/cloudAccountSync', () => ({ useCloudAccountSync }));
vi.mock('./domain/activeApp', () => ({ useActiveAppListener }));
vi.mock('./domain/bindingKey', () => ({ useBindingKeyListener, useBindingKeyStore }));
vi.mock('./domain/bridge/host', () => ({ useBridgeHost }));
vi.mock('./domain/inputCounterWindow', () => ({ useInputCounterWindowController }));
vi.mock('./domain/remotePlayerWindows', () => ({ useRemotePlayerWindowController }));
vi.mock('./domain/appUpdate', () => ({ useAppUpdateStore }));
vi.mock('./domain/network', () => ({ useNetworkStore }));
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
vi.mock('./ui/RemoteRoster', () => ({
    RemoteRoster: () => <div data-testid="remote-roster" />,
}));

const { default: App } = await import('./App');

function currentWeekStartFor(date: Date): string {
    const d = new Date(date);
    d.setHours(12, 0, 0, 0);
    const diff = (d.getDay() + 6) % 7;
    d.setDate(d.getDate() - diff);
    return d.toISOString().slice(0, 10);
}

beforeEach(() => {
    appUpdateCleanup.mockClear();
    hydrateAppUpdate.mockClear();
    startAutomaticChecks.mockClear();
    invokeMock.mockReset();
    invokeMock.mockResolvedValue(undefined);
    useStateSync.mockClear();
    useCloudAccountSync.mockClear();
    useActiveAppListener.mockClear();
    useBindingKeyListener.mockClear();
    useBridgeHost.mockClear();
    useInputCounterWindowController.mockClear();
    useRemotePlayerWindowController.mockClear();
    restoreAccountSession.mockClear();
    restoreAccountSession.mockResolvedValue(undefined);
    useNetworkStore.reset({
        status: 'idle',
        serverUrl: 'ws://127.0.0.1:8039',
        autoConnect: false,
        roomCode: '',
        playerName: '我',
        playerId: null,
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
        restoreAccountSession,
    });
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
    useBindingKeyStore.reset({
        panelEnabled: true,
        entries: [],
        syncedKeyId: null,
        capturingId: null,
    });
    loadPersistedCheckinMock.mockReset();
    loadPersistedCheckinMock.mockResolvedValue(null);
    savePersistedCheckinMock.mockReset();
    savePersistedCheckinMock.mockResolvedValue(undefined);
    loadPersistedSettingsMock.mockReset();
    loadPersistedSettingsMock.mockResolvedValue({
        uiScale: 1.5,
        autostartEnabled: false,
    });
    loadPersistedUserPreferencesMock.mockReset();
    loadPersistedUserPreferencesMock.mockResolvedValue(null);
    savePersistedUserPreferencesMock.mockReset();
    savePersistedUserPreferencesMock.mockResolvedValue(undefined);
    readAutostartEnabledMock.mockReset();
    readAutostartEnabledMock.mockResolvedValue(false);
    savePersistedSettingsMock.mockReset();
    savePersistedSettingsMock.mockResolvedValue(undefined);
    useSettingsStore.setState({
        uiScale: 1,
        committedUiScale: 1,
        autostartEnabled: false,
        dangerousChange: null,
    });
    usePomodoroStore.setState({
        currentPhase: 'focus',
        isRunning: false,
        isPinned: false,
        lastEndEvent: null,
    });
    useCheckinStore.setState({
        weeklyPlan: defaultWeeklyPlan(currentWeekStartFor(new Date())),
        dailyRecords: {},
        lastError: null,
    });
});

afterEach(() => {
    cleanup();
});

describe('main App window composition', () => {
    it('renders only the Pomodoro panel in the main window', () => {
        render(<App />);

        expect(screen.getByTestId('pomodoro-panel')).toBeInTheDocument();
        expect(screen.queryByTestId('remote-roster')).toBeNull();
        expect(useStateSync).toHaveBeenCalledTimes(1);
        expect(useCloudAccountSync).toHaveBeenCalledTimes(1);
        expect(useActiveAppListener).toHaveBeenCalledTimes(1);
        expect(useBindingKeyListener).toHaveBeenCalledTimes(1);
        expect(useBridgeHost).toHaveBeenCalledTimes(1);
        expect(useInputCounterWindowController).toHaveBeenCalledTimes(1);
        expect(useRemotePlayerWindowController).toHaveBeenCalledTimes(1);
    });

    it('renders the app update restart notice layer', () => {
        render(<App />);

        expect(screen.getByTestId('app-update-ready-notice')).toBeInTheDocument();
    });

    it('restores persisted account session on startup', async () => {
        render(<App />);

        await waitFor(() => expect(restoreAccountSession).toHaveBeenCalledTimes(1));
    });

    it('hydrates app update settings before starting automatic checks', async () => {
        render(<App />);

        await waitFor(() => expect(startAutomaticChecks).toHaveBeenCalledTimes(1));
        expect(hydrateAppUpdate).toHaveBeenCalledTimes(1);
        expect(hydrateAppUpdate.mock.invocationCallOrder[0]).toBeLessThan(
            startAutomaticChecks.mock.invocationCallOrder[0],
        );
    });

    it('cleans up app update automatic checks on unmount', async () => {
        const rendered = render(<App />);
        await waitFor(() => expect(startAutomaticChecks).toHaveBeenCalledTimes(1));

        rendered.unmount();

        expect(appUpdateCleanup).toHaveBeenCalledTimes(1);
    });

    it('requests native resize for the main window when global scale is active', async () => {
        render(<App />);

        await waitFor(() => {
            expect(invokeMock).toHaveBeenCalledWith('resize_scaled_window', {
                args: {
                    label: 'main',
                    baseWidth: 249,
                    baseHeight: 171,
                    minWidth: 249,
                    minHeight: 171,
                    scale: 1.5,
                    center: false,
                },
            });
        });
    });

    it('does not resize with default scale before persisted settings hydrate', async () => {
        let resolveSettings!: (value: {
            uiScale: number;
            autostartEnabled: boolean;
        }) => void;
        loadPersistedSettingsMock.mockReturnValue(new Promise((resolve) => {
            resolveSettings = resolve;
        }));

        render(<App />);

        await Promise.resolve();
        expect(invokeMock).not.toHaveBeenCalledWith('resize_scaled_window', expect.anything());

        resolveSettings({
            uiScale: 1.5,
            autostartEnabled: false,
        });

        await waitFor(() => {
            expect(invokeMock).toHaveBeenCalledWith('resize_scaled_window', {
                args: {
                    label: 'main',
                    baseWidth: 249,
                    baseHeight: 171,
                    minWidth: 249,
                    minHeight: 171,
                    scale: 1.5,
                    center: false,
                },
            });
        });
        expect(invokeMock).not.toHaveBeenCalledWith('resize_scaled_window', {
            args: expect.objectContaining({ label: 'main', scale: 1 }),
        });
    });

    it('hydrates autostart from the confirmed native plugin state', async () => {
        loadPersistedSettingsMock.mockResolvedValue({
            uiScale: 1.25,
            autostartEnabled: false,
        });
        readAutostartEnabledMock.mockResolvedValue(true);

        render(<App />);

        await waitFor(() => expect(useSettingsStore.getState().autostartEnabled).toBe(true));
        expect(readAutostartEnabledMock).toHaveBeenCalledWith(false);
        await waitFor(() => expect(savePersistedUserPreferencesMock).toHaveBeenCalledWith(
            expect.objectContaining({
                settings: { uiScale: 1.25, autostartEnabled: true },
            }),
        ));
    });

    it('keeps autostart off when no persisted settings exist', async () => {
        useSettingsStore.setState({ autostartEnabled: true });
        loadPersistedSettingsMock.mockResolvedValue(null);
        readAutostartEnabledMock.mockResolvedValue(false);

        render(<App />);

        await waitFor(() => expect(useSettingsStore.getState().autostartEnabled).toBe(false));
        expect(readAutostartEnabledMock).toHaveBeenCalledWith(false);
        expect(savePersistedSettingsMock).not.toHaveBeenCalled();
        expect(savePersistedUserPreferencesMock).toHaveBeenCalledWith(
            expect.objectContaining({
                settings: { uiScale: 1, autostartEnabled: false },
            }),
        );
    });

    it('does not let late startup hydration overwrite early settings changes', async () => {
        let resolveAutostart!: (value: boolean) => void;
        loadPersistedSettingsMock.mockResolvedValue({
            uiScale: 1.25,
            autostartEnabled: false,
        });
        readAutostartEnabledMock.mockReturnValue(new Promise((resolve) => {
            resolveAutostart = resolve;
        }));

        render(<App />);

        await waitFor(() => expect(readAutostartEnabledMock).toHaveBeenCalledWith(false));

        useSettingsStore.setState({ autostartEnabled: true });

        await act(async () => {
            resolveAutostart(false);
        });

        await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('resize_scaled_window', {
            args: expect.objectContaining({ label: 'main' }),
        }));
        expect(useSettingsStore.getState().autostartEnabled).toBe(true);
        expect(savePersistedSettingsMock).not.toHaveBeenCalled();
        expect(savePersistedUserPreferencesMock).toHaveBeenCalledWith(
            expect.objectContaining({
                settings: expect.objectContaining({ autostartEnabled: true }),
            }),
        );
    });

    it('reconciles autostart while preserving unrelated settings changed during native read', async () => {
        let resolveAutostart!: (value: boolean) => void;
        loadPersistedSettingsMock.mockResolvedValue({
            uiScale: 1.25,
            autostartEnabled: false,
        });
        readAutostartEnabledMock.mockReturnValue(new Promise((resolve) => {
            resolveAutostart = resolve;
        }));

        render(<App />);

        await waitFor(() => expect(readAutostartEnabledMock).toHaveBeenCalledWith(false));

        useSettingsStore.setState({
            uiScale: 1.5,
            committedUiScale: 1.5,
        });

        await act(async () => {
            resolveAutostart(true);
        });

        await waitFor(() => expect(useSettingsStore.getState().autostartEnabled).toBe(true));
        expect(useSettingsStore.getState().uiScale).toBe(1.5);
        expect(useSettingsStore.getState().committedUiScale).toBe(1.5);
        await waitFor(() => expect(savePersistedUserPreferencesMock).toHaveBeenCalledWith(
            expect.objectContaining({
                settings: { uiScale: 1.5, autostartEnabled: true },
            }),
        ));
    });

    it('hydrates unified local preferences before restoring account session', async () => {
        loadPersistedUserPreferencesMock.mockResolvedValue({
            schemaVersion: 1,
            pomodoro: {
                focusDurationSeconds: 900,
                breakDurationSeconds: 120,
                totalRounds: 2,
                autoStartBreak: true,
                endActionMode: 'topWindow',
                endActionVideo: { sourceKind: 'builtin', builtinVideoId: 'qianqian', customVideoPath: '' },
            },
            settings: {
                uiScale: 1.25,
                autostartEnabled: false,
            },
            appUpdate: {
                autoUpdateEnabled: false,
            },
            network: {
                autoConnect: true,
                playerName: 'Alice',
            },
            bindingKey: {
                panelEnabled: false,
                entries: [{
                    id: 'space',
                    label: 'Space',
                    keyCode: 49,
                    input: { kind: 'keyboard', code: 49 },
                    enabled: true,
                }],
                syncedKeyId: 'space',
            },
            checkin: {
                weeklyPlan: defaultWeeklyPlan('2026-05-18'),
                dailyRecords: {},
            },
        });

        render(<App />);

        await waitFor(() => expect(restoreAccountSession).toHaveBeenCalledTimes(1));
        expect(usePomodoroStore.getState().focusDurationSeconds).toBe(900);
        expect(useAppUpdateStore.getState().autoUpdateEnabled).toBe(false);
        expect(useNetworkStore.getState().autoConnect).toBe(true);
        expect(useNetworkStore.getState().playerName).toBe('Alice');
        expect(useBindingKeyStore.getState().panelEnabled).toBe(false);
        expect(useBindingKeyStore.getState().entries[0]).toEqual(expect.objectContaining({
            label: 'Space',
            pressCount: 0,
        }));
        expect(savePersistedUserPreferencesMock.mock.invocationCallOrder[0]).toBeLessThan(
            restoreAccountSession.mock.invocationCallOrder[0],
        );
    });

    it('persists checkin state after startup roll-forward', async () => {
        const oldPlan: WeeklyCheckinPlan = {
            weekStartDate: '2026-05-11',
            carryToNextWeek: true,
            days: {
                mon: {
                    kind: 'items',
                    items: [{ id: 'read', title: '阅读', type: 'manual', targetCount: 2 }],
                },
                tue: { kind: 'inherit' },
                wed: { kind: 'inherit' },
                thu: { kind: 'inherit' },
                fri: { kind: 'inherit' },
                sat: { kind: 'inherit' },
                sun: { kind: 'rest' },
            },
        };
        loadPersistedCheckinMock.mockResolvedValue({
            schemaVersion: 1,
            weeklyPlan: oldPlan,
            dailyRecords: {},
        });

        render(<App />);

        await waitFor(() => expect(savePersistedUserPreferencesMock).toHaveBeenCalledWith(
            expect.objectContaining({
                checkin: {
                    weeklyPlan: {
                        ...oldPlan,
                        weekStartDate: currentWeekStartFor(new Date()),
                    },
                    dailyRecords: {},
                },
            }),
        ));
        expect(savePersistedCheckinMock).not.toHaveBeenCalled();
    });
});
