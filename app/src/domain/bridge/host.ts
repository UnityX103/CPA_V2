import { useEffect } from 'react';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { useSettingsStore, type DangerousChange } from '../settings';
import { usePomodoroStore } from '../pomodoro';
import { useNetworkStore, type RemotePlayer } from '../network';
import { useBindingKeyStore, type BindingKeyEntry } from '../bindingKey';
import { useActiveAppStore, type ActiveAppInfo } from '../activeApp';
import { useAppUpdateStore, type AppUpdateSnapshot } from '../appUpdate';
import { REMOTE_PLAYER_WINDOW_LABELS } from '../remotePlayerWindowLabels';
import {
    usePresenceStore,
    type PresenceAbsenceSensitivity,
} from '../presence';
import { clonePomodoroEndSounds, type PomodoroEndSounds } from '../pomodoroSounds';
import {
    BRIDGE_VERSION,
    EVT_DISPATCH,
    EVT_DISPATCH_RESULT,
    EVT_STATE,
    EVT_STATE_REQUEST,
    type BridgeSnapshot,
    type ConfirmedDispatchRequest,
    type DispatchEventPayload,
    type DispatchPayload,
    type DispatchResult,
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
    return entries.map((entry) => ({
        ...entry,
        input: entry.input ? { ...entry.input } : entry.input,
    }));
}

function cloneDangerousChange(change: DangerousChange | null): DangerousChange | null {
    return change ? { ...change } : null;
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
        downloadedBytes: s.downloadedBytes,
        downloadTotalBytes: s.downloadTotalBytes,
    };
}

export function buildSnapshot(opts: BuildSnapshotOptions = {}): BridgeSnapshot {
    const s = useSettingsStore.getState();
    const p = usePomodoroStore.getState();
    const n = useNetworkStore.getState();
    const b = useBindingKeyStore.getState();
    const a = useActiveAppStore.getState();
    const u = useAppUpdateStore.getState();
    const presence = usePresenceStore.getState();
    return {
        v: BRIDGE_VERSION,
        settings: {
            uiScale: s.uiScale,
            committedUiScale: s.committedUiScale,
            autostartEnabled: s.autostartEnabled,
            audioOutputDeviceId: s.audioOutputDeviceId,
            soundVolume: s.soundVolume,
            dangerousChange: cloneDangerousChange(s.dangerousChange),
        },
        pomodoro: {
            focusDurationSeconds: p.focusDurationSeconds,
            breakDurationSeconds: p.breakDurationSeconds,
            totalRounds: p.totalRounds,
            autoStartBreak: p.autoStartBreak,
            autoPinAfterFocus: p.autoPinAfterFocus,
            endActionMode: p.endActionMode,
            endActionVideo: { ...p.endActionVideo },
            endSounds: clonePomodoroEndSounds(p.endSounds),
        },
        presence: {
            enabled: presence.enabled,
            intervalSeconds: presence.intervalSeconds,
            absenceSensitivity: presence.absenceSensitivity,
            platform: presence.platform,
            availability: presence.availability,
            latestObservation: presence.latestObservation,
            lastSuccessfulAt: presence.lastSuccessfulAt,
            lastError: presence.lastError,
        },
        network: {
            autoConnect: n.autoConnect,
            playerName: n.playerName,
            playerId: n.playerId,
            roomCode: n.roomCode,
            status: n.status,
            players: clonePlayers(n.players),
            lastError: n.lastError,
            accountStatus: n.accountStatus,
            accountUser: n.accountUser ? { ...n.accountUser } : null,
            accountToken: n.accountToken,
            accountError: n.accountError,
            cloudSyncStatus: n.cloudSyncStatus,
            cloudData: n.cloudData ? JSON.parse(JSON.stringify(n.cloudData)) : null,
            cloudDataUpdatedAt: n.cloudDataUpdatedAt,
            cloudError: n.cloudError,
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

export async function applyDispatch(payload: DispatchPayload): Promise<void> {
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
                case 'setAutostartEnabled': await s.setAutostartEnabled(...payload.args); return;
                case 'setAudioOutputDeviceId': s.setAudioOutputDeviceId(...payload.args); return;
                case 'setSoundVolume': s.setSoundVolume(...payload.args); return;
                case 'applyDangerousChange': s.applyDangerousChange(...payload.args); return;
                case 'revertDangerousChange': s.revertDangerousChange(...payload.args); return;
            }
            return;
        }
        case 'pomodoro': {
            if (payload.action === 'applySettings') {
                usePomodoroStore.getState().applySettings(...payload.args);
            }
            if (payload.action === 'setAutoPinAfterFocus') {
                usePomodoroStore.getState().setAutoPinAfterFocus(...payload.args);
            }
            if (payload.action === 'applyEndActionSettings') {
                await usePomodoroStore.getState().applyEndActionSettings(...payload.args);
            }
            if (payload.action === 'applyEndSoundSettings') {
                await usePomodoroStore.getState().applyEndSoundSettings(...payload.args);
            }
            return;
        }
        case 'presence': {
            const presence = usePresenceStore.getState();
            switch (payload.action) {
                case 'applySettings': await presence.applySettings(...payload.args); return;
                case 'requestAccess': await presence.requestAccess(); return;
                case 'retry': await presence.retry(); return;
                case 'openPrivacySettings': await presence.openPrivacySettings(); return;
            }
            return;
        }
        case 'network': {
            const n = useNetworkStore.getState();
            switch (payload.action) {
                case 'createRoom':     await n.createRoom(...payload.args); return;
                case 'joinRoom':       await n.joinRoom(...payload.args); return;
                case 'leaveRoom':      n.leaveRoom(); return;
                case 'setAutoConnect': n.setAutoConnect(...payload.args); return;
                case 'setPlayerName':  n.setPlayerName(...payload.args); return;
                case 'createAccount':  await n.createAccount(...payload.args); return;
                case 'login':          await n.login(...payload.args); return;
                case 'restoreAccountSession': await n.restoreAccountSession(); return;
                case 'logout':         n.logout(); return;
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
                case 'setAutoUpdateEnabled': await u.setAutoUpdateEnabled(...payload.args); return;
                case 'checkNow': await u.checkNow(); return;
                case 'restartForUpdate': await u.restartForUpdate(); return;
            }
            return;
        }
    }
}

