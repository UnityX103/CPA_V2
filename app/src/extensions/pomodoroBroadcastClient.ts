import { emit, listen, type UnlistenFn } from '@tauri-apps/api/event';
import {
    POMODORO_BROADCAST_EVENT,
    POMODORO_BROADCAST_SNAPSHOT_REQUEST_EVENT,
    type PomodoroBroadcast,
    type PomodoroBroadcastEvent,
} from '../domain/pomodoroBroadcast';

function neutralSnapshot(): PomodoroBroadcastEvent {
    return {
        v: 1,
        sequence: 0,
        emittedAt: Date.now(),
        type: 'snapshot',
        phase: 'focus',
        previousPhase: null,
        isRunning: false,
        round: 1,
        totalRounds: 1,
        remainingSeconds: 0,
        reason: 'hydrate',
    };
}

export const extensionPomodoroBroadcast: PomodoroBroadcast = {
    current: neutralSnapshot,
    start: () => () => {},
    subscribe: (listener) => {
        let disposed = false;
        let unlisten: UnlistenFn | null = null;
        void listen<PomodoroBroadcastEvent>(POMODORO_BROADCAST_EVENT, ({ payload }) => {
            listener(payload);
        }).then((cleanup) => {
            if (disposed) cleanup();
            else {
                unlisten = cleanup;
                void emit(POMODORO_BROADCAST_SNAPSHOT_REQUEST_EVENT).catch((error) => {
                    console.warn('[extension-runtime] Pomodoro snapshot request failed', error);
                });
            }
        }).catch((error) => {
            console.warn('[extension-runtime] Pomodoro broadcast unavailable', error);
        });
        return () => {
            disposed = true;
            unlisten?.();
        };
    },
};
