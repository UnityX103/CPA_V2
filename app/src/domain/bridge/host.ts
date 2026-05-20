import { useEffect } from 'react';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { useSettingsStore } from '../settings';
import { usePomodoroStore } from '../pomodoro';
import { useNetworkStore, type RemotePlayer } from '../network';
import { useBindingKeyStore, type BindingKeyEntry } from '../bindingKey';
import { useActiveAppStore, type ActiveAppInfo } from '../activeApp';
import { useAppUpdateStore, type AppUpdateSnapshot } from '../appUpdate';
import { REMOTE_PLAYER_WINDOW_LABELS } from '../remotePlayerWindowLabels';
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

interface BuildSnapshotOptions {
    includeActiveAppIcon?: boolean;
}

function cloneActiveApp(
    current: ActiveAppInfo | null,
    opts: BuildSnapshotOptions,
): ActiveAppInfo | null {
    if (!current) return null;
    if (opts.includeActiveAppIcon) return { ...current };
    const { icon_data_url: _iconDataUrl, ...withoutIcon } = current;
    return withoutIcon;
}

function appUpdateSnapshot(s: AppUpdateSnapshot): AppUpdateSnapshot {
    return {
        autoUpdateEnabled: s.autoUpdateEnabled,
        status: s.status,
        currentVersion: s.currentVersion,
        availableVersion: s.availableVersion,
        releaseNotes: s.releaseNotes,
        lastCheckedAt: s.lastCheckedAt,
        errorMessage: s.errorMessage,
    };
}

export function buildSnapshot(opts: BuildSnapshotOptions = {}): BridgeSnapshot {
    const s = useSettingsStore.getState();
    const p = usePomodoroStore.getState();
    const n = useNetworkStore.getState();
    const b = useBindingKeyStore.getState();
    const a = useActiveAppStore.getState();
    const u = useAppUpdateStore.getState();
    return {
        v: BRIDGE_VERSION,
        settings: {
            uiScale: s.uiScale,
            committedUiScale: s.committedUiScale,
            showActiveAppWindowTitle: s.showActiveAppWindowTitle,
            autostartEnabled: s.autostartEnabled,
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
        activeApp: cloneActiveApp(a.current, opts),
        bindingKey: {
            panelEnabled: b.panelEnabled,
            entries: cloneEntries(b.entries),
            capturingId: b.capturingId,
            syncedKeyId: b.syncedKeyId,
        },
        appUpdate: appUpdateSnapshot(u),
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
                case 'setShowActiveAppWindowTitle': s.setShowActiveAppWindowTitle(...payload.args); return;
                case 'setAutostartEnabled': void s.setAutostartEnabled(...payload.args); return;
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
                case 'setPanelEnabled': b.setPanelEnabled(...payload.args); return;
                case 'setSynced':    b.setSynced(...payload.args); return;
                case 'completeCapture': b.completeCapture(...payload.args); return;
                case 'addEntry':     b.addEntry(); return;
            }
            return;
        }
        case 'appUpdate': {
            const u = useAppUpdateStore.getState();
            switch (payload.action) {
                case 'setAutoUpdateEnabled': void u.setAutoUpdateEnabled(...payload.args); return;
                case 'checkNow': void u.checkNow(); return;
                case 'restartForUpdate': void u.restartForUpdate(); return;
            }
            return;
        }
    }
}

export const MIRROR_WINDOW_LABELS = [
    'settings',
    'input-counter',
    ...REMOTE_PLAYER_WINDOW_LABELS,
] as const;

async function sendSnapshot(opts: BuildSnapshotOptions = {}): Promise<void> {
    try {
        const snap = buildSnapshot(opts);
        await Promise.all(MIRROR_WINDOW_LABELS.map(async (label) => {
            const w = await WebviewWindow.getByLabel(label);
            if (!w) return;
            await w.emit(EVT_STATE, snap);
        }));
    } catch {
        /* swallow — mirror windows may not be open */
    }
}

export function settingsSig(s: {
    uiScale: number;
    committedUiScale: number;
    showActiveAppWindowTitle: boolean;
    autostartEnabled: boolean;
    dangerousChange: unknown;
}): string {
    return JSON.stringify([
        s.uiScale,
        s.committedUiScale,
        s.showActiveAppWindowTitle,
        s.autostartEnabled,
        s.dangerousChange,
    ]);
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
    panelEnabled: boolean;
    entries: BindingKeyEntry[];
    capturingId: string | null;
    syncedKeyId: string | null;
}): string {
    return JSON.stringify([
        s.panelEnabled,
        s.entries,
        s.capturingId,
        s.syncedKeyId,
    ]);
}

export function appUpdateSig(s: AppUpdateSnapshot): string {
    return JSON.stringify([
        s.autoUpdateEnabled,
        s.status,
        s.currentVersion,
        s.availableVersion,
        s.releaseNotes,
        s.lastCheckedAt,
        s.errorMessage,
    ]);
}

export function activeAppSig(s: { current: ActiveAppInfo | null }): string {
    if (!s.current) return JSON.stringify(null);
    const { icon_data_url: _iconDataUrl, ...withoutIcon } = s.current;
    return JSON.stringify(withoutIcon);
}

export function activeAppIdentitySig(s: { current: ActiveAppInfo | null }): string {
    if (!s.current) return JSON.stringify(null);
    return JSON.stringify([s.current.name, s.current.bundle_id]);
}

export function useBridgeHost(): void {
    useEffect(() => {
        let cancelled = false;
        const unlistens: UnlistenFn[] = [];

        listen(EVT_STATE_REQUEST, () => { void sendSnapshot({ includeActiveAppIcon: true }); })
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
        let prevAppUpdate = appUpdateSig(useAppUpdateStore.getState());
        let prevActiveApp = activeAppSig(useActiveAppStore.getState());
        let prevActiveAppIdentity = activeAppIdentitySig(useActiveAppStore.getState());
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
            useAppUpdateStore.subscribe((s) => {
                const sig = appUpdateSig(s);
                if (sig === prevAppUpdate) return;
                prevAppUpdate = sig;
                void sendSnapshot();
            }),
            useActiveAppStore.subscribe((s) => {
                const sig = activeAppSig(s);
                if (sig === prevActiveApp) return;
                const identitySig = activeAppIdentitySig(s);
                const includeActiveAppIcon = identitySig !== prevActiveAppIdentity;
                prevActiveApp = sig;
                prevActiveAppIdentity = identitySig;
                void sendSnapshot({ includeActiveAppIcon });
            }),
        ];

        return () => {
            cancelled = true;
            unlistens.forEach((u) => u());
            subs.forEach((u) => u());
        };
    }, []);
}