function isConfirmedDispatchRequest(
    payload: DispatchEventPayload,
): payload is ConfirmedDispatchRequest {
    return 'requestId' in payload && 'replyTo' in payload && 'payload' in payload;
}

export async function handleDispatchEvent(payload: DispatchEventPayload): Promise<void> {
    if (!isConfirmedDispatchRequest(payload)) {
        await applyDispatch(payload);
        return;
    }

    let result: DispatchResult;
    try {
        await applyDispatch(payload.payload);
        result = { requestId: payload.requestId, ok: true };
    } catch (error) {
        result = {
            requestId: payload.requestId,
            ok: false,
            error: error instanceof Error ? error.message : String(error),
        };
    }

    const replyWindow = await WebviewWindow.getByLabel(payload.replyTo);
    await replyWindow?.emit(EVT_DISPATCH_RESULT, result);
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
    autostartEnabled: boolean;
    audioOutputDeviceId: string | null;
    soundVolume: number;
    dangerousChange: unknown;
}): string {
    return JSON.stringify([
        s.uiScale,
        s.committedUiScale,
        s.autostartEnabled,
        s.audioOutputDeviceId,
        s.soundVolume,
        s.dangerousChange,
    ]);
}

export function pomoSig(s: {
    focusDurationSeconds: number;
    breakDurationSeconds: number;
    totalRounds: number;
    autoStartBreak: boolean;
    autoPinAfterFocus: boolean;
    endActionMode: string;
    endActionVideo: { sourceKind: string; builtinVideoId: string; customVideoPath: string };
    endSounds: PomodoroEndSounds;
}): string {
    return JSON.stringify([
        s.focusDurationSeconds,
        s.breakDurationSeconds,
        s.totalRounds,
        s.autoStartBreak,
        s.autoPinAfterFocus,
        s.endActionMode,
        s.endActionVideo.sourceKind,
        s.endActionVideo.builtinVideoId,
        s.endActionVideo.customVideoPath,
        s.endSounds.focus.sourceKind,
        s.endSounds.focus.builtinSoundId,
        s.endSounds.focus.customSoundPath,
        s.endSounds.break.sourceKind,
        s.endSounds.break.builtinSoundId,
        s.endSounds.break.customSoundPath,
    ]);
}

export function presenceSig(s: {
    enabled: boolean;
    intervalSeconds: number;
    absenceSensitivity: PresenceAbsenceSensitivity;
    platform: string;
    availability: string;
    latestObservation: string;
    lastSuccessfulAt: number | null;
    lastError: string | null;
}): string {
    return JSON.stringify([
        s.enabled,
        s.intervalSeconds,
        s.absenceSensitivity,
        s.platform,
        s.availability,
        s.latestObservation,
        s.lastSuccessfulAt,
        s.lastError,
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
    accountStatus: string;
    accountUser: { userId: string; username: string } | null;
    accountToken: string | null;
    accountError: string | null;
    cloudSyncStatus: string;
    cloudData: unknown;
    cloudDataUpdatedAt: number | null;
    cloudError: string | null;
}): string {
    return JSON.stringify([
        s.autoConnect,
        s.playerName,
        s.playerId,
        s.roomCode,
        s.status,
        Object.keys(s.players).sort().map((id) => [id, s.players[id]]),
        s.lastError,
        s.accountStatus,
        s.accountUser,
        s.accountToken,
        s.accountError,
        s.cloudSyncStatus,
        s.cloudData,
        s.cloudDataUpdatedAt,
        s.cloudError,
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
        s.downloadedBytes,
        s.downloadTotalBytes,
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

        listen<DispatchEventPayload>(EVT_DISPATCH, (e) => {
            void handleDispatchEvent(e.payload).catch((error) => {
                console.warn('[bridge] failed to handle dispatch', error);
            });
        })
            .then((u) => {
                if (cancelled) u();
                else unlistens.push(u);
            })
            .catch((err) => { console.warn('[bridge] failed to attach listener', err); });

        let prevSettings = settingsSig(useSettingsStore.getState());
        let prevPomo = pomoSig(usePomodoroStore.getState());
        let prevPresence = presenceSig(usePresenceStore.getState());
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
            usePresenceStore.subscribe((s) => {
                const sig = presenceSig(s);
                if (sig === prevPresence) return;
                prevPresence = sig;
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
