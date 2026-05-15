import { useEffect } from 'react';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { useSettingsStore } from '../settings';
import { usePomodoroStore } from '../pomodoro';
import { useNetworkStore } from '../network';
import { useBindingKeyStore } from '../bindingKey';
import {
    BRIDGE_VERSION,
    EVT_STATE,
    EVT_STATE_REQUEST,
    type BridgeSnapshot,
} from './protocol';

export function applySnapshotToMirrors(snap: BridgeSnapshot): void {
    if (snap.v !== BRIDGE_VERSION) {
        console.warn('[bridge] snapshot version mismatch:', snap.v);
        return;
    }
    useSettingsStore.setState({
        uiScale: snap.settings.uiScale,
        targetMonitorIndex: snap.settings.targetMonitorIndex,
    });
    usePomodoroStore.setState({
        focusDurationSeconds: snap.pomodoro.focusDurationSeconds,
        breakDurationSeconds: snap.pomodoro.breakDurationSeconds,
        totalRounds: snap.pomodoro.totalRounds,
    });
    useNetworkStore.setState({
        autoConnect: snap.network.autoConnect,
        playerName: snap.network.playerName,
        playerId: snap.network.playerId,
        roomCode: snap.network.roomCode,
        status: snap.network.status,
        players: snap.network.players,
        lastError: snap.network.lastError,
    });
    useBindingKeyStore.setState({
        entries: snap.bindingKey.entries,
        capturingId: snap.bindingKey.capturingId,
        syncedKeyId: snap.bindingKey.syncedKeyId,
    });
}

export function useBridgeClient(): void {
    useEffect(() => {
        let cancelled = false;
        const unlistens: UnlistenFn[] = [];

        listen<BridgeSnapshot>(EVT_STATE, (e) => { applySnapshotToMirrors(e.payload); })
            .then(async (u) => {
                if (cancelled) { u(); return; }
                unlistens.push(u);
                // Listener attached. Now safe to request the initial snapshot — the host's
                // reply via EVT_STATE will land in our listener.
                try {
                    const main = await WebviewWindow.getByLabel('main');
                    if (cancelled) return;
                    await main?.emit(EVT_STATE_REQUEST, {});
                } catch (err) {
                    console.warn('[bridge] failed to request initial snapshot', err);
                }
            })
            .catch((err) => { console.warn('[bridge] failed to attach listener', err); });

        return () => {
            cancelled = true;
            unlistens.forEach((u) => u());
        };
    }, []);
}
