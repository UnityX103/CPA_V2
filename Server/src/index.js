import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';

import { WebSocketServer } from 'ws';

import { IconCache, IconCacheError } from './IconCache.js';
import {
    RoomManager,
    RoomManagerError
} from './RoomManager.js';
import {
    ProtocolError,
    createErrorMessage,
    createIconBroadcastMessage,
    createIconNeedMessage,
    createPlayerJoinedMessage,
    createPlayerLeftMessage,
    createPlayerStateBroadcastMessage,
    createRoomCreatedMessage,
    createRoomJoinedMessage,
    createRoomSnapshotMessage,
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
            try
            {
                handleMessage({
                    rawMessage,
                    connection,
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
                });
            }
            catch (error)
            {
                handleKnownError(socket, error, logger);
            }
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

function handleMessage(context)
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
