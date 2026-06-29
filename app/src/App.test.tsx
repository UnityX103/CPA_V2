import '@testing-library/jest-dom/vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSettingsStore } from './domain/settings';
import {
    defaultPlanTemplate,
    migrateWeeklyPlanToTemplate,
    useCheckinStore,
    type WeeklyCheckinPlan,
} from './domain/checkin';
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
        checkinEnabled: true,
        planPanelEnabled: true,
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
        checkinEnabled: true,
        planPanelEnabled: true,
        dangerousChange: null,
    });
    usePomodoroStore.setState({
        currentPhase: 'focus',
        isRunning: false,
        isPinned: false,
        lastEndEvent: null,
    });
    useCheckinStore.setState({
        planTemplate: defaultPlanTemplate(),
        dailyRecords: {},
        lastError: null,
    });
});

afterEach(() => {
    vi.useRealTimers();
    cleanup();
});

describe('main App window composition', () => {
    it('renders the Pomodoro panel in the main window', () => {
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
                    baseWidth: 605,
                    baseHeight: 404,
                    minWidth: 605,
                    minHeight: 404,
                    scale: 1.5,
                    defaultCenter: false,
                },
            });
        });
    });

    it('does not resize with default scale before persisted settings hydrate', async () => {
        let resolveSettings!: (value: {
            uiScale: number;
            autostartEnabled: boolean;
            checkinEnabled: boolean;
            planPanelEnabled: boolean;
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
            checkinEnabled: true,
            planPanelEnabled: true,
        });

        await waitFor(() => {
            expect(invokeMock).toHaveBeenCalledWith('resize_scaled_window', {
                args: {
                    label: 'main',
                    baseWidth: 605,
                    baseHeight: 404,
                    minWidth: 605,
                    minHeight: 404,
                    scale: 1.5,
                    defaultCenter: false,
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
            checkinEnabled: true,
            planPanelEnabled: true,
        });
        readAutostartEnabledMock.mockResolvedValue(true);

        render(<App />);

        await waitFor(() => expect(useSettingsStore.getState().autostartEnabled).toBe(true));
        expect(readAutostartEnabledMock).toHaveBeenCalledWith(false);
        await waitFor(() => expect(savePersistedUserPreferencesMock).toHaveBeenCalledWith(
            expect.objectContaining({
                settings: { uiScale: 1.25, autostartEnabled: true, checkinEnabled: true, planPanelEnabled: true },
            }),
        ));
    });

    it('hydrates checkinEnabled from legacy settings when no unified preferences exist', async () => {
        loadPersistedSettingsMock.mockResolvedValue({
            uiScale: 1.25,
            autostartEnabled: false,
            checkinEnabled: false,
            planPanelEnabled: true,
        });

        render(<App />);

        await waitFor(() => expect(useSettingsStore.getState().checkinEnabled).toBe(false));
        await waitFor(() => expect(savePersistedUserPreferencesMock).toHaveBeenCalledWith(
            expect.objectContaining({
                settings: { uiScale: 1.25, autostartEnabled: false, checkinEnabled: false, planPanelEnabled: true },
            }),
        ));
        expect(invokeMock).not.toHaveBeenCalledWith('open_today_checkin_window');
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
                settings: { uiScale: 1, autostartEnabled: false, checkinEnabled: true, planPanelEnabled: true },
            }),
        );
    });

    it('does not let late startup hydration overwrite early settings changes', async () => {
        let resolveAutostart!: (value: boolean) => void;
        loadPersistedSettingsMock.mockResolvedValue({
            uiScale: 1.25,
            autostartEnabled: false,
            checkinEnabled: true,
            planPanelEnabled: true,
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
            checkinEnabled: true,
            planPanelEnabled: true,
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
                settings: { uiScale: 1.5, autostartEnabled: true, checkinEnabled: true, planPanelEnabled: true },
            }),
        ));
    });

    it('hydrates unified local preferences when account restore falls back to guest', async () => {
        loadPersistedUserPreferencesMock.mockResolvedValue({
            schemaVersion: 1,
            pomodoro: {
                focusDurationSeconds: 900,
                breakDurationSeconds: 120,
                totalRounds: 2,
                autoStartBreak: true,
                autoPinAfterFocus: true,
                endActionMode: 'topWindow',
                endActionVideo: { sourceKind: 'builtin', builtinVideoId: 'qianqian', customVideoPath: '' },
            },
            settings: {
                uiScale: 1.25,
                autostartEnabled: false,
                checkinEnabled: false,
                planPanelEnabled: false,
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
                planTemplate: defaultPlanTemplate(),
                dailyRecords: {},
            },
        });
        restoreAccountSession.mockImplementation(async () => {
            useNetworkStore.setState({ accountStatus: 'guest' });
        });

        render(<App />);

        await waitFor(() => expect(restoreAccountSession).toHaveBeenCalledTimes(1));
        expect(usePomodoroStore.getState().focusDurationSeconds).toBe(900);
        expect(useAppUpdateStore.getState().autoUpdateEnabled).toBe(false);
        expect(useNetworkStore.getState().autoConnect).toBe(true);
        expect(useNetworkStore.getState().playerName).toBe('Alice');
        expect(useSettingsStore.getState().checkinEnabled).toBe(false);
        expect(useSettingsStore.getState().planPanelEnabled).toBe(false);
        expect(useBindingKeyStore.getState().panelEnabled).toBe(false);
        expect(useBindingKeyStore.getState().entries[0]).toEqual(expect.objectContaining({
            label: 'Space',
            pressCount: 0,
        }));
        expect(restoreAccountSession).toHaveBeenCalledTimes(1);
        expect(savePersistedUserPreferencesMock).toHaveBeenCalledWith(expect.objectContaining({
            pomodoro: expect.objectContaining({ focusDurationSeconds: 900 }),
        }));
    });

    it('opens the today check-in window after startup when unified preferences enable check-in and omit the plan panel flag', async () => {
        loadPersistedUserPreferencesMock.mockResolvedValue({
            schemaVersion: 1,
            pomodoro: {
                focusDurationSeconds: 1500,
                breakDurationSeconds: 300,
                totalRounds: 4,
                autoStartBreak: true,
                autoPinAfterFocus: true,
                endActionMode: 'playVideo',
                endActionVideo: { sourceKind: 'builtin', builtinVideoId: 'qianqian', customVideoPath: '' },
            },
            settings: {
                uiScale: 1.03,
                autostartEnabled: true,
                checkinEnabled: true,
            },
            appUpdate: {
                autoUpdateEnabled: true,
            },
            network: {
                autoConnect: true,
                playerName: 'Xpy',
            },
            bindingKey: {
                panelEnabled: false,
                entries: [],
                syncedKeyId: null,
            },
            checkin: {
                planTemplate: defaultPlanTemplate(),
                dailyRecords: {},
            },
        });
        restoreAccountSession.mockImplementation(async () => {
            useNetworkStore.setState({ accountStatus: 'guest' });
        });

        render(<App />);

        await waitFor(() => {
            expect(invokeMock).toHaveBeenCalledWith('open_today_checkin_window');
        });
    });

    it('opens the today check-in window from local preferences when account restore hangs', async () => {
        vi.useFakeTimers();
        loadPersistedUserPreferencesMock.mockResolvedValue({
            schemaVersion: 1,
            pomodoro: {
                focusDurationSeconds: 1500,
                breakDurationSeconds: 300,
                totalRounds: 4,
                autoStartBreak: true,
                autoPinAfterFocus: true,
                endActionMode: 'playVideo',
                endActionVideo: { sourceKind: 'builtin', builtinVideoId: 'qianqian', customVideoPath: '' },
            },
            settings: {
                uiScale: 1.03,
                autostartEnabled: true,
                checkinEnabled: true,
                planPanelEnabled: true,
            },
            appUpdate: {
                autoUpdateEnabled: true,
            },
            network: {
                autoConnect: true,
                playerName: 'Xpy',
            },
            bindingKey: {
                panelEnabled: false,
                entries: [],
                syncedKeyId: null,
            },
            checkin: {
                planTemplate: defaultPlanTemplate(),
                dailyRecords: {},
            },
        });
        restoreAccountSession.mockImplementation(() => new Promise(() => {}));

        render(<App />);

        await act(async () => {
            await Promise.resolve();
            await Promise.resolve();
            await Promise.resolve();
        });
        expect(restoreAccountSession).toHaveBeenCalledTimes(1);
        expect(invokeMock).not.toHaveBeenCalledWith('open_today_checkin_window');

        await act(async () => {
            vi.advanceTimersByTime(2500);
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(invokeMock).toHaveBeenCalledWith('open_today_checkin_window');
    });

    it('prefers cloud archive when saved session restores successfully', async () => {
        loadPersistedUserPreferencesMock.mockResolvedValue({
            schemaVersion: 1,
            pomodoro: {
                focusDurationSeconds: 900,
                breakDurationSeconds: 120,
                totalRounds: 2,
                autoStartBreak: false,
                autoPinAfterFocus: true,
                endActionMode: 'playVideo',
                endActionVideo: { sourceKind: 'builtin', builtinVideoId: 'default', customVideoPath: '' },
            },
            settings: {
                uiScale: 1.1,
                autostartEnabled: false,
                checkinEnabled: true,
                planPanelEnabled: true,
            },
            appUpdate: {
                autoUpdateEnabled: true,
            },
            network: {
                autoConnect: false,
                playerName: 'Local',
            },
            bindingKey: {
                panelEnabled: true,
                entries: [],
                syncedKeyId: null,
            },
            checkin: {
                planTemplate: defaultPlanTemplate(),
                dailyRecords: {},
            },
        });
        restoreAccountSession.mockImplementation(async () => {
            useNetworkStore.setState({
                accountStatus: 'loggedIn',
                accountUser: { userId: 'u1', username: 'Alice' },
                cloudSyncStatus: 'synced',
                cloudDataUpdatedAt: 10,
                cloudData: {
                    schemaVersion: 1,
                    updatedAt: 10,
                    pomodoro: {
                        focusDurationSeconds: 1800,
                        breakDurationSeconds: 300,
                        totalRounds: 3,
                        autoStartBreak: true,
                        autoPinAfterFocus: false,
                        endActionMode: 'topWindow',
                        endActionVideo: { sourceKind: 'builtin', builtinVideoId: 'qianqian', customVideoPath: '' },
                    },
                    settings: {
                        uiScale: 1.4,
                        autostartEnabled: false,
                        checkinEnabled: false,
                        planPanelEnabled: false,
                    },
                    appUpdate: {
                        autoUpdateEnabled: false,
                    },
                    network: {
                        autoConnect: true,
                        playerName: 'Cloud',
                    },
                    bindingKey: {
                        panelEnabled: false,
                        entries: [],
                        syncedKeyId: null,
                    },
                    checkin: {
                        planTemplate: defaultPlanTemplate(),
                        dailyRecords: {},
                    },
                },
            });
        });

        render(<App />);

        await waitFor(() => expect(usePomodoroStore.getState().focusDurationSeconds).toBe(1800));
        expect(useNetworkStore.getState().playerName).toBe('Cloud');
        expect(useSettingsStore.getState().checkinEnabled).toBe(false);
        expect(useSettingsStore.getState().planPanelEnabled).toBe(false);
        expect(savePersistedUserPreferencesMock).toHaveBeenCalledWith(expect.objectContaining({
            pomodoro: expect.objectContaining({ focusDurationSeconds: 1800 }),
            network: expect.objectContaining({ playerName: 'Cloud' }),
        }));
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
        const migratedTemplate = migrateWeeklyPlanToTemplate(oldPlan);
        loadPersistedCheckinMock.mockResolvedValue({
            schemaVersion: 2,
            planTemplate: migratedTemplate,
            dailyRecords: {},
        });

        render(<App />);

        await waitFor(() => expect(savePersistedUserPreferencesMock).toHaveBeenCalledWith(
            expect.objectContaining({
                checkin: {
                    planTemplate: migratedTemplate,
                    dailyRecords: {},
                },
            }),
        ));
        expect(savePersistedCheckinMock).not.toHaveBeenCalled();
    });
});
