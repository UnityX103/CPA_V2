import { customAlphabet } from 'nanoid';

export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LENGTH = 6;
export const MAX_PLAYERS_PER_ROOM = 8;
export const MAX_PLAYER_NAME_LENGTH = 16;
export const EMPTY_ROOM_TTL_MS = 30_000;
export const PLAYER_STATE_WINDOW_MS = 1_000;
export const MAX_PLAYER_STATE_UPDATES_PER_WINDOW = 10;

const defaultRoomCodeFactory = customAlphabet(ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH);

export class RoomManagerError extends Error
{
    constructor(code, message)
    {
        super(message);
        this.code = code;
    }
}

export class RoomManager
{
    constructor(options = {})
    {
        this._now = options.now ?? (() => Date.now());
        this._scheduleTimeout = options.scheduleTimeout ?? setTimeout;
        this._clearScheduledTimeout = options.clearScheduledTimeout ?? clearTimeout;
        this._roomCodeFactory = options.roomCodeFactory ?? (() => defaultRoomCodeFactory());
        this._rooms = new Map();
    }

    createRoom({ playerId, playerName, ws, roomCode })
    {
        const normalizedName = normalizePlayerName(playerName);
        const desiredCode = normalizeRoomCode(roomCode ?? '');

        let code;
        if (desiredCode.length === ROOM_CODE_LENGTH)
        {
            if (this._rooms.has(desiredCode))
            {
                throw new RoomManagerError('ROOM_CODE_TAKEN', '房间号已被占用');
            }
            code = desiredCode;
        }
        else if (desiredCode.length > 0)
        {
            throw new RoomManagerError('INVALID_ROOM_CODE', `房间号长度必须为 ${ROOM_CODE_LENGTH}`);
        }
        else
        {
            code = this._generateUniqueRoomCode();
        }

        const now = this._now();
        const player = this._createPlayer({
            playerId,
            playerName: normalizedName,
            ws,
            now
        });
        const room = {
            code,
            createdAt: now,
            destroyTimer: null,
            players: new Map([[playerId, player]])
        };

        this._rooms.set(code, room);
        return room;
    }

    joinRoom({ roomCode, playerId, playerName, ws })
    {
        const normalizedRoomCode = normalizeRoomCode(roomCode);
        const normalizedName = normalizePlayerName(playerName);
        const room = this.getRoom(normalizedRoomCode);

        if (!room)
        {
            throw new RoomManagerError('ROOM_NOT_FOUND', '房间不存在');
        }

        if (!room.players.has(playerId) && room.players.size >= MAX_PLAYERS_PER_ROOM)
        {
            throw new RoomManagerError('ROOM_FULL', '房间已满');
        }

        this._cancelDestroyTimer(room);
        room.players.set(playerId, this._createPlayer({
            playerId,
            playerName: normalizedName,
            ws,
            now: this._now()
        }));

        return room;
    }

    leaveRoom({ roomCode, playerId })
    {
        const room = this.getRoom(roomCode);
        if (!room)
        {
            return {
                room: null,
                player: null
            };
        }

        const player = room.players.get(playerId) ?? null;
        if (!player)
        {
            return {
                room,
                player: null
            };
        }

        room.players.delete(playerId);
        if (room.players.size === 0)
        {
            this._scheduleDestroyTimer(room);
        }

        return {
            room,
            player
        };
    }

    updatePlayerState({ roomCode, playerId, state })
    {
        const room = this.getRoom(roomCode);
        if (!room)
        {
            throw new RoomManagerError('ROOM_NOT_FOUND', '房间不存在');
        }

        const player = room.players.get(playerId);
        if (!player)
        {
            throw new RoomManagerError('PLAYER_NOT_FOUND', '玩家不存在');
        }

        const normalizedState = normalizeRemoteState(state);
        const now = this._now();
        const priorityFingerprint = getPriorityFingerprint(normalizedState);

        player.lastSeenAt = now;
        player.latestState = normalizedState;
        player.broadcastWindow = player.broadcastWindow.filter(
            (timestamp) => now - timestamp < PLAYER_STATE_WINDOW_MS
        );

        const shouldBypassRateLimit = player.lastBroadcastFingerprint !== priorityFingerprint;
        const shouldBroadcast = shouldBypassRateLimit
            || player.broadcastWindow.length < MAX_PLAYER_STATE_UPDATES_PER_WINDOW;

        if (shouldBroadcast)
        {
            player.broadcastWindow.push(now);
            player.lastBroadcastFingerprint = priorityFingerprint;
        }

        return {
            room,
            player,
            shouldBroadcast
        };
    }

    touchPlayer({ roomCode, playerId })
    {
        const room = this.getRoom(roomCode);
        const player = room?.players.get(playerId) ?? null;
        if (!player)
        {
            return null;
        }

        player.lastSeenAt = this._now();
        return player;
    }

    getRoom(roomCode)
    {
        return this._rooms.get(normalizeRoomCode(roomCode)) ?? null;
    }

