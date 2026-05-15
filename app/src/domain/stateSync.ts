import { useEffect } from 'react';
import { usePomodoroStore, type PomodoroPhase } from './pomodoro';
import { useNetworkStore, type RemoteState } from './network';
import { useActiveAppStore } from './activeApp';

const PHASE_TO_INT: Record<PomodoroPhase, number> = { focus: 0, break: 1, completed: 2 };

function buildRemoteState(): RemoteState {
    const p = usePomodoroStore.getState();
    const active = useActiveAppStore.getState().current;
    return {
        pomodoro: {
            phase: PHASE_TO_INT[p.currentPhase],
            remainingSeconds: p.remainingSeconds,
            currentRound: p.currentRound,
            totalRounds: p.totalRounds,
            isRunning: p.isRunning,
        },
        activeApp: active
            ? { name: active.name, bundleId: active.bundle_id }
            : null,
        bindingKey: null,
    };
}

let lastSent = '';

export function useStateSync() {
    useEffect(() => {
        const send = () => {
            if (useNetworkStore.getState().status !== 'joined') return;
            const state = buildRemoteState();
            const key = JSON.stringify(state);
            if (key === lastSent) return;
            lastSent = key;
            useNetworkStore.getState().sendStateUpdate(state);
        };

        const unsubP = usePomodoroStore.subscribe((s, prev) => {
            if (
                s.currentPhase !== prev.currentPhase ||
                s.isRunning !== prev.isRunning ||
                s.currentRound !== prev.currentRound
            ) {
                send();
            }
        });

        // 心跳 5s 兜底；按键计数与 remainingSeconds 通过这条同步
        const interval = setInterval(send, 5000);
        return () => {
            unsubP();
            clearInterval(interval);
        };
    }, []);
}
