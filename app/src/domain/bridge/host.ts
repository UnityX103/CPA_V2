import { useEffect } from 'react';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { useSettingsStore } from '../settings';
import { usePomodoroStore } from '../pomodoro';
import { useNetworkStore } from '../network';
import { useBindingKeyStore } from '../bindingKey';
import {
    BRIDGE_VERSION,
    EVT_DISPATCH,
    EVT_STATE,
    EVT_STATE_REQUEST,
    type BridgeSnapshot,
    type DispatchPayload,
} from './protocol';

export function buildSnapshot(): BridgeSnapshot {
    const s = useSettingsStore.getState();
    const p = usePomodoroStore.getState();
    const n = useNetworkStore.getState();
    const b = useBindingKeyStore.getState();
    return {
        v: BRIDGE_VERSION,
        settings: { uiScale: s.uiScale },
        pomodoro: {
            focusDurationSeconds: p.focusDurationSeconds,
            breakDurationSeconds: p.breakDurationSeconds,
            totalRounds: p.totalRounds,
            endActionMode: p.endActionMode,
            endActionVideo: p.endActionVideo,
        },
        network: {
            autoConnect: n.autoConnect,
            playerName: n.playerName,
            playerId: n.playerId,
            roomCode: n.roomCode,
            status: n.status,
            players: n.players,
            lastError: n.lastError,
        },
        bindingKey: {
            entries: b.entries,
            capturingId: b.capturingId,
            syncedKeyId: b.syncedKeyId,
        },
    };
}

export function applyDispatch(payload: DispatchPayload): void {
    if (payload.v !== BRIDGE_VERSION) {
        console.warn('[bridge] dispatch version mismatch:', payload.v);
        return;
    }
    switch (payload.store) {
        case 'settings': {
            const s = useSettingsStore.getState();
            if (payload.action === 'setUiScale') s.setUiScale(...payload.args);
            return;
        }
        case 'pomodoro': {
            if (payload.action === 'applySettings') {
                usePomodoroStore.getState().applySettings(...payload.args);
            }
            if (payload.action === 'applyEndActionSettings') {
                usePomodoroStore.getState().applyEndActionSettings(...payload.args);
            }
            return;
        }
        case 'network': {
            const n = useNetworkStore.getState();
            switch (payload.action) {
                case 'createRoom':     void n.createRoom(...payload.args); return;
                case 'joinRoom':       void n.joinRoom(...payload.args); return;
                case 'leaveRoom':      n.leaveRoom(); return;
                case 'setAutoConnect': n.setAutoConnect(...payload.args); return;
                case 'setPlayerName':  n.setPlayerName(...payload.args); return;
            }
            return;
        }
        case 'bindingKey': {
            const b = useBindingKeyStore.getState();
            switch (payload.action) {
                case 'beginCapture': b.beginCapture(...payload.args); return;
                case 'removeEntry':  b.removeEntry(...payload.args); return;
                case 'setSynced':    b.setSynced(...payload.args); return;
                case 'addEntry':     b.addEntry(); return;
            }
            return;
        }
    }
}

async function sendSnapshot(): Promise<void> {
    try {
        const w = await WebviewWindow.getByLabel('settings');
        if (!w) return;
        await w.emit(EVT_STATE, buildSnapshot());
    } catch {
        /* swallow — settings window not open */
    }
}

function pomoSig(s: {
    focusDurationSeconds: number;
    breakDurationSeconds: number;
    totalRounds: number;
    endActionMode: string;
    endActionVideo: { sourceKind: string; builtinVideoId: string; customVideoPath: string };
}): string {
    return [
        s.focusDurationSeconds,
        s.breakDurationSeconds,
        s.totalRounds,
        s.endActionMode,
        s.endActionVideo.sourceKind,
        s.endActionVideo.builtinVideoId,
        s.endActionVideo.customVideoPath,
    ].join('|');
}

export function useBridgeHost(): void {
    useEffect(() => {
        let cancelled = false;
        const unlistens: UnlistenFn[] = [];

        listen(EVT_STATE_REQUEST, () => { void sendSnapshot(); })
            .then((u) => {
                if (cancelled) u();
                else unlistens.push(u);
            })
            .catch((err) => { console.warn('[bridge] failed to attach listener', err); });

        listen<DispatchPayload>(EVT_DISPATCH, (e) => { applyDispatch(e.payload); })
            .then((u) => {
                if (cancelled) u();
                else unlistens.push(u);
            })
            .catch((err) => { console.warn('[bridge] failed to attach listener', err); });

        let prevPomo = pomoSig(usePomodoroStore.getState());
        const subs: Array<() => void> = [
            useSettingsStore.subscribe(() => { void sendSnapshot(); }),
            usePomodoroStore.subscribe((s) => {
                const sig = pomoSig(s);
                if (sig === prevPomo) return;
                prevPomo = sig;
                void sendSnapshot();
            }),
            useNetworkStore.subscribe(() => { void sendSnapshot(); }),
            useBindingKeyStore.subscribe(() => { void sendSnapshot(); }),
        ];

        return () => {
            cancelled = true;
            unlistens.forEach((u) => u());
            subs.forEach((u) => u());
        };
    }, []);
}
