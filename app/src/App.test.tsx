import '@testing-library/jest-dom/vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSettingsStore } from './domain/settings';
import { defaultWeeklyPlan, useCheckinStore, type WeeklyCheckinPlan } from './domain/checkin';

const {
    appUpdateCleanup,
    hydrateAppUpdate,
    invokeMock,
    loadPersistedCheckinMock,
    loadPersistedSettingsMock,
    readAutostartEnabledMock,
    savePersistedCheckinMock,
    savePersistedSettingsMock,
    startAutomaticChecks,
    restoreAccountSession,
    useStateSync,
    useActiveAppListener,
    useBindingKeyListener,
    useBridgeHost,
    useInputCounterWindowController,
    useRemotePlayerWindowController,
    useAppUpdateStore,
} = vi.hoisted(() => {
    const appUpdateCleanup = vi.fn();
    const hydrateAppUpdate = vi.fn(() => Promise.resolve());
    const startAutomaticChecks = vi.fn(() => appUpdateCleanup);
    const useAppUpdateStore = Object.assign(vi.fn(), {
        getState: vi.fn(() => ({
            hydrate: hydrateAppUpdate,
            startAutomaticChecks,
        })),
    });
    return {
        appUpdateCleanup,
        hydrateAppUpdate,
        invokeMock: vi.fn(),
        loadPersistedCheckinMock: vi.fn(),
        loadPersistedSettingsMock: vi.fn(),
        readAutostartEnabledMock: vi.fn(),
        savePersistedCheckinMock: vi.fn(),
        savePersistedSettingsMock: vi.fn(),
        startAutomaticChecks,
        restoreAccountSession: vi.fn(() => Promise.resolve()),
        useStateSync: vi.fn(),
        useActiveAppListener: vi.fn(),
        useBindingKeyListener: vi.fn(),
        useBridgeHost: vi.fn(),
        useInputCounterWindowController: vi.fn(),
        useRemotePlayerWindowController: vi.fn(),
        useAppUpdateStore,
    };
});

vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));
vi.mock('./domain/stateSync', () => ({ useStateSync }));
vi.mock('./domain/activeApp', () => ({ useActiveAppListener }));
vi.mock('./domain/bindingKey', () => ({ useBindingKeyListener }));
vi.mock('./domain/bridge/host', () => ({ useBridgeHost }));
vi.mock('./domain/inputCounterWindow', () => ({ useInputCounterWindowController }));
vi.mock('./domain/remotePlayerWindows', () => ({ useRemotePlayerWindowController }));
vi.mock('./domain/appUpdate', () => ({ useAppUpdateStore }));
vi.mock('./domain/network', () => ({
    useNetworkStore: {
        getState: vi.fn(() => ({
            restoreAccountSession,
        })),
    },
}));
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
    useActiveAppListener.mockClear();
    useBindingKeyListener.mockClear();
    useBridgeHost.mockClear();
    useInputCounterWindowController.mockClear();
    useRemotePlayerWindowController.mockClear();
    restoreAccountSession.mockClear();
    restoreAccountSession.mockResolvedValue(undefined);
    loadPersistedCheckinMock.mockReset();
    loadPersistedCheckinMock.mockResolvedValue(null);
    savePersistedCheckinMock.mockReset();
    savePersistedCheckinMock.mockResolvedValue(undefined);
    loadPersistedSettingsMock.mockReset();
    loadPersistedSettingsMock.mockResolvedValue({ uiScale: 1.5, showActiveAppWindowTitle: true });
    readAutostartEnabledMock.mockReset();
    readAutostartEnabledMock.mockResolvedValue(false);
    savePersistedSettingsMock.mockReset();
    savePersistedSettingsMock.mockResolvedValue(undefined);
    useSettingsStore.setState({
        uiScale: 1,
        committedUiScale: 1,
        showActiveAppWindowTitle: true,
        autostartEnabled: false,
        dangerousChange: null,
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
        let resolveSettings!: (value: { uiScale: number; showActiveAppWindowTitle: boolean }) => void;
        loadPersistedSettingsMock.mockReturnValue(new Promise((resolve) => {
            resolveSettings = resolve;
        }));

        render(<App />);

        await Promise.resolve();
        expect(invokeMock).not.toHaveBeenCalledWith('resize_scaled_window', expect.anything());

        resolveSettings({ uiScale: 1.5, showActiveAppWindowTitle: true });

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
            showActiveAppWindowTitle: false,
            autostartEnabled: false,
        });
        readAutostartEnabledMock.mockResolvedValue(true);

        render(<App />);

        await waitFor(() => expect(useSettingsStore.getState().autostartEnabled).toBe(true));
        expect(readAutostartEnabledMock).toHaveBeenCalledWith(false);
        expect(savePersistedSettingsMock).toHaveBeenCalledWith({
            uiScale: 1.25,
            showActiveAppWindowTitle: false,
            autostartEnabled: true,
        });
    });

    it('keeps autostart off when no persisted settings exist', async () => {
        useSettingsStore.setState({ autostartEnabled: true });
        loadPersistedSettingsMock.mockResolvedValue(null);
        readAutostartEnabledMock.mockResolvedValue(false);

        render(<App />);

        await waitFor(() => expect(useSettingsStore.getState().autostartEnabled).toBe(false));
        expect(readAutostartEnabledMock).toHaveBeenCalledWith(false);
        expect(savePersistedSettingsMock).not.toHaveBeenCalled();
    });

    it('does not let late startup hydration overwrite early settings changes', async () => {
        let resolveAutostart!: (value: boolean) => void;
        loadPersistedSettingsMock.mockResolvedValue({
            uiScale: 1.25,
            showActiveAppWindowTitle: false,
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
    });

    it('reconciles autostart while preserving unrelated settings changed during native read', async () => {
        let resolveAutostart!: (value: boolean) => void;
        loadPersistedSettingsMock.mockResolvedValue({
            uiScale: 1.25,
            showActiveAppWindowTitle: true,
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
            showActiveAppWindowTitle: false,
        });

        await act(async () => {
            resolveAutostart(true);
        });

        await waitFor(() => expect(useSettingsStore.getState().autostartEnabled).toBe(true));
        expect(useSettingsStore.getState().uiScale).toBe(1.5);
        expect(useSettingsStore.getState().committedUiScale).toBe(1.5);
        expect(useSettingsStore.getState().showActiveAppWindowTitle).toBe(false);
        expect(savePersistedSettingsMock).toHaveBeenCalledWith({
            uiScale: 1.5,
            showActiveAppWindowTitle: false,
            autostartEnabled: true,
        });
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

        await waitFor(() => expect(savePersistedCheckinMock).toHaveBeenCalledWith({
            schemaVersion: 1,
            weeklyPlan: {
                ...oldPlan,
                weekStartDate: currentWeekStartFor(new Date()),
            },
            dailyRecords: {},
        }));
    });
});
