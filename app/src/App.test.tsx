import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSettingsStore } from './domain/settings';

const {
    invokeMock,
    loadPersistedSettingsMock,
    useStateSync,
    useActiveAppListener,
    useBindingKeyListener,
    useBridgeHost,
    useInputCounterWindowController,
} = vi.hoisted(() => ({
    invokeMock: vi.fn(),
    loadPersistedSettingsMock: vi.fn(),
    useStateSync: vi.fn(),
    useActiveAppListener: vi.fn(),
    useBindingKeyListener: vi.fn(),
    useBridgeHost: vi.fn(),
    useInputCounterWindowController: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));
vi.mock('./domain/stateSync', () => ({ useStateSync }));
vi.mock('./domain/activeApp', () => ({ useActiveAppListener }));
vi.mock('./domain/bindingKey', () => ({ useBindingKeyListener }));
vi.mock('./domain/bridge/host', () => ({ useBridgeHost }));
vi.mock('./domain/inputCounterWindow', () => ({ useInputCounterWindowController }));
vi.mock('./domain/settingsPersistence', () => ({ loadPersistedSettings: loadPersistedSettingsMock }));
vi.mock('./ui/PomodoroPanel', () => ({
    PomodoroPanel: () => <div data-testid="pomodoro-panel" />,
}));
vi.mock('./ui/PomodoroEndActionLayer', () => ({
    PomodoroEndActionLayer: () => null,
}));
vi.mock('./ui/RemoteRoster', () => ({
    RemoteRoster: () => <div data-testid="remote-roster" />,
}));

const { default: App } = await import('./App');

beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValue(undefined);
    useStateSync.mockClear();
    useActiveAppListener.mockClear();
    useBindingKeyListener.mockClear();
    useBridgeHost.mockClear();
    useInputCounterWindowController.mockClear();
    loadPersistedSettingsMock.mockReset();
    loadPersistedSettingsMock.mockResolvedValue({ uiScale: 1.5, showActiveAppWindowTitle: true });
    useSettingsStore.setState({ uiScale: 1, committedUiScale: 1, dangerousChange: null });
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
});
