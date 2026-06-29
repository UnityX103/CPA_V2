import { renderHook, act, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCloudAccountSync } from './cloudAccountSync';
import { useNetworkStore } from './network';
import { usePomodoroStore } from './pomodoro';
import { defaultPlanTemplate, useCheckinStore } from './checkin';
import { useAppUpdateStore } from './appUpdate';
import { useBindingKeyStore } from './bindingKey';

const savePersistedUserPreferencesMock = vi.hoisted(() => vi.fn(async () => {}));

vi.mock('./userPreferencesPersistence', () => ({
    savePersistedUserPreferences: savePersistedUserPreferencesMock,
}));

vi.useFakeTimers();

describe('useCloudAccountSync', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        vi.clearAllTimers();
        useNetworkStore.setState({
            accountStatus: 'guest',
            cloudData: null,
            cloudDataUpdatedAt: null,
            cloudSyncStatus: 'idle',
        });
        usePomodoroStore.setState({
            focusDurationSeconds: 1500,
            breakDurationSeconds: 300,
            totalRounds: 4,
            autoStartBreak: false,
            autoPinAfterFocus: true,
        });
        useCheckinStore.getState().hydrateCheckin({
            planTemplate: defaultPlanTemplate(),
            dailyRecords: {},
        });
        useAppUpdateStore.setState({
            autoUpdateEnabled: true,
            status: 'idle',
            currentVersion: null,
            availableVersion: null,
            releaseNotes: null,
            lastCheckedAt: null,
            errorMessage: null,
        });
        useBindingKeyStore.setState({
            panelEnabled: true,
            entries: [],
            syncedKeyId: null,
            capturingId: null,
        });
        savePersistedUserPreferencesMock.mockClear();
    });

    afterEach(() => {
        cleanup();
    });

    it('uploads local data when login returns no server snapshot', () => {
        const save = vi.spyOn(useNetworkStore.getState(), 'saveUserData');
        renderHook(() => useCloudAccountSync());

        act(() => {
            useNetworkStore.setState({
                accountStatus: 'loggedIn',
                accountUser: { userId: 'u1', username: 'Alice' },
                cloudData: null,
                cloudDataUpdatedAt: null,
                cloudSyncStatus: 'synced',
            });
        });

        expect(save).toHaveBeenCalledWith(expect.objectContaining({ schemaVersion: 1 }), null);
    });

    it('hydrates from server data and does not immediately echo-save it', () => {
        const save = vi.spyOn(useNetworkStore.getState(), 'saveUserData');
        renderHook(() => useCloudAccountSync());
        save.mockClear();

        act(() => {
            useNetworkStore.setState({
                accountStatus: 'loggedIn',
                accountUser: { userId: 'u1', username: 'Alice' },
                cloudData: {
                    schemaVersion: 1,
                    updatedAt: 10,
                    pomodoro: {
                        focusDurationSeconds: 600,
                        breakDurationSeconds: 60,
                        totalRounds: 2,
                        autoStartBreak: true,
                        autoPinAfterFocus: false,
                        endActionMode: 'topWindow',
                        endActionVideo: { sourceKind: 'builtin', builtinVideoId: 'default', customVideoPath: '' },
                    },
                    settings: {
                        uiScale: 1,
                        autostartEnabled: false,
                        checkinEnabled: true,
                        planPanelEnabled: true,
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
                },
                cloudDataUpdatedAt: 10,
                cloudSyncStatus: 'synced',
            });
        });

        expect(usePomodoroStore.getState().focusDurationSeconds).toBe(600);
        expect(useAppUpdateStore.getState().autoUpdateEnabled).toBe(false);
        expect(useNetworkStore.getState().autoConnect).toBe(true);
        expect(useBindingKeyStore.getState().panelEnabled).toBe(false);
        expect(savePersistedUserPreferencesMock).toHaveBeenCalledTimes(1);
        expect(save).not.toHaveBeenCalled();
    });

    it('debounces local changes while logged in', () => {
        const save = vi.spyOn(useNetworkStore.getState(), 'saveUserData');
        renderHook(() => useCloudAccountSync());
        act(() => {
            useNetworkStore.setState({
                accountStatus: 'loggedIn',
                accountUser: { userId: 'u1', username: 'Alice' },
                cloudData: null,
                cloudDataUpdatedAt: null,
                cloudSyncStatus: 'synced',
            });
            save.mockClear();
            usePomodoroStore.getState().applySettings(900, 120, 4, true, false);
            vi.advanceTimersByTime(999);
        });
        expect(save).not.toHaveBeenCalled();

        act(() => {
            vi.advanceTimersByTime(1);
        });
        expect(save).toHaveBeenCalledTimes(1);
    });

    it('saves local archive when logged-in durable settings change before cloud debounce fires', () => {
        renderHook(() => useCloudAccountSync());

        act(() => {
            useNetworkStore.setState({
                accountStatus: 'loggedIn',
                accountUser: { userId: 'u1', username: 'Alice' },
                cloudSyncStatus: 'synced',
            });
            savePersistedUserPreferencesMock.mockClear();
            usePomodoroStore.getState().applySettings(840, 120, 4, true, false);
        });

        expect(savePersistedUserPreferencesMock).toHaveBeenCalledWith(expect.objectContaining({
            pomodoro: expect.objectContaining({ focusDurationSeconds: 840 }),
        }));
    });

    it('saves local archive and schedules cloud upload when only autoPinAfterFocus changes', () => {
        const save = vi.spyOn(useNetworkStore.getState(), 'saveUserData');
        renderHook(() => useCloudAccountSync());

        act(() => {
            useNetworkStore.setState({
                accountStatus: 'loggedIn',
                accountUser: { userId: 'u1', username: 'Alice' },
                cloudData: null,
                cloudDataUpdatedAt: null,
                cloudSyncStatus: 'synced',
            });
        });
        save.mockClear();
        savePersistedUserPreferencesMock.mockClear();

        act(() => {
            usePomodoroStore.getState().setAutoPinAfterFocus(false);
            vi.advanceTimersByTime(999);
        });

        expect(savePersistedUserPreferencesMock).toHaveBeenCalledWith(expect.objectContaining({
            pomodoro: expect.objectContaining({ autoPinAfterFocus: false }),
        }));
        expect(save).not.toHaveBeenCalled();

        act(() => {
            vi.advanceTimersByTime(1);
        });

        expect(save).toHaveBeenCalledWith(
            expect.objectContaining({
                pomodoro: expect.objectContaining({ autoPinAfterFocus: false }),
            }),
            null,
        );
    });

    it('does not save default local data before startup hydration has completed', () => {
        const save = vi.spyOn(useNetworkStore.getState(), 'saveUserData');
        renderHook(() => useCloudAccountSync({ enabled: false }));
        save.mockClear();

        act(() => {
            useNetworkStore.setState({
                accountStatus: 'loggedIn',
                accountUser: { userId: 'u1', username: 'Alice' },
                cloudData: null,
                cloudDataUpdatedAt: null,
                cloudSyncStatus: 'synced',
            });
        });

        expect(save).not.toHaveBeenCalled();
    });
});
