import { renderHook, act, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCloudAccountSync } from './cloudAccountSync';
import { useNetworkStore } from './network';
import { usePomodoroStore } from './pomodoro';
import { defaultWeeklyPlan, useCheckinStore } from './checkin';

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
        });
        useCheckinStore.getState().hydrateCheckin({
            weeklyPlan: defaultWeeklyPlan('2026-05-18'),
            dailyRecords: {},
        });
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
                        endActionMode: 'topWindow',
                        endActionVideo: { sourceKind: 'builtin', builtinVideoId: 'default', customVideoPath: '' },
                    },
                    settings: {
                        uiScale: 1,
                        autostartEnabled: false,
                    },
                    checkin: {
                        weeklyPlan: defaultWeeklyPlan('2026-05-18'),
                        dailyRecords: {},
                    },
                },
                cloudDataUpdatedAt: 10,
                cloudSyncStatus: 'synced',
            });
        });

        expect(usePomodoroStore.getState().focusDurationSeconds).toBe(600);
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
