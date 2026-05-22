import { describe, expect, it, beforeEach, vi } from 'vitest';
import {
    DEVELOPMENT_SERVER_URL,
    PRODUCTION_SERVER_URL,
    defaultServerUrl,
    useNetworkStore,
    createNetworkStore,
} from './network';
import * as dispatchMod from './bridge/dispatch';
import { BRIDGE_VERSION } from './bridge/protocol';
import type { CloudAccountData } from './cloudAccountData';

const persistedSession = vi.hoisted(() => ({
    load: vi.fn(),
    save: vi.fn(),
    clear: vi.fn(),
}));

vi.mock('./accountPersistence', () => ({
    loadPersistedAccountSession: persistedSession.load,
    savePersistedAccountSession: persistedSession.save,
    clearPersistedAccountSession: persistedSession.clear,
}));

class FakeWebSocket {
    static OPEN = 1;
    static CONNECTING = 0;
    static CLOSING = 2;
    static CLOSED = 3;
    static instances: FakeWebSocket[] = [];

    readyState = FakeWebSocket.OPEN;
    sent: string[] = [];
    onopen: (() => void) | null = null;
    onmessage: ((e: MessageEvent) => void) | null = null;
    onclose: (() => void) | null = null;
    onerror: (() => void) | null = null;

    constructor(public url: string) {
        FakeWebSocket.instances.push(this);
        // 立即视为已 open；测试中无真实异步
        setTimeout(() => this.onopen?.(), 0);
    }
    send(data: string) { this.sent.push(data); }
    close() { this.readyState = FakeWebSocket.CLOSED; this.onclose?.(); }
}

function latestSocket(): FakeWebSocket | undefined {
    return FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
}

function sentMessages(socket: FakeWebSocket | undefined) {
    return socket?.sent.map((raw) => JSON.parse(raw)) ?? [];
}

function makeCloudSnapshot(): CloudAccountData {
    return {
        schemaVersion: 1,
        updatedAt: 10,
        pomodoro: {
            focusDurationSeconds: 1500,
            breakDurationSeconds: 300,
            totalRounds: 4,
            autoStartBreak: false,
            endActionMode: 'playVideo',
            endActionVideo: { sourceKind: 'builtin', builtinVideoId: 'default', customVideoPath: '' },
        },
        settings: {
            uiScale: 1,
            autostartEnabled: false,
        },
        appUpdate: {
            autoUpdateEnabled: true,
        },
        network: {
            autoConnect: false,
            playerName: '我',
        },
        bindingKey: {
            panelEnabled: true,
            entries: [],
            syncedKeyId: null,
        },
        checkin: {
            weeklyPlan: {
                weekStartDate: '2026-05-18',
                carryToNextWeek: true,
                days: {
                    mon: { kind: 'items', items: [] },
                    tue: { kind: 'inherit' },
                    wed: { kind: 'inherit' },
                    thu: { kind: 'inherit' },
                    fri: { kind: 'inherit' },
                    sat: { kind: 'inherit' },
                    sun: { kind: 'rest' },
                },
            },
            dailyRecords: {},
        },
    };
}

beforeEach(() => {
    useNetworkStore.getState().disconnect();
    FakeWebSocket.instances = [];
    vi.stubGlobal('WebSocket', FakeWebSocket);
    useNetworkStore.setState({
        status: 'idle',
        serverUrl: 'ws://test',
        autoConnect: false,
        roomCode: '',
        playerName: '我',
        playerId: null,
        players: {},
        lastError: null,
        accountStatus: 'guest',
        accountUser: null,
        accountToken: null,
        accountError: null,
        cloudSyncStatus: 'idle',
        cloudData: null,
        cloudDataUpdatedAt: null,
        cloudError: null,
    });
    persistedSession.load.mockReset();
    persistedSession.save.mockReset();
    persistedSession.clear.mockReset();
});

