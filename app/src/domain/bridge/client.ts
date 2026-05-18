import { useEffect, useState } from 'react';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { useSettingsStore } from '../settings';
import { usePomodoroStore } from '../pomodoro';
import { useNetworkStore, type RemotePlayer } from '../network';
import { useBindingKeyStore, type BindingKeyEntry } from '../bindingKey';
import { useActiveAppStore, type ActiveAppInfo } from '../activeApp';
import { useAppUpdateStore } from '../appUpdate';
import {
    BRIDGE_VERSION,
    EVT_STATE,
    EVT_STATE_REQUEST,
    type BridgeSnapshot,
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

function hasIconDataProperty(activeApp: ActiveAppInfo): boolean {
    return Object.prototype.hasOwnProperty.call(activeApp, 'icon_data_url');
}

function sameActiveAppIdentity(a: ActiveAppInfo, b: ActiveAppInfo): boolean {
    return a.name === b.name && a.bundle_id === b.bundle_id;
}

function cloneActiveAppForMirror(activeApp: ActiveAppInfo | null): ActiveAppInfo | null {
    if (!activeApp) return null;
    const incoming = { ...activeApp };
    if (hasIconDataProperty(incoming)) return incoming;

    const previous = useActiveAppStore.getState().current;
    if (previous?.icon_data_url && sameActiveAppIdentity(previous, incoming)) {
        return { ...incoming, icon_data_url: previous.icon_data_url };
    }
    return incoming;
}

export function applySnapshotToMirrors(snap: BridgeSnapshot): void {
    if (snap.v !== BRIDGE_VERSION) {
        console.warn('[bridge] snapshot version mismatch:', snap.v);
        return;
    }
    useSettingsStore.setState({
        uiScale: snap.settings.uiScale,
        committedUiScale: snap.settings.committedUiScale,
        showActiveAppWindowTitle: snap.settings.showActiveAppWindowTitle,
        dangerousChange: snap.settings.dangerousChange,
    });
    usePomodoroStore.setState({
        focusDurationSeconds: snap.pomodoro.focusDurationSeconds,
        breakDurationSeconds: snap.pomodoro.breakDurationSeconds,
        totalRounds: snap.pomodoro.totalRounds,
        autoStartBreak: snap.pomodoro.autoStartBreak,
        endActionMode: snap.pomodoro.endActionMode,
        endActionVideo: { ...snap.pomodoro.endActionVideo },
    });
    useNetworkStore.setState({
        autoConnect: snap.network.autoConnect,
        playerName: snap.network.playerName,
        playerId: snap.network.playerId,
        roomCode: snap.network.roomCode,
        status: snap.network.status,
        players: clonePlayers(snap.network.players),
        lastError: snap.network.lastError,
    });
    useActiveAppStore.setState({
        current: cloneActiveAppForMirror(snap.activeApp),
    });
    useBindingKeyStore.setState({
        panelEnabled: snap.bindingKey.panelEnabled,
        entries: cloneEntries(snap.bindingKey.entries),
        capturingId: snap.bindingKey.capturingId,
        syncedKeyId: snap.bindingKey.syncedKeyId,
    });
    useAppUpdateStore.getState().applySnapshot({ ...snap.appUpdate });
}

export function useBridgeClient(): boolean {
    const [hasInitialSnapshot, setHasInitialSnapshot] = useState(false);

    useEffect(() => {
        let cancelled = false;
        const unlistens: UnlistenFn[] = [];

        listen<BridgeSnapshot>(EVT_STATE, (e) => {
            applySnapshotToMirrors(e.payload);
            if (e.payload.v === BRIDGE_VERSION) {
                setHasInitialSnapshot(true);
            }
        })
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

    return hasInitialSnapshot;
}
