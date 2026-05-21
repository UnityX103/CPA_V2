import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';

import { WebSocketServer } from 'ws';

import { AuthStore, AuthStoreError } from './AuthStore.js';
import { IconCache, IconCacheError } from './IconCache.js';
import {
    RoomManager,
    RoomManagerError
} from './RoomManager.js';
import { UserDataStore, UserDataStoreError } from './UserDataStore.js';
import {
    ProtocolError,
    createAuthLoggedOutMessage,
    createAuthOkMessage,
    createErrorMessage,
    createIconBroadcastMessage,
    createIconNeedMessage,
    createPlayerJoinedMessage,
    createPlayerLeftMessage,
    createPlayerStateBroadcastMessage,
    createRoomCreatedMessage,
    createRoomJoinedMessage,
    createRoomSnapshotMessage,
    createUserDataSavedMessage,
    createUserDataSnapshotMessage,
    encodeMessage,
    parseClientMessage
} from './protocol.js';

const DEFAULT_PORT = Number.parseInt(process.env.PORT ?? '8039', 10);
const DEFAULT_INIT_TIMEOUT_MS = 10_000;
const DEFAULT_HEARTBEAT_INTERVAL_MS = 10_000;
const DEFAULT_HEARTBEAT_TIMEOUT_MS = 30_000;
// 单条 WebSocket 消息最大字节数；icon_upload 走的是 base64 + 1MiB 上限，留 2MiB 以兜底协议头
// adversarial-review #1
const DEFAULT_MAX_PAYLOAD_BYTES = 2 * 1024 * 1024;

let isProcessGuardInstalled = false;

export async function createPomodoroServer(options = {})
{
    const port = options.port ?? DEFAULT_PORT;
    const initTimeoutMs = options.initTimeoutMs ?? DEFAULT_INIT_TIMEOUT_MS;
    const heartbeatIntervalMs = options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS;
    const heartbeatTimeoutMs = options.heartbeatTimeoutMs ?? DEFAULT_HEARTBEAT_TIMEOUT_MS;
    const logger = options.logger ?? console;
    const roomManager = options.roomManager ?? new RoomManager();
    const authStore = options.authStore ?? new AuthStore({
        filePath: options.authFilePath
    });
    const userDataStore = options.userDataStore ?? new UserDataStore({
        filePath: options.userDataFilePath
    });
    const iconCache = options.iconCache ?? new IconCache({
        maxEntries: options.iconCacheMaxEntries ?? 100,
        maxBase64Bytes: options.iconCacheMaxBase64Bytes ?? 1_048_576
    });
    const connections = new Map();
    const maxPayload = options.maxPayloadBytes ?? DEFAULT_MAX_PAYLOAD_BYTES;
    const webSocketServer = new WebSocketServer({
        port,
        maxPayload
    });

    installProcessGuards(logger);

    webSocketServer.on('connection', (socket) =>
    {
        const connection = {
            socket,
            roomCode: null,
            playerId: null,
            playerName: null,
            userId: null,
            username: null,
            authToken: null,
            lastSeenAt: Date.now(),
            initTimerId: setTimeout(() =>
            {
                safeSend(socket, createErrorMessage('INIT_TIMEOUT'));
                socket.close();
            }, initTimeoutMs)
        };

        connections.set(socket, connection);

        socket.on('message', (rawMessage) =>
        {
            void handleMessage({
                    rawMessage,
                    connection,
                    authStore,
                    userDataStore,
                    roomManager,
                    iconCache,
                    logger,
                    clearInitTimeout: () => clearConnectionInitTimeout(connection),
                    broadcastToRoom: (roomCode, message, excludedPlayerId) =>
                    {
                        broadcastToRoom({
                            roomCode,
                            message,
                            excludedPlayerId,
                            roomManager
                        });
                    }
                })
                .catch((error) =>
                {
                    handleKnownError(socket, error, logger);
                });
        });

        socket.on('pong', () =>
        {
            connection.lastSeenAt = Date.now();
            touchPlayer(connection, roomManager);
        });

        socket.on('close', () =>
        {
            clearConnectionInitTimeout(connection);
            connections.delete(socket);
            leaveCurrentRoom({
                connection,
                roomManager,
                notifyOthers: true
            });
        });

        socket.on('error', (error) =>
        {
            logger.warn?.('[Server] WebSocket error:', error);
        });
    });

    const heartbeatTimer = setInterval(() =>
    {
        const now = Date.now();
        for (const connection of connections.values())
        {
            if (now - connection.lastSeenAt > heartbeatTimeoutMs)
            {
                connection.socket.terminate();
                continue;
            }

            if (connection.socket.readyState === 1)
            {
                connection.socket.ping();
            }
        }
    }, heartbeatIntervalMs);

    await waitForListening(webSocketServer);

    const address = webSocketServer.address();
    const actualPort = typeof address === 'object' && address
        ? address.port
        : port;

    return {
        port: actualPort,
        roomManager,
        iconCache,
        server: webSocketServer,
        url: `ws://127.0.0.1:${actualPort}`,
        async close()
        {
            clearInterval(heartbeatTimer);

            for (const connection of connections.values())
            {
                clearConnectionInitTimeout(connection);
                connection.socket.terminate();
            }

            await new Promise((resolve, reject) =>
            {
                webSocketServer.close((error) =>
                {
                    if (error)
                    {
                        reject(error);
                        return;
                    }

                    resolve();
                });
            });
        }
    };
}

