import { useEffect, useState } from 'react';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { useSettingsStore, type DangerousChange } from '../settings';
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
import { usePresenceStore } from '../presence';
import { clonePomodoroEndSounds } from '../pomodoroSounds';

const INITIAL_SNAPSHOT_RETRY_MS = 1000;

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
    return entries.map((entry) => ({
        ...entry,
        input: entry.input ? { ...entry.input } : entry.input,
    }));
}

function cloneDangerousChange(change: DangerousChange | null): DangerousChange | null {
    return change ? { ...change } : null;
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
        autostartEnabled: snap.settings.autostartEnabled,
        dangerousChange: cloneDangerousChange(snap.settings.dangerousChange),
    });
    usePomodoroStore.setState({
        focusDurationSeconds: snap.pomodoro.focusDurationSeconds,
        breakDurationSeconds: snap.pomodoro.breakDurationSeconds,
        totalRounds: snap.pomodoro.totalRounds,
        autoStartBreak: snap.pomodoro.autoStartBreak,
        autoPinAfterFocus: snap.pomodoro.autoPinAfterFocus,
        endActionMode: snap.pomodoro.endActionMode,
        endActionVideo: { ...snap.pomodoro.endActionVideo },
        endSounds: clonePomodoroEndSounds(snap.pomodoro.endSounds),
    });
    usePresenceStore.setState({
        enabled: snap.presence.enabled,
        intervalSeconds: snap.presence.intervalSeconds,
        platform: snap.presence.platform,
        availability: snap.presence.availability,
        latestObservation: snap.presence.latestObservation,
        lastSuccessfulAt: snap.presence.lastSuccessfulAt,
        lastError: snap.presence.lastError,
    });
    useNetworkStore.setState({
        autoConnect: snap.network.autoConnect,
        playerName: snap.network.playerName,
        playerId: snap.network.playerId,
        roomCode: snap.network.roomCode,
        status: snap.network.status,
        players: clonePlayers(snap.network.players),
        lastError: snap.network.lastError,
        accountStatus: snap.network.accountStatus,
        accountUser: snap.network.accountUser ? { ...snap.network.accountUser } : null,
        accountToken: snap.network.accountToken,
        accountError: snap.network.accountError,
        cloudSyncStatus: snap.network.cloudSyncStatus,
        cloudData: snap.network.cloudData ? JSON.parse(JSON.stringify(snap.network.cloudData)) : null,
        cloudDataUpdatedAt: snap.network.cloudDataUpdatedAt,
        cloudError: snap.network.cloudError,
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
        let initialSnapshotReceived = false;
        let retryTimer: number | null = null;
        const unlistens: UnlistenFn[] = [];

        async function requestInitialSnapshot(): Promise<void> {
            try {
                const main = await WebviewWindow.getByLabel('main');
                if (cancelled || initialSnapshotReceived) return;
                await main?.emit(EVT_STATE_REQUEST, {});
            } catch (err) {
                console.warn('[bridge] failed to request initial snapshot', err);
            }
        }

        listen<BridgeSnapshot>(EVT_STATE, (e) => {
            applySnapshotToMirrors(e.payload);
            if (e.payload.v === BRIDGE_VERSION) {
                initialSnapshotReceived = true;
                if (retryTimer != null) {
                    window.clearInterval(retryTimer);
                    retryTimer = null;
                }
                setHasInitialSnapshot(true);
            }
        })
            .then(async (u) => {
                if (cancelled) { u(); return; }
                unlistens.push(u);
                // Listener attached. Now safe to request the initial snapshot — the host's
                // reply via EVT_STATE will land in our listener. Hidden windows can attach
                // before the main host listener is ready, so retry until the first snapshot.
                await requestInitialSnapshot();
                if (!cancelled && !initialSnapshotReceived) {
                    retryTimer = window.setInterval(() => {
                        void requestInitialSnapshot();
                    }, INITIAL_SNAPSHOT_RETRY_MS);
                }
            })
            .catch((err) => { console.warn('[bridge] failed to attach listener', err); });

        return () => {
            cancelled = true;
            if (retryTimer != null) {
                window.clearInterval(retryTimer);
            }
            unlistens.forEach((u) => u());
        };
    }, []);

    return hasInitialSnapshot;
}
