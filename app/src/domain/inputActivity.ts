import { useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { usePomodoroStore, type PomodoroStore } from './pomodoro';
import { applyCombinedPresence, applyInputActivitySample, usePresenceStore, type PresenceStore } from './presence';

export const INPUT_ACTIVITY_POLL_MS = 5_000;

interface InputActivityRuntime {
    sample: () => Promise<number>;
    now: () => number;
    setInterval: (callback: () => void, delay: number) => number;
    clearInterval: (id: number) => void;
}

const defaultRuntime: InputActivityRuntime = {
    sample: () => invoke<number>('sample_input_activity'),
    now: () => performance.now(),
    setInterval: (callback, delay) => window.setInterval(callback, delay),
    clearInterval: (id) => window.clearInterval(id),
};

export function startInputActivityMonitor({ store, pomodoro, runtime = defaultRuntime }: {
    store: PresenceStore;
    pomodoro: PomodoroStore;
    runtime?: InputActivityRuntime;
}): () => void {
    let stopped = false;
    let interval: number | null = null;
    let epoch = 0;
    let inFlight = false;
    let scope = '';
    const eligible = () => {
        const pomo = pomodoro.getState();
        return !stopped && store.getState().inputActivityEnabled && pomo.currentPhase === 'break'
            && (pomo.isRunning || pomo.presenceAutomationState === 'breakPaused'
                || pomo.presenceAutomationState === 'breakResumeEligible');
    };
    const poll = async () => {
        if (!eligible() || inFlight) return;
        const requestEpoch = epoch;
        inFlight = true;
        try {
            const idleMs = await runtime.sample();
            if (eligible() && requestEpoch === epoch) {
                applyInputActivitySample(store, pomodoro, idleMs, runtime.now());
            }
        } catch {
            if (eligible() && requestEpoch === epoch) {
                applyInputActivitySample(store, pomodoro, null, runtime.now());
            }
        } finally {
            inFlight = false;
        }
    };
    const reconcile = () => {
        const state = pomodoro.getState();
        const nextScope = eligible() ? `${state.currentPhase}:${state.currentRound}` : '';
        if (nextScope === scope) return;
        scope = nextScope;
        epoch++;
        if (interval !== null) runtime.clearInterval(interval);
        interval = null;
        store.setState({
            inputActivityAvailability: store.getState().inputActivityEnabled ? 'waiting' : 'disabled',
            inputIdleMs: null,
            inputSampleAt: null,
        });
        if (scope) {
            interval = runtime.setInterval(() => { void poll(); }, INPUT_ACTIVITY_POLL_MS);
            void poll();
        } else {
            // Drop an input-only status immediately when leaving a break or disabling detection.
            applyCombinedPresence(store, pomodoro, runtime.now(), false);
        }
    };
    const unsubscribePomodoro = pomodoro.subscribe(reconcile);
    const unsubscribeSettings = store.subscribe((state, previous) => {
        if (state.inputActivityEnabled !== previous.inputActivityEnabled) reconcile();
    });
    reconcile();
    return () => {
        stopped = true;
        epoch++;
        if (interval !== null) runtime.clearInterval(interval);
        unsubscribePomodoro();
        unsubscribeSettings();
    };
}

export function useInputActivityMonitor(enabled: boolean): void {
    useEffect(() => {
        if (!enabled) return;
        return startInputActivityMonitor({ store: usePresenceStore, pomodoro: usePomodoroStore });
    }, [enabled]);
}
