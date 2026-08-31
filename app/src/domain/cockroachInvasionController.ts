import { useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { usePomodoroStore } from './pomodoro';
import { usePresenceStore } from './presence';
import {
    advanceCockroachInvasionTrigger,
    createCockroachInvasionTriggerState,
    type CockroachInvasionEligibility,
} from './cockroachInvasion';

export const COCKROACH_INVASION_ACTIVE_EVENT = 'cockroach-invasion:active';

export interface CockroachInvasionActivation {
    active: boolean;
}

interface ControllerRuntime {
    now: () => number;
    setTimeout: (callback: () => void, delayMs: number) => number;
    clearTimeout: (id: number) => void;
    setActive: (active: boolean) => Promise<void> | void;
}

const defaultRuntime: ControllerRuntime = {
    now: () => performance.now(),
    setTimeout: (callback, delayMs) => window.setTimeout(callback, delayMs),
    clearTimeout: (id) => window.clearTimeout(id),
    setActive: async (active) => {
        try {
            await invoke('set_cockroach_invasion_active', { active });
        } catch (error) {
            console.warn('[cockroach-invasion] window activation failed', error);
        }
    },
};

function currentEligibility(): CockroachInvasionEligibility {
    const presence = usePresenceStore.getState();
    const pomodoro = usePomodoroStore.getState();
    return {
        cameraEnabled: presence.enabled,
        reminderEnabled: presence.restDeskReminderEnabled
            && presence.restDeskReminderMode === 'cockroachInvasion',
        currentPhase: pomodoro.currentPhase,
        confirmedPresence: presence.confirmedPresence,
    };
}

export function startCockroachInvasionController(
    runtime: ControllerRuntime = defaultRuntime,
): () => void {
    let triggerState = createCockroachInvasionTriggerState();
    let wakeTimer: number | null = null;
    let stopped = false;

    const clearWakeTimer = () => {
        if (wakeTimer == null) return;
        runtime.clearTimeout(wakeTimer);
        wakeTimer = null;
    };

    const evaluate = () => {
        if (stopped) return;
        clearWakeTimer();
        const result = advanceCockroachInvasionTrigger(
            triggerState,
            currentEligibility(),
            runtime.now(),
        );
        triggerState = result.state;
        if (result.effect === 'show') void runtime.setActive(true);
        if (result.effect === 'hide') void runtime.setActive(false);
        if (result.wakeAtMs != null) {
            wakeTimer = runtime.setTimeout(
                evaluate,
                Math.max(0, result.wakeAtMs - runtime.now()),
            );
        }
    };

    const unsubscribePresence = usePresenceStore.subscribe(evaluate);
    const unsubscribePomodoro = usePomodoroStore.subscribe(evaluate);
    evaluate();

    return () => {
        stopped = true;
        clearWakeTimer();
        unsubscribePresence();
        unsubscribePomodoro();
        void runtime.setActive(false);
    };
}

export function useCockroachInvasionController({ enabled }: { enabled: boolean }): void {
    useEffect(() => {
        if (!enabled) {
            void defaultRuntime.setActive(false);
            return undefined;
        }
        return startCockroachInvasionController();
    }, [enabled]);
}
