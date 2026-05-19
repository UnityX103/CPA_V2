import { create, type StoreApi, type UseBoundStore } from 'zustand';
import { dispatch } from './bridge/dispatch';
import { BRIDGE_VERSION } from './bridge/protocol';

export const PROTOCOL_VERSION = 1;

export interface RemotePomodoroState {
    phase: number;
    remainingSeconds: number;
    currentRound: number;
    totalRounds: number;
    isRunning: boolean;
}

export interface RemoteActiveApp {
    name: string;
    bundleId: string;
    windowTitle?: string | null;
    iconDataUrl?: string | null;
    iconId?: string;
}

export interface RemoteBindingKey {
    keyLabel: string;
    pressCount: number;
}

export interface RemoteState {
    pomodoro: RemotePomodoroState;
    activeApp: RemoteActiveApp | null;
    bindingKey: RemoteBindingKey | null;
}

export interface RemotePlayer {
    playerId: string;
    playerName: string;
    state: RemoteState | null;
}

export type ConnectionStatus = 'idle' | 'connecting' | 'joined' | 'reconnecting' | 'error';

export interface NetworkStateShape {
    status: ConnectionStatus;
    serverUrl: string;
    autoConnect: boolean;
    roomCode: string;
    playerName: string;
    playerId: string | null;
    players: Record<string, RemotePlayer>;
    lastError: string | null;
}

interface NetworkActions {
    setServerUrl: (url: string) => void;
    setAutoConnect: (auto: boolean) => void;
    setPlayerName: (name: string) => void;
    createRoom: (roomCode?: string) => Promise<void>;
    joinRoom: (roomCode: string) => Promise<void>;
    leaveRoom: () => void;
    sendStateUpdate: (state: RemoteState) => void;
    disconnect: () => void;
}

interface NetworkInternal {
    socket: WebSocket | null;
    reconnectTimer: number | null;
    pingTimer: number | null;
    // 单调递增的连接代次：每次 new WebSocket 都自增；旧连接的 onopen/onclose 用代次比对
    // 与当前是否一致，避免重连竞态产生双 socket / 双 ping。adversarial-review #2
    generation: number;
}

const internal: NetworkInternal = {
    socket: null,
    reconnectTimer: null,
    pingTimer: null,
    generation: 0,
};

function send(socket: WebSocket | null, message: object): boolean {
    if (!socket || socket.readyState !== WebSocket.OPEN) return false;
    socket.send(JSON.stringify({ v: PROTOCOL_VERSION, ...message }));
    return true;
}

export type NetworkStore = UseBoundStore<StoreApi<NetworkStateShape & NetworkActions>>;

const INITIAL_STATE: NetworkStateShape = {
    status: 'idle',
    serverUrl: 'ws://127.0.0.1:8039',
    autoConnect: false,
    roomCode: '',
    playerName: '我',
    playerId: null,
    players: {},
    lastError: null,
};

