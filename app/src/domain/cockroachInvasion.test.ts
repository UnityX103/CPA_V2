import { describe, expect, it, vi } from 'vitest';
import {
    REST_DESK_REMINDER_DELAY_MS,
    advanceCockroachInvasionTrigger,
    createCockroachInvasionTriggerState,
} from './cockroachInvasion';
import { startCockroachModuleController } from './cockroachModuleController';
import { usePomodoroStore } from './pomodoro';
import { usePresenceStore } from './presence';
import { useSettingsStore } from './settings';

describe('cockroach invasion trigger', () => {
    it('waits for continuous break-time presence and hides immediately when eligibility ends', () => {
        const eligible = {
            cameraEnabled: true,
            reminderEnabled: true,
            currentPhase: 'break' as const,
            confirmedPresence: 'present' as const,
        };

        const armed = advanceCockroachInvasionTrigger(
            createCockroachInvasionTriggerState(),
            eligible,
            1_000,
        );
        expect(armed).toEqual({
            state: { eligibleSinceMs: 1_000, active: false },
            effect: null,
            wakeAtMs: 1_000 + REST_DESK_REMINDER_DELAY_MS,
        });

        const activated = advanceCockroachInvasionTrigger(
            armed.state,
            eligible,
            1_000 + REST_DESK_REMINDER_DELAY_MS,
        );
        expect(activated.effect).toBe('show');
        expect(activated.state.active).toBe(true);

        const hidden = advanceCockroachInvasionTrigger(
            activated.state,
            { ...eligible, confirmedPresence: 'absent' },
            1_000 + REST_DESK_REMINDER_DELAY_MS + 1,
        );
        expect(hidden).toEqual({
            state: { eligibleSinceMs: null, active: false },
            effect: 'hide',
            wakeAtMs: null,
        });
    });

    it('drives the invasion window from the authoritative presence and Pomodoro stores', () => {
        usePresenceStore.setState({
            enabled: true,
            restDeskReminderEnabled: true,
            restDeskReminderMode: 'cockroachInvasion',
            confirmedPresence: 'present',
        });
        useSettingsStore.setState({ breakPetMode: 'cockroachInvasion' });
        usePomodoroStore.setState({ currentPhase: 'break' });
        let nowMs = 0;
        let wake: (() => void) | null = null;
        const setActive = vi.fn();

        const stop = startCockroachModuleController({
            now: () => nowMs,
            setTimeout: (callback) => {
                wake = callback;
                return 1;
            },
            clearTimeout: () => {},
            setActive,
        });

        expect(setActive).not.toHaveBeenCalled();
        nowMs = REST_DESK_REMINDER_DELAY_MS;
        expect(wake).not.toBeNull();
        (wake as unknown as () => void)();
        expect(setActive).toHaveBeenCalledWith(true);

        usePomodoroStore.setState({ currentPhase: 'focus' });
        expect(setActive).toHaveBeenCalledWith(false);
        stop();
    });
});
