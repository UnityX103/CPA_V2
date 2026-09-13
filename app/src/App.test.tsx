import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { useAppUpdateStore } from './domain/appUpdate';
import { useNetworkStore } from './domain/network';
import { usePomodoroStore } from './domain/pomodoro';
import { useSettingsStore } from './domain/settings';
import { defaultUserPreferencesSnapshot } from './domain/userPreferences';

const mocks = vi.hoisted(() => ({
    loadSettings: vi.fn(),
    readAutostart: vi.fn(),
    loadPreferences: vi.fn(),
    savePreferences: vi.fn(),
}));

vi.mock('./ui/PomodoroEndActionLayer', () => ({ PomodoroEndActionLayer: () => null }));
vi.mock('./ui/AppUpdateReadyNotice', () => ({ AppUpdateReadyNotice: () => null }));
vi.mock('./domain/stateSync', () => ({ useStateSync: vi.fn() }));
vi.mock('./domain/activeApp', () => ({ useActiveAppListener: vi.fn() }));
vi.mock('./domain/bridge/host', () => ({ useBridgeHost: vi.fn() }));
vi.mock('./domain/inputCounterWindow', () => ({ useInputCounterWindowController: vi.fn() }));
vi.mock('./domain/remotePlayerWindows', () => ({ useRemotePlayerWindowController: vi.fn() }));
vi.mock('./domain/scaledWindow', () => ({
    MAIN_WINDOW_BASE_SIZE: { width: 215, height: 187 },
    useScaledWindowSize: vi.fn(),
}));
vi.mock('./domain/cloudAccountSync', () => ({ useCloudAccountSync: vi.fn() }));
vi.mock('./domain/settingsPersistence', () => ({ loadPersistedSettings: mocks.loadSettings }));
vi.mock('./domain/autostart', () => ({ readAutostartEnabled: mocks.readAutostart }));
vi.mock('./domain/userPreferencesPersistence', () => ({
    loadPersistedUserPreferences: mocks.loadPreferences,
    savePersistedUserPreferences: mocks.savePreferences,
}));
vi.mock('@tauri-apps/api/core', () => ({
    invoke: vi.fn(async (command: string) => (
        command === 'extension_pack_statuses' ? [] : undefined
    )),
}));
vi.mock('@tauri-apps/api/event', () => ({
    listen: vi.fn(async () => () => {}),
    emit: vi.fn(async () => {}),
}));

beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
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
    usePomodoroStore.setState(usePomodoroStore.getInitialState());
});

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

describe('App startup', () => {
    it.each(['local', 'cloud'] as const)('initializes the start summary and timer from %s preferences', async (source) => {
        const snapshot = defaultUserPreferencesSnapshot();
        snapshot.pomodoro.focusDurationSeconds = 30 * 60;
        snapshot.pomodoro.breakDurationSeconds = 10 * 60;
        if (source === 'local') {
            mocks.loadPreferences.mockResolvedValue(snapshot);
        } else {
            useNetworkStore.setState({
                accountStatus: 'loggedIn',
                cloudSyncStatus: 'synced',
                cloudData: snapshot,
            });
        }

        const { container } = render(<App />);
        await waitFor(() => expect(mocks.savePreferences).toHaveBeenCalled());

        expect(usePomodoroStore.getState()).toMatchObject({
            focusDurationSeconds: 30 * 60,
            remainingSeconds: 30 * 60,
            currentPhase: 'focus',
            currentRound: 1,
            isRunning: false,
        });
        expect(container.querySelector('.pomo-clock')).toBeNull();
        expect(container.querySelector('.pomo-start-summary')?.textContent).toContain('30分钟');
        expect(container.querySelector('.pomo-start-summary')?.textContent).toContain('10分钟');
        act(() => usePomodoroStore.getState().start());
        const ring = container.querySelector('circle[stroke-dashoffset]')!;
        expect(ring.getAttribute('stroke-dashoffset')).toBe(ring.getAttribute('stroke-dasharray'));

        act(() => {
            usePomodoroStore.getState().start();
            usePomodoroStore.getState().tick(60);
        });
        expect(container.querySelector('.pomo-clock-time')?.textContent).toBe('29:00');
        expect(Number(ring.getAttribute('stroke-dashoffset'))).toBeCloseTo(
            Number(ring.getAttribute('stroke-dasharray')) * 29 / 30,
        );
        act(() => usePomodoroStore.getState().reset());
        expect(container.querySelector('.pomo-clock')).toBeNull();
        expect(container.querySelector('.pomo-start-summary')?.textContent).toContain('30分钟');
    });

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
            settings: { uiScale: 1.25, autostartEnabled: true, breakPetMode: 'off' },
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