export function createNetworkStore(opts: { isSettingsWindow: boolean }): NetworkStore {
    if (opts.isSettingsWindow) {
        return create<NetworkStateShape & NetworkActions>(() => ({
            ...INITIAL_STATE,
            setServerUrl: () => {},
            setAutoConnect: (auto) => {
                void dispatch({ v: BRIDGE_VERSION, store: 'network', action: 'setAutoConnect', args: [auto] });
            },
            setPlayerName: (name) => {
                void dispatch({ v: BRIDGE_VERSION, store: 'network', action: 'setPlayerName', args: [name] });
            },
            createRoom: async (roomCode) => {
                void dispatch({ v: BRIDGE_VERSION, store: 'network', action: 'createRoom', args: [roomCode ?? ''] });
            },
            joinRoom: async (roomCode) => {
                void dispatch({ v: BRIDGE_VERSION, store: 'network', action: 'joinRoom', args: [roomCode] });
            },
            leaveRoom: () => {
                void dispatch({ v: BRIDGE_VERSION, store: 'network', action: 'leaveRoom', args: [] });
            },
            sendStateUpdate: () => {},
            disconnect: () => {},
        }));
    }
    return create<NetworkStateShape & NetworkActions>((set, get) => {
        function clearTimers() {
            if (internal.reconnectTimer != null) {
                clearTimeout(internal.reconnectTimer);
                internal.reconnectTimer = null;
            }
            if (internal.pingTimer != null) {
                clearInterval(internal.pingTimer);
                internal.pingTimer = null;
            }
        }

        function handleMessage(raw: MessageEvent) {
            try {
                const msg = JSON.parse(raw.data as string);
                switch (msg.type) {
                    case 'room_created':
                    case 'room_joined':
                        set({
                            status: 'joined',
                            roomCode: msg.roomCode,
                            playerId: msg.playerId,
                            lastError: null,
                        });
                        break;
                    case 'room_snapshot': {
                        const players: Record<string, RemotePlayer> = {};
                        for (const p of msg.players ?? []) {
                            players[p.playerId] = p;
                        }
                        set({ players });
                        break;
                    }
                    case 'player_joined': {
                        const players = { ...get().players };
                        for (const p of msg.players ?? []) players[p.playerId] = p;
                        set({ players });
                        break;
                    }
                    case 'player_left': {
                        const players = { ...get().players };
                        delete players[msg.playerId];
                        set({ players });
                        break;
                    }
                    case 'player_state_broadcast': {
                        const players = { ...get().players };
                        if (players[msg.playerId]) {
                            players[msg.playerId] = { ...players[msg.playerId], state: msg.state };
                            set({ players });
                        }
                        break;
                    }
                    case 'error': {
                        set({ lastError: msg.error ?? 'INTERNAL_ERROR' });
                        break;
                    }
                    case 'pong':
                        break;
                    default:
                        break;
                }
            } catch (err) {
                console.error('[net] parse error', err);
            }
        }

        function ensureSocket(): Promise<WebSocket> {
            return new Promise((resolve, reject) => {
                if (
                    internal.socket &&
                    (internal.socket.readyState === WebSocket.OPEN ||
                        internal.socket.readyState === WebSocket.CONNECTING)
                ) {
                    resolve(internal.socket);
                    return;
                }
                try {
                    const url = get().serverUrl;
                    const generation = ++internal.generation;
                    const socket = new WebSocket(url);
                    internal.socket = socket;
                    set({ status: 'connecting', lastError: null });

                    socket.onopen = () => {
                        // 旧连接回调：当前已经被 leave/disconnect/重新 connect 取代
                        if (generation !== internal.generation) {
                            socket.close();
                            return;
                        }
                        if (internal.pingTimer != null) clearInterval(internal.pingTimer);
                        internal.pingTimer = window.setInterval(() => {
                            send(socket, { type: 'ping' });
                        }, 15_000);
                        resolve(socket);
                    };
                    socket.onmessage = (e) => {
                        if (generation !== internal.generation) return;
                        handleMessage(e);
                    };
                    socket.onerror = () => {
                        if (generation !== internal.generation) return;
                        set({ status: 'error', lastError: 'CONNECTION_ERROR' });
                    };
                    socket.onclose = () => {
                        if (generation !== internal.generation) return;
                        internal.socket = null;
                        if (internal.pingTimer != null) {
                            clearInterval(internal.pingTimer);
                            internal.pingTimer = null;
                        }
                        if (get().status === 'joined' || get().autoConnect) {
                            set({ status: 'reconnecting' });
                            if (internal.reconnectTimer != null) clearTimeout(internal.reconnectTimer);
                            internal.reconnectTimer = window.setTimeout(() => {
                                const { roomCode } = get();
                                if (roomCode) {
                                    get().joinRoom(roomCode).catch(() => {});
                                } else {
                                    set({ status: 'idle' });
                                }
                            }, 5_000);
                        } else {
                            set({ status: 'idle' });
                        }
                    };
                } catch (err) {
                    reject(err);
                }
            });
        }

        return {
            ...INITIAL_STATE,

            setServerUrl: (url) => set({ serverUrl: url }),
            setAutoConnect: (auto) => set({ autoConnect: auto }),
            setPlayerName: (name) => set({ playerName: name }),

            createRoom: async (roomCode) => {
                const socket = await ensureSocket();
                send(socket, { type: 'create_room', playerName: get().playerName, roomCode: roomCode ?? '' });
            },
            joinRoom: async (roomCode) => {
                const socket = await ensureSocket();
                send(socket, { type: 'join_room', roomCode, playerName: get().playerName });
            },
            leaveRoom: () => {
                // 取消任何待执行的重连定时器；否则 leave 后 5s 内仍会发起新连接
                // adversarial-review #2 的修复要点
                clearTimers();
                send(internal.socket, { type: 'leave_room' });
                // 推进 generation，让正在飞的旧 socket 回调全部失效
                internal.generation += 1;
                internal.socket?.close();
                internal.socket = null;
                set({ status: 'idle', roomCode: '', players: {}, playerId: null });
            },
            sendStateUpdate: (state) => {
                send(internal.socket, { type: 'player_state_update', state, roomCode: get().roomCode });
            },
            disconnect: () => {
                clearTimers();
                internal.generation += 1;
                internal.socket?.close();
                internal.socket = null;
                set({ status: 'idle', players: {}, playerId: null });
            },
        };
    });
}

function detectIsSettingsWindow(): boolean {
    if (typeof window === 'undefined') return false;
    return new URLSearchParams(window.location.search).get('window') === 'settings';
}

export const useNetworkStore: NetworkStore = createNetworkStore({
    isSettingsWindow: detectIsSettingsWindow(),
});
