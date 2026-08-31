import type { PomodoroPhase } from './pomodoro';
import type { ConfirmedPresence } from './presence';

export const REST_DESK_REMINDER_DELAY_MS = 60_000;

export interface CockroachInvasionEligibility {
    cameraEnabled: boolean;
    reminderEnabled: boolean;
    currentPhase: PomodoroPhase;
    confirmedPresence: ConfirmedPresence;
}

export interface CockroachInvasionTriggerState {
    eligibleSinceMs: number | null;
    active: boolean;
}

export interface CockroachInvasionTriggerResult {
    state: CockroachInvasionTriggerState;
    effect: 'show' | 'hide' | null;
    wakeAtMs: number | null;
}

export function createCockroachInvasionTriggerState(): CockroachInvasionTriggerState {
    return { eligibleSinceMs: null, active: false };
}

function isEligible(input: CockroachInvasionEligibility): boolean {
    return input.cameraEnabled
        && input.reminderEnabled
        && input.currentPhase === 'break'
        && input.confirmedPresence === 'present';
}

export function advanceCockroachInvasionTrigger(
    state: CockroachInvasionTriggerState,
    input: CockroachInvasionEligibility,
    nowMs: number,
): CockroachInvasionTriggerResult {
    if (!isEligible(input)) {
        return {
            state: createCockroachInvasionTriggerState(),
            effect: state.active ? 'hide' : null,
            wakeAtMs: null,
        };
    }

    if (state.active) {
        return { state, effect: null, wakeAtMs: null };
    }

    const eligibleSinceMs = state.eligibleSinceMs ?? nowMs;
    const wakeAtMs = eligibleSinceMs + REST_DESK_REMINDER_DELAY_MS;
    if (nowMs < wakeAtMs) {
        return {
            state: { eligibleSinceMs, active: false },
            effect: null,
            wakeAtMs,
        };
    }

    return {
        state: { eligibleSinceMs, active: true },
        effect: 'show',
        wakeAtMs: null,
    };
}