function clearConnectionInitTimeout(connection)
{
    if (!connection.initTimerId)
    {
        return;
    }

    clearTimeout(connection.initTimerId);
    connection.initTimerId = null;
}

async function handleMessage(context)
{
    const rawText = Buffer.isBuffer(context.rawMessage)
        ? context.rawMessage.toString('utf8')
        : String(context.rawMessage);
    const message = parseClientMessage(rawText);
    const connection = context.connection;

    connection.lastSeenAt = Date.now();
    touchPlayer(connection, context.roomManager);

    switch (message.type)
    {
        case 'auth_create':
            await handleAuthCreate(message, context);
            return;

        case 'auth_login':
            await handleAuthLogin(message, context);
            return;

        case 'auth_session':
            await handleAuthSession(message, context);
            return;

        case 'auth_logout':
            await handleAuthLogout(message, context);
            return;

        case 'user_data_get':
            await handleUserDataGet(context);
            return;

        case 'user_data_save':
            await handleUserDataSave(message, context);
            return;

        case 'create_room':
            handleCreateRoom(message, context);
            return;

        case 'join_room':
            handleJoinRoom(message, context);
            return;

        case 'leave_room':
            handleLeaveRoom(context);
            return;

        case 'player_state_update':
            handlePlayerStateUpdate(message, context);
            return;

        case 'icon_upload':
            handleIconUpload(message, context);
            return;

        case 'icon_request':
            handleIconRequest(message, context);
            return;

        case 'ping':
        case 'pong':
            return;

        default:
            throw new ProtocolError('UNSUPPORTED_MESSAGE', '不支持的消息类型');
    }
}

function handleCreateRoom(message, context)
{
    ensureAuthenticated(context.connection);
    ensureConnectionNotInRoom(context.connection);

    const playerId = randomUUID();
    const room = context.roomManager.createRoom({
        playerId,
        playerName: message.playerName,
        ws: context.connection.socket,
        roomCode: message.roomCode
    });

    context.connection.roomCode = room.code;
    context.connection.playerId = playerId;
    context.connection.playerName = message.playerName;
    context.clearInitTimeout();

    safeSend(context.connection.socket, createRoomCreatedMessage({
        roomCode: room.code,
        playerId
    }));
    safeSend(context.connection.socket, createRoomSnapshotMessage({
        roomCode: room.code,
        players: context.roomManager.getRoomSnapshot(room.code)
    }));
}

