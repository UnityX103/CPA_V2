import type { BindingKeyEntry } from '../bindingKey';
import type { DangerousChange } from '../settings';
import type { ConnectionStatus, RemotePlayer } from '../network';
import type { PomodoroEndActionMode, PomodoroEndActionVideo } from '../pomodoro';
import type { ActiveAppInfo } from '../activeApp';
import type { AppUpdateSnapshot } from '../appUpdate';

export const EVT_STATE_REQUEST = 'app:state:request';
export const EVT_STATE = 'app:state';
export const EVT_DISPATCH = 'app:dispatch';
export const BRIDGE_VERSION = 1 as const;

export interface BridgeSnapshot {
    v: typeof BRIDGE_VERSION;
    settings: {
        uiScale: number;
        committedUiScale: number;
        showActiveAppWindowTitle: boolean;
        dangerousChange: DangerousChange | null;
    };
    pomodoro: {
        focusDurationSeconds: number;
        breakDurationSeconds: number;
        totalRounds: number;
        autoStartBreak: boolean;
        endActionMode: PomodoroEndActionMode;
        endActionVideo: PomodoroEndActionVideo;
    };
    network: {
        autoConnect: boolean;
        playerName: string;
        playerId: string | null;
        roomCode: string;
        status: ConnectionStatus;
        players: Record<string, RemotePlayer>;
        lastError: string | null;
    };
    activeApp: ActiveAppInfo | null;
    bindingKey: {
        panelEnabled: boolean;
        entries: BindingKeyEntry[];
        capturingId: string | null;
        syncedKeyId: string | null;
    };
    appUpdate: AppUpdateSnapshot;
}

export type DispatchPayload =
    | { v: typeof BRIDGE_VERSION; store: 'settings';   action: 'setUiScale' | 'previewDangerousUiScale'; args: [number] }
    | { v: typeof BRIDGE_VERSION; store: 'settings';   action: 'setShowActiveAppWindowTitle'; args: [boolean] }
    | { v: typeof BRIDGE_VERSION; store: 'settings';   action: 'applyDangerousChange' | 'revertDangerousChange'; args: [string] }
    | { v: typeof BRIDGE_VERSION; store: 'pomodoro';   action: 'applySettings'; args: [number, number, number, boolean, boolean] }
    | { v: typeof BRIDGE_VERSION; store: 'pomodoro';   action: 'applyEndActionSettings'; args: [PomodoroEndActionMode, PomodoroEndActionVideo] }
    | { v: typeof BRIDGE_VERSION; store: 'network';    action: 'createRoom' | 'joinRoom'; args: [string] }
    | { v: typeof BRIDGE_VERSION; store: 'network';    action: 'leaveRoom'; args: [] }
    | { v: typeof BRIDGE_VERSION; store: 'network';    action: 'setAutoConnect'; args: [boolean] }
    | { v: typeof BRIDGE_VERSION; store: 'network';    action: 'setPlayerName'; args: [string] }
    | { v: typeof BRIDGE_VERSION; store: 'bindingKey'; action: 'beginCapture' | 'removeEntry'; args: [string] }
    | { v: typeof BRIDGE_VERSION; store: 'bindingKey'; action: 'setPanelEnabled'; args: [boolean] }
    | { v: typeof BRIDGE_VERSION; store: 'bindingKey'; action: 'setSynced'; args: [string | null] }
    | { v: typeof BRIDGE_VERSION; store: 'bindingKey'; action: 'completeCapture'; args: [number, string] }
    | { v: typeof BRIDGE_VERSION; store: 'bindingKey'; action: 'addEntry'; args: [] }
    | { v: typeof BRIDGE_VERSION; store: 'appUpdate';  action: 'setAutoUpdateEnabled'; args: [boolean] }
    | { v: typeof BRIDGE_VERSION; store: 'appUpdate';  action: 'checkNow' | 'restartForUpdate'; args: [] };
