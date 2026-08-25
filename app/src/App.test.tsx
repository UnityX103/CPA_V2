import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { useAppUpdateStore } from './domain/appUpdate';
import { useNetworkStore } from './domain/network';
import { usePomodoroStore } from './domain/pomodoro';
import { useSettingsStore } from './domain/settings';

const mocks = vi.hoisted(() => ({
    loadSettings: vi.fn(),
    readAutostart: vi.fn(),
    loadPreferences: vi.fn(),
    savePreferences: vi.fn(),
}));

vi.mock('./ui/PomodoroPanel', () => ({ PomodoroPanel: () => <div>timer</div> }));
vi.mock('./ui/PomodoroEndActionLayer', () => ({ PomodoroEndActionLayer: () => null }));
vi.mock('./ui/AppUpdateReadyNotice', () => ({ AppUpdateReadyNotice: () => null }));
vi.mock('./domain/stateSync', () => ({ useStateSync: vi.fn() }));
vi.mock('./domain/activeApp', () => ({ useActiveAppListener: vi.fn() }));
vi.mock('./domain/bridge/host', () => ({ useBridgeHost: vi.fn() }));
vi.mock('./domain/inputCounterWindow', () => ({ useInputCounterWindowController: vi.fn() }));
vi.mock('./domain/remotePlayerWindows', () => ({ useRemotePlayerWindowController: vi.fn() }));
vi.mock('./domain/scaledWindow', () => ({
    MAIN_WINDOW_BASE_SIZE: { width: 233, height: 155 },
    useScaledWindowSize: vi.fn(),
}));
vi.mock('./domain/cloudAccountSync', () => ({ useCloudAccountSync: vi.fn() }));
vi.mock('./domain/settingsPersistence', () => ({ loadPersistedSettings: mocks.loadSettings }));
vi.mock('./domain/autostart', () => ({ readAutostartEnabled: mocks.readAutostart }));
vi.mock('./domain/userPreferencesPersistence', () => ({
    loadPersistedUserPreferences: mocks.loadPreferences,
    savePersistedUserPreferences: mocks.savePreferences,
}));

beforeEach(() => {
    mocks.loadSettings.mockReset().mockResolvedValue({
        uiScale: 1.25,
        autostartEnabled: false,
        audioOutputDeviceId: 'coreaudio:external-dac',
        soundVolume: 0.55,
    });
    mocks.readAutostart.mockReset().mockResolvedValue(true);
    mocks.loadPreferences.mockReset().mockResolvedValue(null);
    mocks.savePreferences.mockReset().mockResolvedValue(undefined);
    useSettingsStore.setState({
        uiScale: 1,
        committedUiScale: 1,
        autostartEnabled: false,
        audioOutputDeviceId: null,
        soundVolume: 1,
    });
    useNetworkStore.setState({
        accountStatus: 'guest',
        cloudSyncStatus: 'idle',
        cloudData: null,
        restoreAccountSession: vi.fn(async () => {}),
    });
    useAppUpdateStore.setState({
        hydrate: vi.fn(async () => {}),
        startAutomaticChecks: vi.fn(() => () => {}),
    });
    usePomodoroStore.setState({ lastEndEvent: null, isPinned: false, pinSource: null });
});

afterEach(cleanup);

describe('App startup', () => {
    it('hydrates retained settings and saves one unified snapshot', async () => {
        render(<App />);

        await waitFor(() => expect(useSettingsStore.getState()).toEqual(expect.objectContaining({
            uiScale: 1.25,
            committedUiScale: 1.25,
            autostartEnabled: true,
            audioOutputDeviceId: 'coreaudio:external-dac',
            soundVolume: 0.55,
        })));
        expect(mocks.savePreferences).toHaveBeenCalledWith(expect.objectContaining({
            settings: { uiScale: 1.25, autostartEnabled: true },
        }));
    });

    it('keeps automatic pinning on a timed focus completion', async () => {
        render(<App />);
        await waitFor(() => expect(mocks.savePreferences).toHaveBeenCalled());

        await act(async () => {
            usePomodoroStore.setState({
                lastEndEvent: { id: 1, fromPhase: 'focus', toPhase: 'break', triggeredBy: 'timer' },
            });
        });

        expect(usePomodoroStore.getState()).toEqual(expect.objectContaining({
            isPinned: true,
            pinSource: 'focusEndAuto',
        }));
    });
});