function handleJoinRoom(message, context)
{
    ensureAuthenticated(context.connection);
    ensureConnectionNotInRoom(context.connection);

    const playerId = randomUUID();
    const room = context.roomManager.joinRoom({
        roomCode: message.roomCode,
        playerId,
        playerName: message.playerName,
        ws: context.connection.socket
    });

    context.connection.roomCode = room.code;
    context.connection.playerId = playerId;
    context.connection.playerName = message.playerName;
    context.clearInitTimeout();

    safeSend(context.connection.socket, createRoomJoinedMessage({
        roomCode: room.code,
        playerId
    }));
    safeSend(context.connection.socket, createRoomSnapshotMessage({
        roomCode: room.code,
        players: context.roomManager.getRoomSnapshot(room.code)
    }));

    context.broadcastToRoom(
        room.code,
        createPlayerJoinedMessage({
            roomCode: room.code,
            player: {
                playerId,
                playerName: message.playerName,
                state: null
            }
        }),
        playerId
    );
}

async function handleAuthCreate(message, context)
{
    const result = await context.authStore.createAccount({
        username: message.username,
        password: message.password
    });
    sendAuthOk(context, result);
}

async function handleAuthLogin(message, context)
{
    const result = await context.authStore.login({
        username: message.username,
        password: message.password
    });
    sendAuthOk(context, result);
}

async function handleAuthSession(message, context)
{
    const result = await context.authStore.restoreSession({
        token: message.token
    });
    sendAuthOk(context, result);
}

async function handleAuthLogout(message, context)
{
    await context.authStore.logout({
        token: message.token
    });
    leaveCurrentRoom({
        connection: context.connection,
        roomManager: context.roomManager,
        notifyOthers: true
    });
    context.connection.userId = null;
    context.connection.username = null;
    context.connection.authToken = null;
    safeSend(context.connection.socket, createAuthLoggedOutMessage());
}

function sendAuthOk(context, result)
{
    context.connection.userId = result.user.userId;
    context.connection.username = result.user.username;
    context.connection.authToken = result.token;
    context.clearInitTimeout();
    safeSend(context.connection.socket, createAuthOkMessage(result));
}

async function handleUserDataGet(context)
{
    ensureAuthenticated(context.connection);
    const data = await context.userDataStore.getUserData(context.connection.userId);
    safeSend(context.connection.socket, createUserDataSnapshotMessage({ data }));
}

async function handleUserDataSave(message, context)
{
    ensureAuthenticated(context.connection);
    const saved = await context.userDataStore.saveUserData({
        userId: context.connection.userId,
        data: message.data,
        baseUpdatedAt: message.baseUpdatedAt
    });
    safeSend(context.connection.socket, createUserDataSavedMessage({
        updatedAt: saved.updatedAt
    }));
}

function handleLeaveRoom(context)
{
    leaveCurrentRoom({
        connection: context.connection,
        roomManager: context.roomManager,
        notifyOthers: true
    });
}

function handlePlayerStateUpdate(message, context)
{
    if (!context.connection.roomCode || !context.connection.playerId)
    {
        throw new ProtocolError('NOT_IN_ROOM', '当前未加入房间');
    }

    const result = context.roomManager.updatePlayerState({
        roomCode: context.connection.roomCode,
        playerId: context.connection.playerId,
        state: message.state
    });

    if (!result.shouldBroadcast)
    {
        return;
    }

    context.broadcastToRoom(
        context.connection.roomCode,
        createPlayerStateBroadcastMessage({
            roomCode: context.connection.roomCode,
            playerId: context.connection.playerId,
            state: result.player.latestState
        }),
        context.connection.playerId
    );

    const bundleId = result.player.latestState?.activeApp?.bundleId;
    if (bundleId && !context.iconCache.has(bundleId))
    {
        safeSend(context.connection.socket, createIconNeedMessage({ bundleId }));
    }
}

