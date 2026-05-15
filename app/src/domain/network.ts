import { create } from 'zustand';

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
}

const internal: NetworkInternal = { socket: null, reconnectTimer: null, pingTimer: null };

function send(socket: WebSocket | null, message: object): boolean {
    if (!socket || socket.readyState !== WebSocket.OPEN) return false;
    socket.send(JSON.stringify({ v: PROTOCOL_VERSION, ...message }));
    return true;
}

export const useNetworkStore = create<NetworkStateShape & NetworkActions>((set, get) => {
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
            if (internal.socket && internal.socket.readyState === WebSocket.OPEN) {
                resolve(internal.socket);
                return;
            }
            try {
                const url = get().serverUrl;
                const socket = new WebSocket(url);
                internal.socket = socket;
                set({ status: 'connecting', lastError: null });

                socket.onopen = () => {
                    if (internal.pingTimer != null) clearInterval(internal.pingTimer);
                    internal.pingTimer = window.setInterval(() => {
                        send(socket, { type: 'ping' });
                    }, 15_000);
                    resolve(socket);
                };
                socket.onmessage = handleMessage;
                socket.onerror = () => set({ status: 'error', lastError: 'CONNECTION_ERROR' });
                socket.onclose = () => {
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
        status: 'idle',
        serverUrl: 'ws://127.0.0.1:8039',
        autoConnect: false,
        roomCode: '',
        playerName: '我',
        playerId: null,
        players: {},
        lastError: null,

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
            send(internal.socket, { type: 'leave_room' });
            set({ status: 'idle', roomCode: '', players: {}, playerId: null });
        },
        sendStateUpdate: (state) => {
            send(internal.socket, { type: 'player_state_update', state, roomCode: get().roomCode });
        },
        disconnect: () => {
            clearTimers();
            internal.socket?.close();
            internal.socket = null;
            set({ status: 'idle', players: {}, playerId: null });
        },
    };
});
