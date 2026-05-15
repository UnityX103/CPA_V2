import { useEffect } from 'react';
import { usePomodoroStore, type PomodoroPhase } from './pomodoro';
import { useNetworkStore, type RemoteState } from './network';
import { useActiveAppStore } from './activeApp';
import { useBindingKeyStore } from './bindingKey';

const PHASE_TO_INT: Record<PomodoroPhase, number> = { focus: 0, break: 1, completed: 2 };

function buildRemoteState(): RemoteState {
    const p = usePomodoroStore.getState();
    const active = useActiveAppStore.getState().current;
    const bk = useBindingKeyStore.getState();
    const synced = bk.syncedKeyId
        ? bk.entries.find((e) => e.id === bk.syncedKeyId && e.enabled)
        : undefined;
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
        // 只把被标记同步的那条 entry 推到房间；未选时整个字段为 null，
        // 协议层与对端 PlayerCard 都已按 null 隐藏 KeyCounterPill
        bindingKey: synced
            ? { keyLabel: synced.label, pressCount: synced.pressCount }
            : null,
    };
}

// 重新加入房间后第一帧必须广播状态：用 (roomCode, playerId) 作为 key 前缀，
// 让相同 payload 但属于新房间时也认为「未发送过」。adversarial-review #3
let lastSent = '';

export function useStateSync() {
    useEffect(() => {
        const send = () => {
            const net = useNetworkStore.getState();
            if (net.status !== 'joined') return;
            const state = buildRemoteState();
            const key = `${net.roomCode}:${net.playerId}:${JSON.stringify(state)}`;
            if (key === lastSent) return;
            lastSent = key;
            net.sendStateUpdate(state);
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

        const unsubN = useNetworkStore.subscribe((s, prev) => {
            // 离开/重连时清空 dedupe，下一次 join 立即重发
            if (s.status !== 'joined' && prev.status === 'joined') {
                lastSent = '';
            }
            // 进入 joined 立即推一次初始状态
            if (s.status === 'joined' && prev.status !== 'joined') {
                lastSent = '';
                send();
            }
        });

        const interval = setInterval(send, 5000);
        return () => {
            unsubP();
            unsubN();
            clearInterval(interval);
        };
    }, []);
}
