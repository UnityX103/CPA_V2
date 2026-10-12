import { useEffect, useState } from 'react';
import { usePomodoroStore, type PomodoroStore } from './pomodoro';
import { INPUT_ACTIVITY_RECENT_MS, usePresenceStore, type PresenceStore } from './presence';

export type BreakReminderLevel = 0 | 1 | 2 | 3;
export const BREAK_REMINDER_SCALES = [1, 1, 1.35, 1.7] as const;

// Use fresh detection samples, rather than elapsed wall time alone, to escalate.
export function startBreakReminderMonitor({ presence, pomodoro, onLevelChange, now = () => performance.now() }: {
    presence: PresenceStore;
    pomodoro: PomodoroStore;
    onLevelChange: (level: BreakReminderLevel) => void;
    now?: () => number;
}): () => void {
    let scope = '';
    let presentSince: number | null = null;
    let previousSampleAt: number | null = null;
    let level: BreakReminderLevel = 0;
    const reconcile = () => {
        const pomo = pomodoro.getState();
        const nextScope = pomo.currentPhase === 'break' ? `break:${pomo.currentRound}` : '';
        if (scope !== nextScope) {
            scope = nextScope;
            presentSince = previousSampleAt = null;
            level = 0;
            onLevelChange(0);
        }
        const state = presence.getState();
        const time = now();
        const inputFresh = state.inputActivityEnabled && state.inputActivityAvailability === 'ready'
            && state.inputSampleAt !== null && time - state.inputSampleAt <= 10_000
            && state.inputIdleMs !== null
            && state.inputIdleMs + time - state.inputSampleAt < INPUT_ACTIVITY_RECENT_MS;
        const pausedForPresence = pomo.presenceAutomationState === 'breakPaused'
            || pomo.presenceAutomationState === 'breakResumeEligible';
        if (!scope || !pausedForPresence || state.confirmedPresence !== 'present' || !inputFresh) {
            presentSince = previousSampleAt = null;
            return;
        }
        const freshnessWindow = 10_000;
        if (previousSampleAt === null || time - previousSampleAt > freshnessWindow) presentSince = time;
        previousSampleAt = time;
        const nextLevel = Math.min(3, Math.floor((time - presentSince!) / 30_000)) as BreakReminderLevel;
        // An escalated reminder stays visible throughout this break, including after leaving the desk.
        if (nextLevel > level) {
            level = nextLevel;
            onLevelChange(level);
        }
    };
    const unsubscribePresence = presence.subscribe(reconcile);
    const unsubscribePomodoro = pomodoro.subscribe((state, previous) => {
        if (state.currentPhase !== previous.currentPhase || state.currentRound !== previous.currentRound
            || state.presenceAutomationState !== previous.presenceAutomationState || state.isRunning !== previous.isRunning) reconcile();
    });
    reconcile();
    return () => { unsubscribePresence(); unsubscribePomodoro(); };
}

export function useBreakReminderLevel(enabled: boolean): BreakReminderLevel {
    const [level, setLevel] = useState<BreakReminderLevel>(0);
    useEffect(() => {
        if (!enabled) return;
        return startBreakReminderMonitor({ presence: usePresenceStore, pomodoro: usePomodoroStore, onLevelChange: setLevel });
    }, [enabled]);
    return level;
}
