import { useEffect } from 'react';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { useSettingsStore } from '../settings';
import { usePomodoroStore } from '../pomodoro';
import { useNetworkStore, type RemotePlayer } from '../network';
import { useBindingKeyStore, type BindingKeyEntry } from '../bindingKey';
import {
    BRIDGE_VERSION,
    EVT_DISPATCH,
    EVT_STATE,
    EVT_STATE_REQUEST,
    type BridgeSnapshot,
    type DispatchPayload,
} from './protocol';

function clonePlayer(player: RemotePlayer): RemotePlayer {
    return {
        ...player,
        state: player.state
            ? {
                pomodoro: { ...player.state.pomodoro },
                activeApp: player.state.activeApp ? { ...player.state.activeApp } : null,
                bindingKey: player.state.bindingKey ? { ...player.state.bindingKey } : null,
            }
            : null,
    };
}

function clonePlayers(players: Record<string, RemotePlayer>): Record<string, RemotePlayer> {
    return Object.fromEntries(
        Object.entries(players).map(([id, player]) => [id, clonePlayer(player)]),
    );
}

function cloneEntries(entries: BindingKeyEntry[]): BindingKeyEntry[] {
    return entries.map((entry) => ({ ...entry }));
}

export function buildSnapshot(): BridgeSnapshot {
    const s = useSettingsStore.getState();
    const p = usePomodoroStore.getState();
    const n = useNetworkStore.getState();
    const b = useBindingKeyStore.getState();
    return {
        v: BRIDGE_VERSION,
        settings: {
            uiScale: s.uiScale,
            committedUiScale: s.committedUiScale,
            dangerousChange: s.dangerousChange,
        },
        pomodoro: {
            focusDurationSeconds: p.focusDurationSeconds,
            breakDurationSeconds: p.breakDurationSeconds,
            totalRounds: p.totalRounds,
            autoStartBreak: p.autoStartBreak,
            endActionMode: p.endActionMode,
            endActionVideo: { ...p.endActionVideo },
        },
        network: {
            autoConnect: n.autoConnect,
            playerName: n.playerName,
            playerId: n.playerId,
            roomCode: n.roomCode,
            status: n.status,
            players: clonePlayers(n.players),
            lastError: n.lastError,
        },
        bindingKey: {
            entries: cloneEntries(b.entries),
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
            switch (payload.action) {
                case 'setUiScale': s.setUiScale(...payload.args); return;
                case 'previewDangerousUiScale': s.previewDangerousUiScale(...payload.args); return;
                case 'applyDangerousChange': s.applyDangerousChange(...payload.args); return;
                case 'revertDangerousChange': s.revertDangerousChange(...payload.args); return;
            }
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

export function settingsSig(s: {
    uiScale: number;
    committedUiScale: number;
    dangerousChange: unknown;
}): string {
    return JSON.stringify([s.uiScale, s.committedUiScale, s.dangerousChange]);
}

export function pomoSig(s: {
    focusDurationSeconds: number;
    breakDurationSeconds: number;
    totalRounds: number;
    autoStartBreak: boolean;
    endActionMode: string;
    endActionVideo: { sourceKind: string; builtinVideoId: string; customVideoPath: string };
}): string {
    return JSON.stringify([
        s.focusDurationSeconds,
        s.breakDurationSeconds,
        s.totalRounds,
        s.autoStartBreak,
        s.endActionMode,
        s.endActionVideo.sourceKind,
        s.endActionVideo.builtinVideoId,
        s.endActionVideo.customVideoPath,
    ]);
}

export function networkSig(s: {
    autoConnect: boolean;
    playerName: string;
    playerId: string | null;
    roomCode: string;
    status: string;
    players: Record<string, RemotePlayer>;
    lastError: string | null;
}): string {
    return JSON.stringify([
        s.autoConnect,
        s.playerName,
        s.playerId,
        s.roomCode,
        s.status,
        Object.keys(s.players).sort().map((id) => [id, s.players[id]]),
        s.lastError,
    ]);
}

export function bindingKeySig(s: {
    entries: BindingKeyEntry[];
    capturingId: string | null;
    syncedKeyId: string | null;
}): string {
    return JSON.stringify([
        s.entries,
        s.capturingId,
        s.syncedKeyId,
    ]);
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

        let prevSettings = settingsSig(useSettingsStore.getState());
        let prevPomo = pomoSig(usePomodoroStore.getState());
        let prevNetwork = networkSig(useNetworkStore.getState());
        let prevBindingKey = bindingKeySig(useBindingKeyStore.getState());
        const subs: Array<() => void> = [
            useSettingsStore.subscribe((s) => {
                const sig = settingsSig(s);
                if (sig === prevSettings) return;
                prevSettings = sig;
                void sendSnapshot();
            }),
            usePomodoroStore.subscribe((s) => {
                const sig = pomoSig(s);
                if (sig === prevPomo) return;
                prevPomo = sig;
                void sendSnapshot();
            }),
            useNetworkStore.subscribe((s) => {
                const sig = networkSig(s);
                if (sig === prevNetwork) return;
                prevNetwork = sig;
                void sendSnapshot();
            }),
            useBindingKeyStore.subscribe((s) => {
                const sig = bindingKeySig(s);
                if (sig === prevBindingKey) return;
                prevBindingKey = sig;
                void sendSnapshot();
            }),
        ];

        return () => {
            cancelled = true;
            unlistens.forEach((u) => u());
            subs.forEach((u) => u());
        };
    }, []);
}