    getRoomSnapshot(roomCode)
    {
        const room = this.getRoom(roomCode);
        if (!room)
        {
            return [];
        }

        return [...room.players.values()].map((player) => ({
            playerId: player.id,
            playerName: player.name,
            state: cloneRemoteState(player.latestState)
        }));
    }

    _createPlayer({ playerId, playerName, ws, now })
    {
        if (!playerId)
        {
            throw new RoomManagerError('INVALID_PLAYER_ID', '玩家标识不能为空');
        }

        return {
            id: playerId,
            name: playerName,
            ws,
            joinedAt: now,
            lastSeenAt: now,
            latestState: null,
            lastBroadcastFingerprint: null,
            broadcastWindow: []
        };
    }

    _generateUniqueRoomCode()
    {
        for (let attempt = 0; attempt < 1_000; attempt += 1)
        {
            const roomCode = normalizeRoomCode(this._roomCodeFactory());
            if (roomCode.length !== ROOM_CODE_LENGTH)
            {
                continue;
            }

            if (!this._rooms.has(roomCode))
            {
                return roomCode;
            }
        }

        throw new RoomManagerError('ROOM_CODE_EXHAUSTED', '房间码生成失败');
    }

    _scheduleDestroyTimer(room)
    {
        if (room.destroyTimer)
        {
            return;
        }

        room.destroyTimer = this._scheduleTimeout(() =>
        {
            const currentRoom = this._rooms.get(room.code);
            if (currentRoom && currentRoom.players.size === 0)
            {
                this._rooms.delete(room.code);
            }
        }, EMPTY_ROOM_TTL_MS);

        if (typeof room.destroyTimer?.unref === 'function')
        {
            room.destroyTimer.unref();
        }
    }

    _cancelDestroyTimer(room)
    {
        if (!room.destroyTimer)
        {
            return;
        }

        this._clearScheduledTimeout(room.destroyTimer);
        room.destroyTimer = null;
    }
}

function normalizePlayerName(playerName)
{
    const normalizedName = typeof playerName === 'string'
        ? playerName.trim()
        : '';

    if (!normalizedName)
    {
        throw new RoomManagerError('INVALID_PLAYER_NAME', '玩家名称不能为空');
    }

    if (Array.from(normalizedName).length > MAX_PLAYER_NAME_LENGTH)
    {
        throw new RoomManagerError('INVALID_PLAYER_NAME', '玩家名称不能超过 16 个字符');
    }

    return normalizedName;
}

function normalizeRoomCode(roomCode)
{
    return typeof roomCode === 'string'
        ? roomCode.trim().toUpperCase()
        : '';
}

function normalizeRemoteState(state)
{
    const pomodoro = state?.pomodoro;
    if (!pomodoro)
    {
        throw new RoomManagerError('INVALID_STATE', '番茄钟状态缺失');
    }

    return {
        pomodoro: {
            phase: normalizeInteger(pomodoro.phase, 'INVALID_STATE'),
            remainingSeconds: normalizeInteger(pomodoro.remainingSeconds, 'INVALID_STATE'),
            currentRound: normalizeInteger(pomodoro.currentRound, 'INVALID_STATE'),
            totalRounds: normalizeInteger(pomodoro.totalRounds, 'INVALID_STATE'),
            isRunning: Boolean(pomodoro.isRunning)
        },
        activeApp: state.activeApp ?? null,
        bindingKey: normalizeBindingKey(state.bindingKey)
    };
}

// 见 protocol.js 同名函数：白名单 keyLabel + pressCount，null 透传，pressCount 钳到 [0, +∞)。
// 这里和 protocol.js 同步保留两份是因为 RoomManager 是房间唯一可信源，
// 自己也要执行一遍 normalize 防止旁路注入（其他业务模块直接调 RoomManager API 时）。
function normalizeBindingKey(bindingKey)
{
    if (bindingKey == null || typeof bindingKey !== 'object')
    {
        return null;
    }
    const keyLabel = typeof bindingKey.keyLabel === 'string' ? bindingKey.keyLabel : '';
    const rawCount = Number.isInteger(bindingKey.pressCount) ? bindingKey.pressCount : 0;
    const pressCount = Math.max(0, rawCount);
    return { keyLabel, pressCount };
}

function normalizeInteger(value, code)
{
    if (!Number.isInteger(value))
    {
        throw new RoomManagerError(code, '状态字段必须为整数');
    }

    return value;
}

function cloneRemoteState(state)
{
    if (!state)
    {
        return null;
    }

    return {
        pomodoro: {
            ...state.pomodoro
        },
        activeApp: state.activeApp == null
            ? null
            : { ...state.activeApp },
        bindingKey: state.bindingKey == null
            ? null
            : { ...state.bindingKey }
    };
}

function getPriorityFingerprint(state)
{
    const phase = state?.pomodoro?.phase ?? 'null';
    const isRunning = state?.pomodoro?.isRunning ?? false;
    return `${phase}:${isRunning ? '1' : '0'}`;
}