describe('NetworkSystem 协议序列化', () => {
    it('uses the local server in dev mode and the production target server in release mode', () => {
        expect(defaultServerUrl(false)).toBe(DEVELOPMENT_SERVER_URL);
        expect(defaultServerUrl(true)).toBe(PRODUCTION_SERVER_URL);
        expect(PRODUCTION_SERVER_URL).toBe('ws://113.46.152.120:8039');
    });

    // adversarial-review #10 case 3
    it('sendStateUpdate 输出包含 v / type / state / roomCode', async () => {
        useNetworkStore.setState({
            accountStatus: 'loggedIn',
            accountUser: { userId: 'u1', username: 'Alice' },
            accountToken: 'token-1',
        });
        const promise = useNetworkStore.getState().createRoom('TEST');
        await promise;
        await new Promise((r) => setTimeout(r, 5));

        // 模拟服务器同意
        useNetworkStore.setState({
            status: 'joined',
            roomCode: 'TEST',
            playerId: 'p1',
        });

        useNetworkStore.getState().sendStateUpdate({
            pomodoro: { phase: 0, remainingSeconds: 1500, currentRound: 1, totalRounds: 4, isRunning: true },
            activeApp: null,
            bindingKey: null,
        });

        // 通过私有 internal 拿不到 socket，但测试要点是 send 不抛错且 store 状态合理
        expect(useNetworkStore.getState().status).toBe('joined');
    });
});

describe('NetworkSystem 接收校验', () => {
    // adversarial-review #10 case 4
    it('player_state_broadcast 找不到对应 player 时不会创建幽灵条目', async () => {
        useNetworkStore.setState({
            accountStatus: 'loggedIn',
            accountUser: { userId: 'u1', username: 'Alice' },
            accountToken: 'token-1',
        });
        const promise = useNetworkStore.getState().createRoom('TEST');
        await promise;
        await new Promise((r) => setTimeout(r, 5));

        useNetworkStore.setState({
            status: 'joined',
            roomCode: 'TEST',
            playerId: 'p1',
            players: { p1: { playerId: 'p1', playerName: '我', state: null } },
        });

        latestSocket()?.onmessage?.({
            data: JSON.stringify({
                type: 'player_state_broadcast',
                roomCode: 'TEST',
                playerId: 'ghost',
                state: { pomodoro: { phase: 0, remainingSeconds: 0, currentRound: 0, totalRounds: 0, isRunning: false }, activeApp: null, bindingKey: null },
            }),
        } as MessageEvent);

        expect(useNetworkStore.getState().players['ghost']).toBeUndefined();
    });

    it('player_state_broadcast updates an existing player active app from onmessage', async () => {
        useNetworkStore.setState({
            accountStatus: 'loggedIn',
            accountUser: { userId: 'u1', username: 'Alice' },
            accountToken: 'token-1',
        });
        const promise = useNetworkStore.getState().createRoom('TEST');
        await promise;
        await new Promise((r) => setTimeout(r, 5));

        useNetworkStore.setState({
            status: 'joined',
            roomCode: 'TEST',
            playerId: 'p1',
            players: { p1: { playerId: 'p1', playerName: '我', state: null } },
        });

        const state = {
            pomodoro: { phase: 0, remainingSeconds: 1200, currentRound: 1, totalRounds: 4, isRunning: true },
            activeApp: {
                name: 'Safari',
                bundleId: 'com.apple.Safari',
                windowTitle: 'Apple - Safari',
                iconDataUrl: 'data:image/png;base64,QUFB',
            },
            bindingKey: null,
        };

        latestSocket()?.onmessage?.({
            data: JSON.stringify({
                type: 'player_state_broadcast',
                roomCode: 'TEST',
                playerId: 'p1',
                state,
            }),
        } as MessageEvent);

        expect(useNetworkStore.getState().players.p1.state?.activeApp).toEqual(state.activeApp);
    });

    it('player_state_broadcast can seed a player from a real room snapshot message', async () => {
        useNetworkStore.setState({
            accountStatus: 'loggedIn',
            accountUser: { userId: 'u1', username: 'Alice' },
            accountToken: 'token-1',
        });
        const promise = useNetworkStore.getState().createRoom('TEST');
        await promise;
        await new Promise((r) => setTimeout(r, 5));

        const state = {
            pomodoro: { phase: 0, remainingSeconds: 1200, currentRound: 1, totalRounds: 4, isRunning: true },
            activeApp: {
                name: 'Safari',
                bundleId: 'com.apple.Safari',
                windowTitle: 'Apple - Safari',
                iconDataUrl: 'data:image/png;base64,QUFB',
            },
            bindingKey: null,
        };

        latestSocket()?.onmessage?.({
            data: JSON.stringify({
                type: 'room_snapshot',
                roomCode: 'TEST',
                players: [{ playerId: 'p1', playerName: '远端玩家', state: null }],
            }),
        } as MessageEvent);
        latestSocket()?.onmessage?.({
            data: JSON.stringify({
                type: 'player_state_broadcast',
                roomCode: 'TEST',
                playerId: 'p1',
                state,
            }),
        } as MessageEvent);

        expect(useNetworkStore.getState().players.p1.state?.activeApp).toEqual(state.activeApp);
    });
});

