import { useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { usePomodoroStore } from './pomodoro';
import { usePresenceStore } from './presence';
import { useSettingsStore } from './settings';
import {
    advanceCockroachInvasionTrigger,
    createCockroachInvasionTriggerState,
    type CockroachInvasionEligibility,
} from './cockroachInvasion';

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
            await invoke(active ? 'launch_cockroach_module' : 'kill_all_cockroaches', active
                ? { settings: null }
                : undefined);
        } catch (error) {
            console.warn(`[cockroach-module] ${active ? 'launch' : 'stop'} failed`, error);
        }
    },
};

function currentEligibility(): CockroachInvasionEligibility {
    const settings = useSettingsStore.getState();
    const presence = usePresenceStore.getState();
    const pomodoro = usePomodoroStore.getState();
    return {
        cameraEnabled: presence.enabled,
        reminderEnabled: settings.breakPetMode === 'cockroachInvasion'
            && presence.restDeskReminderEnabled
            && presence.restDeskReminderMode === 'cockroachInvasion',
        currentPhase: pomodoro.currentPhase,
        confirmedPresence: presence.confirmedPresence,
    };
}

export function startCockroachModuleController(
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

    const subscriptions = [
        useSettingsStore.subscribe(evaluate),
        usePresenceStore.subscribe(evaluate),
        usePomodoroStore.subscribe(evaluate),
    ];
    evaluate();

    return () => {
        stopped = true;
        clearWakeTimer();
        subscriptions.forEach((unsubscribe) => unsubscribe());
        void runtime.setActive(false);
    };
}

export function useCockroachModuleController({ enabled }: { enabled: boolean }): void {
    useEffect(() => {
        if (!enabled) {
            return undefined;
        }
        return startCockroachModuleController();
    }, [enabled]);
}
