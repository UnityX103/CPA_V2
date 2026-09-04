import { useEffect } from 'react';
import { emit, listen, type UnlistenFn } from '@tauri-apps/api/event';
import {
    usePomodoroStore,
    type PomodoroPhase,
    type PomodoroState,
    type PomodoroStore,
} from './pomodoro';

export const POMODORO_BROADCAST_VERSION = 1 as const;
export const POMODORO_BROADCAST_EVENT = 'pomodoro-broadcast-v1';
export const POMODORO_BROADCAST_SNAPSHOT_REQUEST_EVENT = 'pomodoro-broadcast-v1-snapshot-request';

export type PomodoroBroadcastType =
    | 'snapshot'
    | 'phase.entered'
    | 'timer.started'
    | 'timer.paused'
    | 'timer.reset'
    | 'timer.ticked'
    | 'settings.changed';

export type PomodoroBroadcastReason = 'timer' | 'skip' | 'manual' | 'presence' | 'hydrate';

export interface PomodoroBroadcastEvent {
    readonly v: typeof POMODORO_BROADCAST_VERSION;
    readonly sequence: number;
    readonly emittedAt: number;
    readonly type: PomodoroBroadcastType;
    readonly phase: PomodoroPhase;
    readonly previousPhase: PomodoroPhase | null;
    readonly isRunning: boolean;
    readonly round: number;
    readonly totalRounds: number;
    readonly remainingSeconds: number;
    readonly reason: PomodoroBroadcastReason;
}

export interface PomodoroBroadcast {
    readonly current: () => PomodoroBroadcastEvent;
    readonly subscribe: (listener: (event: PomodoroBroadcastEvent) => void) => () => void;
    readonly start: () => () => void;
}

function reasonFor(
    state: PomodoroState,
    type: PomodoroBroadcastType,
): PomodoroBroadcastReason {
    if (type === 'phase.entered' && state.lastEndEvent?.triggeredBy === 'timer') return 'timer';
    if (type === 'phase.entered' && state.lastEndEvent?.triggeredBy === 'skip') return 'skip';
    if (type === 'timer.ticked') return 'timer';
    return 'manual';
}

function eventTypeFor(state: PomodoroState, previous: PomodoroState): PomodoroBroadcastType {
    if (state.currentPhase !== previous.currentPhase) return 'phase.entered';
    if (state.isRunning !== previous.isRunning) {
        return state.isRunning ? 'timer.started' : 'timer.paused';
    }
    const reset = state.currentPhase === 'focus'
        && state.currentRound === 1
        && !state.isRunning
        && state.remainingSeconds === state.focusDurationSeconds
        && (
            previous.currentRound !== 1
            || previous.currentPhase !== 'focus'
            || previous.remainingSeconds !== previous.focusDurationSeconds
        );
    if (reset) return 'timer.reset';
    if (state.remainingSeconds !== previous.remainingSeconds) return 'timer.ticked';
    return 'settings.changed';
}

export function createPomodoroBroadcast(
    store: PomodoroStore,
    now: () => number = () => Date.now(),
): PomodoroBroadcast {
    const listeners = new Set<(event: PomodoroBroadcastEvent) => void>();
    let sequence = 0;
    let unsubscribeStore: (() => void) | null = null;

    const build = (
        state: PomodoroState,
        type: PomodoroBroadcastType,
        previousPhase: PomodoroPhase | null,
        reason: PomodoroBroadcastReason,
        nextSequence: boolean,
    ): PomodoroBroadcastEvent => ({
        v: POMODORO_BROADCAST_VERSION,
        sequence: nextSequence ? ++sequence : sequence,
        emittedAt: now(),
        type,
        phase: state.currentPhase,
        previousPhase,
        isRunning: state.isRunning,
        round: state.currentRound,
        totalRounds: state.totalRounds,
        remainingSeconds: state.remainingSeconds,
        reason,
    });

    const publish = (event: PomodoroBroadcastEvent) => {
        listeners.forEach((listener) => listener(event));
    };

    return {
        current: () => build(store.getState(), 'snapshot', null, 'hydrate', false),
        subscribe: (listener) => {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        start: () => {
            if (unsubscribeStore) return () => {};
            publish(build(store.getState(), 'snapshot', null, 'hydrate', true));
            unsubscribeStore = store.subscribe((state, previous) => {
                const type = eventTypeFor(state, previous);
                publish(build(
                    state,
                    type,
                    previous.currentPhase,
                    reasonFor(state, type),
                    true,
                ));
            });
            return () => {
                unsubscribeStore?.();
                unsubscribeStore = null;
            };
        },
    };
}

export const pomodoroBroadcast = createPomodoroBroadcast(usePomodoroStore);

export function usePomodoroBroadcastSource(): void {
    useEffect(() => {
        let disposed = false;
        let unlistenRequests: UnlistenFn | null = null;
        const unsubscribeTransport = pomodoroBroadcast.subscribe((event) => {
            void emit(POMODORO_BROADCAST_EVENT, event).catch((error) => {
                console.warn('[pomodoro-broadcast] global emit failed', error);
            });
        });
        void listen(POMODORO_BROADCAST_SNAPSHOT_REQUEST_EVENT, () => {
            void emit(POMODORO_BROADCAST_EVENT, pomodoroBroadcast.current()).catch((error) => {
                console.warn('[pomodoro-broadcast] snapshot reply failed', error);
            });
        }).then((unlisten) => {
            if (disposed) unlisten();
            else unlistenRequests = unlisten;
        }).catch((error) => {
            console.warn('[pomodoro-broadcast] snapshot requests unavailable', error);
        });
        const stop = pomodoroBroadcast.start();
        return () => {
            disposed = true;
            stop();
            unsubscribeTransport();
            unlistenRequests?.();
        };
    }, []);
}