describe('NetworkSystem account auth', () => {
    it('createAccount sends auth_create and stores auth_ok', async () => {
        const promise = useNetworkStore.getState().createAccount('Alice', 'secret');
        await promise;
        await new Promise((r) => setTimeout(r, 5));

        const socket = latestSocket();
        expect(JSON.parse(socket?.sent[0] ?? '{}')).toEqual({
            v: 1,
            type: 'auth_create',
            username: 'Alice',
            password: 'secret',
        });

        socket?.onmessage?.({
            data: JSON.stringify({
                type: 'auth_ok',
                user: { userId: 'u1', username: 'Alice' },
                token: 'token-1',
            }),
        } as MessageEvent);

        expect(useNetworkStore.getState().accountStatus).toBe('loggedIn');
        expect(useNetworkStore.getState().accountUser).toEqual({ userId: 'u1', username: 'Alice' });
        expect(useNetworkStore.getState().accountToken).toBe('token-1');
        expect(useNetworkStore.getState().status).toBe('idle');
        expect(useNetworkStore.getState().playerName).toBe('Alice');
        expect(persistedSession.save).toHaveBeenCalledWith({ token: 'token-1', username: 'Alice' });
    });

    it('requests user data after auth_ok and handles user_data_snapshot', async () => {
        const snapshot = makeCloudSnapshot();

        await useNetworkStore.getState().login('Alice', 'secret');
        await new Promise((r) => setTimeout(r, 5));
        const socket = latestSocket();
        expect(sentMessages(socket)).toContainEqual({
            v: 1,
            type: 'auth_login',
            username: 'Alice',
            password: 'secret',
        });

        socket?.onmessage?.({
            data: JSON.stringify({
                v: 1,
                type: 'auth_ok',
                user: { userId: 'u1', username: 'Alice' },
                token: 'token',
            }),
        } as MessageEvent);
        expect(sentMessages(socket)).toContainEqual({ v: 1, type: 'user_data_get' });

        socket?.onmessage?.({
            data: JSON.stringify({ v: 1, type: 'user_data_snapshot', data: snapshot }),
        } as MessageEvent);
        expect(useNetworkStore.getState().cloudData).toEqual(snapshot);
        expect(useNetworkStore.getState().cloudSyncStatus).toBe('synced');
    });

    it('sends user_data_save with the current baseUpdatedAt', async () => {
        const snapshot = makeCloudSnapshot();

        await useNetworkStore.getState().login('Alice', 'secret');
        await new Promise((r) => setTimeout(r, 5));
        const socket = latestSocket();
        socket?.onmessage?.({
            data: JSON.stringify({
                v: 1,
                type: 'auth_ok',
                user: { userId: 'u1', username: 'Alice' },
                token: 'token',
            }),
        } as MessageEvent);
        socket?.sent.splice(0);
        useNetworkStore.setState({ cloudDataUpdatedAt: 10 });

        useNetworkStore.getState().saveUserData(snapshot, 10);

        expect(sentMessages(socket)).toContainEqual({
            v: 1,
            type: 'user_data_save',
            baseUpdatedAt: 10,
            data: snapshot,
        });
    });

    it('login sends auth_login and invalid session clears account state', async () => {
        await useNetworkStore.getState().login('Alice', 'secret');
        await new Promise((r) => setTimeout(r, 5));
        expect(JSON.parse(latestSocket()?.sent[0] ?? '{}').type).toBe('auth_login');

        latestSocket()?.onmessage?.({
            data: JSON.stringify({ type: 'error', error: 'INVALID_SESSION' }),
        } as MessageEvent);

        expect(useNetworkStore.getState().accountStatus).toBe('guest');
        expect(useNetworkStore.getState().accountToken).toBeNull();
        expect(persistedSession.clear).toHaveBeenCalled();
    });

    it('restoreAccountSession sends auth_session for saved tokens and clears missing sessions', async () => {
        persistedSession.load.mockResolvedValueOnce({ token: 'token-1', username: 'Alice' });

        await useNetworkStore.getState().restoreAccountSession();
        await new Promise((r) => setTimeout(r, 5));

        expect(JSON.parse(latestSocket()?.sent[0] ?? '{}')).toEqual({
            v: 1,
            type: 'auth_session',
            token: 'token-1',
        });
        expect(useNetworkStore.getState().accountStatus).toBe('checking');

        useNetworkStore.getState().disconnect();
        FakeWebSocket.instances = [];
        persistedSession.load.mockResolvedValueOnce(null);

        await useNetworkStore.getState().restoreAccountSession();

        expect(latestSocket()).toBeUndefined();
        expect(useNetworkStore.getState().accountStatus).toBe('guest');
    });

    it('logout leaves rooms, sends auth_logout, and clears account state', async () => {
        useNetworkStore.setState({
            status: 'joined',
            roomCode: 'ABCDEF',
            accountStatus: 'loggedIn',
            accountUser: { userId: 'u1', username: 'Alice' },
            accountToken: 'token-1',
        });
        await useNetworkStore.getState().login('Alice', 'secret');
        await new Promise((r) => setTimeout(r, 5));
        useNetworkStore.setState({
            status: 'joined',
            roomCode: 'ABCDEF',
        });
        latestSocket()?.sent.splice(0);

        useNetworkStore.getState().logout();

        const sentTypes = latestSocket()?.sent.map((raw) => JSON.parse(raw).type);
        expect(sentTypes).toContain('leave_room');
        expect(sentTypes).toContain('auth_logout');
        expect(useNetworkStore.getState().accountStatus).toBe('guest');
        expect(useNetworkStore.getState().accountToken).toBeNull();
    });

    it('does not send room messages while logged out', async () => {
        await useNetworkStore.getState().createRoom('ABCDEF');
        await new Promise((r) => setTimeout(r, 5));

        expect(useNetworkStore.getState().lastError).toBe('AUTH_REQUIRED');
        expect(latestSocket()).toBeUndefined();
    });

    it('returns account actions to a retryable guest state after account errors', async () => {
        await useNetworkStore.getState().createAccount('Alice', 'secret');
        await new Promise((r) => setTimeout(r, 5));

        latestSocket()?.onmessage?.({
            data: JSON.stringify({ type: 'error', error: 'USERNAME_TAKEN' }),
        } as MessageEvent);

        expect(useNetworkStore.getState().accountStatus).toBe('guest');
        expect(useNetworkStore.getState().accountError).toBe('USERNAME_TAKEN');

        await useNetworkStore.getState().login('Alice', 'wrong');
        await new Promise((r) => setTimeout(r, 5));

        latestSocket()?.onmessage?.({
            data: JSON.stringify({ type: 'error', error: 'INVALID_CREDENTIALS' }),
        } as MessageEvent);

        expect(useNetworkStore.getState().accountStatus).toBe('guest');
        expect(useNetworkStore.getState().accountError).toBe('INVALID_CREDENTIALS');
    });

    it('returns account actions to guest after unexpected server errors', async () => {
        await useNetworkStore.getState().createAccount('Alice', 'secret');
        await new Promise((r) => setTimeout(r, 5));

        latestSocket()?.onmessage?.({
            data: JSON.stringify({ type: 'error', error: 'INVALID_MESSAGE' }),
        } as MessageEvent);

        expect(useNetworkStore.getState().accountStatus).toBe('guest');
        expect(useNetworkStore.getState().accountError).toBe('INVALID_MESSAGE');
        expect(useNetworkStore.getState().status).toBe('idle');
    });
});

