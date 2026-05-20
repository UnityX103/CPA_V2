import '@testing-library/jest-dom/vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSettingsStore } from './domain/settings';

const {
    appUpdateCleanup,
    hydrateAppUpdate,
    invokeMock,
    loadPersistedSettingsMock,
    readAutostartEnabledMock,
    savePersistedSettingsMock,
    startAutomaticChecks,
    useStateSync,
    useActiveAppListener,
    useBindingKeyListener,
    useBridgeHost,
    useInputCounterWindowController,
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
        loadPersistedSettingsMock: vi.fn(),
        readAutostartEnabledMock: vi.fn(),
        savePersistedSettingsMock: vi.fn(),
        startAutomaticChecks,
        useStateSync: vi.fn(),
        useActiveAppListener: vi.fn(),
        useBindingKeyListener: vi.fn(),
        useBridgeHost: vi.fn(),
        useInputCounterWindowController: vi.fn(),
        useAppUpdateStore,
    };
});

vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));
vi.mock('./domain/stateSync', () => ({ useStateSync }));
vi.mock('./domain/activeApp', () => ({ useActiveAppListener }));
vi.mock('./domain/bindingKey', () => ({ useBindingKeyListener }));
vi.mock('./domain/bridge/host', () => ({ useBridgeHost }));
vi.mock('./domain/inputCounterWindow', () => ({ useInputCounterWindowController }));
vi.mock('./domain/appUpdate', () => ({ useAppUpdateStore }));
vi.mock('./domain/autostart', () => ({ readAutostartEnabled: readAutostartEnabledMock }));
vi.mock('./domain/settingsPersistence', () => ({
    loadPersistedSettings: loadPersistedSettingsMock,
    savePersistedSettings: savePersistedSettingsMock,
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
    useActiveAppListener.mockClear();
    useBindingKeyListener.mockClear();
    useBridgeHost.mockClear();
    useInputCounterWindowController.mockClear();
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
    });

    it('renders the app update restart notice layer', () => {
        render(<App />);

        expect(screen.getByTestId('app-update-ready-notice')).toBeInTheDocument();
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
        expect(invokeMock).not.toHaveBeenCalled();

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
});