function handleIconUpload(message, context)
{
    if (!context.connection.roomCode || !context.connection.playerId)
    {
        throw new ProtocolError('NOT_IN_ROOM', '当前未加入房间');
    }

    try
    {
        context.iconCache.set(message.bundleId, message.iconBase64);
    }
    catch (error)
    {
        if (error instanceof IconCacheError)
        {
            safeSend(context.connection.socket, createErrorMessage(error.code));
            return;
        }
        throw error;
    }

    context.broadcastToRoom(
        context.connection.roomCode,
        createIconBroadcastMessage({
            bundleId: message.bundleId,
            iconBase64: message.iconBase64
        }),
        null     // 不排除发送者 —— 本地也要有图
    );
}

function handleIconRequest(message, context)
{
    for (const bundleId of message.bundleIds)
    {
        const iconBase64 = context.iconCache.get(bundleId);
        if (!iconBase64) continue;
        safeSend(
            context.connection.socket,
            createIconBroadcastMessage({ bundleId, iconBase64 })
        );
    }
}

function leaveCurrentRoom({ connection, roomManager, notifyOthers })
{
    if (!connection.roomCode || !connection.playerId)
    {
        return;
    }

    const roomCode = connection.roomCode;
    const playerId = connection.playerId;
    const result = roomManager.leaveRoom({
        roomCode,
        playerId
    });

    connection.roomCode = null;
    connection.playerId = null;
    connection.playerName = null;

    if (!notifyOthers || !result.player)
    {
        return;
    }

    broadcastToRoom({
        roomCode,
        message: createPlayerLeftMessage({
            roomCode,
            playerId
        }),
        excludedPlayerId: playerId,
        roomManager
    });
}

function broadcastToRoom({ roomCode, message, excludedPlayerId, roomManager })
{
    const room = roomManager.getRoom(roomCode);
    if (!room)
    {
        return;
    }

    for (const player of room.players.values())
    {
        if (player.id === excludedPlayerId)
        {
            continue;
        }

        safeSend(player.ws, message);
    }
}

function touchPlayer(connection, roomManager)
{
    if (!connection.roomCode || !connection.playerId)
    {
        return;
    }

    roomManager.touchPlayer({
        roomCode: connection.roomCode,
        playerId: connection.playerId
    });
}

function safeSend(socket, message)
{
    if (socket.readyState !== 1)
    {
        return;
    }

    socket.send(encodeMessage(message));
}

function handleKnownError(socket, error, logger)
{
    logger.warn?.('[Server] Request failed:', error);
    if (error instanceof AuthStoreError)
    {
        safeSend(socket, createErrorMessage(error.code));
        return;
    }
    if (error instanceof UserDataStoreError)
    {
        safeSend(socket, createErrorMessage(error.code));
        return;
    }
    safeSend(socket, createErrorMessage(error));

    if (error instanceof ProtocolError && error.code === 'INVALID_VERSION')
    {
        socket.close();
    }
}

function ensureConnectionNotInRoom(connection)
{
    if (connection.roomCode || connection.playerId)
    {
        throw new ProtocolError('ALREADY_IN_ROOM', '连接已在房间中');
    }
}

function ensureAuthenticated(connection)
{
    if (!connection.userId)
    {
        throw new ProtocolError('AUTH_REQUIRED', '请先登录');
    }
}

async function waitForListening(server)
{
    if (server.address())
    {
        return;
    }

    await new Promise((resolve, reject) =>
    {
        server.once('listening', resolve);
        server.once('error', reject);
    });
}

function installProcessGuards(logger)
{
    if (isProcessGuardInstalled)
    {
        return;
    }

    isProcessGuardInstalled = true;

    process.on('uncaughtException', (error) =>
    {
        logger.error?.('[Server] uncaughtException:', error);
    });
    process.on('unhandledRejection', (reason) =>
    {
        logger.error?.('[Server] unhandledRejection:', reason);
    });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
{
    createPomodoroServer({
        port: DEFAULT_PORT
    })
        .then((app) =>
        {
            console.log(`[Server] listening on ${app.url}`);
        })
        .catch((error) =>
        {
            console.error('[Server] startup failed:', error);
            process.exitCode = 1;
        });
}