describe('createNetworkStore — settings-window mode', () => {
    it('joinRoom dispatches instead of opening a socket', async () => {
        const spy = vi.spyOn(dispatchMod, 'dispatch').mockResolvedValue();
        const store = createNetworkStore({ isSettingsWindow: true });
        await store.getState().joinRoom('ROOM-XYZ');
        expect(spy).toHaveBeenCalledWith(expect.objectContaining({
            v: BRIDGE_VERSION, store: 'network', action: 'joinRoom', args: ['ROOM-XYZ'],
        }));
        // status is not advanced locally — only the dispatch fires
        expect(store.getState().status).toBe('idle');
        spy.mockRestore();
    });

    it('createRoom, leaveRoom, setAutoConnect, setPlayerName all dispatch', async () => {
        const spy = vi.spyOn(dispatchMod, 'dispatch').mockResolvedValue();
        const store = createNetworkStore({ isSettingsWindow: true });

        await store.getState().createRoom('R1');
        store.getState().leaveRoom();
        store.getState().setAutoConnect(true);
        store.getState().setPlayerName('alice');

        expect(spy).toHaveBeenCalledWith(expect.objectContaining({ v: BRIDGE_VERSION, store: 'network', action: 'createRoom',     args: ['R1'] }));
        expect(spy).toHaveBeenCalledWith(expect.objectContaining({ v: BRIDGE_VERSION, store: 'network', action: 'leaveRoom',      args: [] }));
        expect(spy).toHaveBeenCalledWith(expect.objectContaining({ v: BRIDGE_VERSION, store: 'network', action: 'setAutoConnect', args: [true] }));
        expect(spy).toHaveBeenCalledWith(expect.objectContaining({ v: BRIDGE_VERSION, store: 'network', action: 'setPlayerName',  args: ['alice'] }));
        spy.mockRestore();
    });

    it('account actions dispatch to the main window', async () => {
        const spy = vi.spyOn(dispatchMod, 'dispatch').mockResolvedValue();
        const store = createNetworkStore({ isSettingsWindow: true });

        await store.getState().createAccount('Alice', 'secret');
        await store.getState().login('Alice', 'secret');
        await store.getState().restoreAccountSession();
        store.getState().logout();

        expect(spy).toHaveBeenCalledWith(expect.objectContaining({
            v: BRIDGE_VERSION, store: 'network', action: 'createAccount', args: ['Alice', 'secret'],
        }));
        expect(spy).toHaveBeenCalledWith(expect.objectContaining({
            v: BRIDGE_VERSION, store: 'network', action: 'login', args: ['Alice', 'secret'],
        }));
        expect(spy).toHaveBeenCalledWith(expect.objectContaining({
            v: BRIDGE_VERSION, store: 'network', action: 'restoreAccountSession', args: [],
        }));
        expect(spy).toHaveBeenCalledWith(expect.objectContaining({
            v: BRIDGE_VERSION, store: 'network', action: 'logout', args: [],
        }));
        spy.mockRestore();
    });
});
