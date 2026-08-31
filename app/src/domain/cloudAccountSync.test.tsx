import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCloudAccountSync } from './cloudAccountSync';
import { useNetworkStore } from './network';
import { useSettingsStore } from './settings';
import { usePomodoroStore } from './pomodoro';

const saveLocal = vi.hoisted(() => vi.fn());

vi.mock('./userPreferencesPersistence', () => ({
    savePersistedUserPreferences: saveLocal,
}));

beforeEach(() => {
    vi.useFakeTimers();
    saveLocal.mockReset().mockResolvedValue(undefined);
    useSettingsStore.setState({ uiScale: 1, committedUiScale: 1, autostartEnabled: false });
    useNetworkStore.setState({
        accountStatus: 'loggedIn',
        cloudSyncStatus: 'synced',
        cloudData: null,
        cloudDataUpdatedAt: null,
        saveUserData: vi.fn(),
    });
    usePomodoroStore.setState({
        endSounds: {
            focus: { sourceKind: 'builtin', builtinSoundId: 'clear-success', customSoundPath: '' },
            break: { sourceKind: 'builtin', builtinSoundId: 'triple-ping', customSoundPath: '' },
        },
    });
});

afterEach(() => {
    cleanup();
    vi.useRealTimers();
});

describe('cloud account sync', () => {
    it('persists and uploads retained setting changes', async () => {
        const saveRemote = useNetworkStore.getState().saveUserData as ReturnType<typeof vi.fn>;
        renderHook(() => useCloudAccountSync());

        act(() => {
            useSettingsStore.setState({ autostartEnabled: true });
            vi.advanceTimersByTime(1000);
        });

        expect(saveLocal).toHaveBeenCalled();
        expect(saveRemote).toHaveBeenCalledWith(expect.objectContaining({
            settings: { uiScale: 1, autostartEnabled: true, breakPetMode: 'off' },
        }), null);
    });

    it('persists and uploads end-sound changes', () => {
        const saveRemote = useNetworkStore.getState().saveUserData as ReturnType<typeof vi.fn>;
        renderHook(() => useCloudAccountSync());

        act(() => {
            usePomodoroStore.getState().applyEndSoundSettings({
                focus: { sourceKind: 'off', builtinSoundId: 'clear-success', customSoundPath: '' },
                break: { sourceKind: 'custom', builtinSoundId: 'triple-ping', customSoundPath: '/tmp/rest.mp3' },
            });
            vi.advanceTimersByTime(1000);
        });

        expect(saveLocal).toHaveBeenCalled();
        expect(saveRemote).toHaveBeenCalledWith(expect.objectContaining({
            pomodoro: expect.objectContaining({
                endSounds: {
                    focus: { sourceKind: 'off', builtinSoundId: 'clear-success', customSoundPath: '' },
                    break: { sourceKind: 'custom', builtinSoundId: 'triple-ping', customSoundPath: '/tmp/rest.mp3' },
                },
            }),
        }), null);
    });
});
