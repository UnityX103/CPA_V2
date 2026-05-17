import type { BindingKeyEntry } from '../bindingKey';
import type { DangerousChange } from '../settings';
import type { ConnectionStatus, RemotePlayer } from '../network';

export const EVT_STATE_REQUEST = 'app:state:request';
export const EVT_STATE = 'app:state';
export const EVT_DISPATCH = 'app:dispatch';
export const BRIDGE_VERSION = 1 as const;

export interface BridgeSnapshot {
    v: typeof BRIDGE_VERSION;
    settings: {
        uiScale: number;
        committedUiScale: number;
        dangerousChange: DangerousChange | null;
    };
    pomodoro: {
        focusDurationSeconds: number;
        breakDurationSeconds: number;
        totalRounds: number;
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
    bindingKey: {
        entries: BindingKeyEntry[];
        capturingId: string | null;
        syncedKeyId: string | null;
    };
}

export type DispatchPayload =
    | { v: typeof BRIDGE_VERSION; store: 'settings';   action: 'setUiScale' | 'previewDangerousUiScale'; args: [number] }
    | { v: typeof BRIDGE_VERSION; store: 'settings';   action: 'applyDangerousChange' | 'revertDangerousChange'; args: [string] }
    | { v: typeof BRIDGE_VERSION; store: 'pomodoro';   action: 'applySettings'; args: [number, number, number, boolean] }
    | { v: typeof BRIDGE_VERSION; store: 'network';    action: 'createRoom' | 'joinRoom'; args: [string] }
    | { v: typeof BRIDGE_VERSION; store: 'network';    action: 'leaveRoom'; args: [] }
    | { v: typeof BRIDGE_VERSION; store: 'network';    action: 'setAutoConnect'; args: [boolean] }
    | { v: typeof BRIDGE_VERSION; store: 'network';    action: 'setPlayerName'; args: [string] }
    | { v: typeof BRIDGE_VERSION; store: 'bindingKey'; action: 'beginCapture' | 'removeEntry'; args: [string] }
    | { v: typeof BRIDGE_VERSION; store: 'bindingKey'; action: 'setSynced'; args: [string | null] }
    | { v: typeof BRIDGE_VERSION; store: 'bindingKey'; action: 'addEntry'; args: [] };
