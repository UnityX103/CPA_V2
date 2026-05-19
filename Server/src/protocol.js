import { RoomManagerError } from './RoomManager.js';

export const PROTOCOL_VERSION = 1;

const SUPPORTED_CLIENT_MESSAGE_TYPES = new Set([
    'create_room',
    'join_room',
    'leave_room',
    'player_state_update',
    'sync_state',
    'icon_upload',
    'icon_request',
    'ping',
    'pong'
]);

export class ProtocolError extends Error
{
    constructor(code, message)
    {
        super(message);
        this.code = code;
    }
}

export function parseClientMessage(rawMessage)
{
    let parsedMessage;

    try
    {
        parsedMessage = JSON.parse(rawMessage);
    }
    catch (error)
    {
        throw new ProtocolError('INVALID_JSON', '消息不是合法 JSON');
    }

    if (!parsedMessage || typeof parsedMessage !== 'object')
    {
        throw new ProtocolError('INVALID_MESSAGE', '消息体必须是对象');
    }

    if (parsedMessage.v !== PROTOCOL_VERSION)
    {
        throw new ProtocolError('INVALID_VERSION', '协议版本不匹配');
    }

    if (!SUPPORTED_CLIENT_MESSAGE_TYPES.has(parsedMessage.type))
    {
        throw new ProtocolError('UNSUPPORTED_MESSAGE', '不支持的消息类型');
    }

    switch (parsedMessage.type)
    {
        case 'create_room':
            return {
                v: PROTOCOL_VERSION,
                type: 'create_room',
                playerName: normalizePlayerName(parsedMessage.playerName),
                roomCode: normalizeOptionalRoomCode(parsedMessage.roomCode ?? parsedMessage.code)
            };

        case 'join_room':
            return {
                v: PROTOCOL_VERSION,
                type: 'join_room',
                roomCode: normalizeRequiredRoomCode(parsedMessage.roomCode ?? parsedMessage.code),
                playerName: normalizePlayerName(parsedMessage.playerName)
            };

        case 'leave_room':
            return {
                v: PROTOCOL_VERSION,
                type: 'leave_room'
            };

        case 'sync_state':
        case 'player_state_update':
            return {
                v: PROTOCOL_VERSION,
                type: 'player_state_update',
                roomCode: normalizeOptionalRoomCode(parsedMessage.roomCode ?? parsedMessage.code),
                state: normalizeRemoteState(parsedMessage.state ?? parsedMessage.data)
            };

        case 'icon_upload':
            return {
                v: PROTOCOL_VERSION,
                type: 'icon_upload',
                bundleId: normalizeBundleId(parsedMessage.bundleId),
                iconBase64: normalizeIconBase64(parsedMessage.iconBase64)
            };

        case 'icon_request':
            return {
                v: PROTOCOL_VERSION,
                type: 'icon_request',
                bundleIds: normalizeBundleIdArray(parsedMessage.bundleIds)
            };

        case 'ping':
            return {
                v: PROTOCOL_VERSION,
                type: 'ping'
            };

        case 'pong':
            return {
                v: PROTOCOL_VERSION,
                type: 'pong'
            };

        default:
            throw new ProtocolError('UNSUPPORTED_MESSAGE', '不支持的消息类型');
    }
}

export function encodeMessage(message)
{
    return JSON.stringify({
        v: PROTOCOL_VERSION,
        ...stripUndefinedFields(message)
    });
}

export function createRoomCreatedMessage({ roomCode, playerId })
{
    return {
        type: 'room_created',
        roomCode,
        playerId
    };
}

export function createRoomJoinedMessage({ roomCode, playerId })
{
    return {
        type: 'room_joined',
        roomCode,
        playerId
    };
}

export function createRoomSnapshotMessage({ roomCode, players })
{
    return {
        type: 'room_snapshot',
        roomCode,
        players: normalizePlayers(players)
    };
}

export function createPlayerJoinedMessage({ roomCode, player })
{
    return {
        type: 'player_joined',
        roomCode,
        players: normalizePlayers([player])
    };
}

export function createPlayerLeftMessage({ roomCode, playerId })
{
    return {
        type: 'player_left',
        roomCode,
        playerId
    };
}

export function createPlayerStateBroadcastMessage({ roomCode, playerId, state })
{
    return {
        type: 'player_state_broadcast',
        roomCode,
        playerId,
        state: normalizeRemoteState(state)
    };
}

export function createErrorMessage(error)
{
    return {
        type: 'error',
        error: normalizeErrorCode(error)
    };
}

export function createIconNeedMessage({ bundleId })
{
    return { type: 'icon_need', bundleId };
}

export function createIconBroadcastMessage({ bundleId, iconBase64 })
{
    return { type: 'icon_broadcast', bundleId, iconBase64 };
}

function normalizePlayerName(playerName)
{
    if (typeof playerName !== 'string' || !playerName.trim())
    {
        throw new ProtocolError('INVALID_MESSAGE', 'playerName 不能为空');
    }

    return playerName.trim();
}

function normalizeRequiredRoomCode(roomCode)
{
    const normalizedRoomCode = normalizeOptionalRoomCode(roomCode);
    if (!normalizedRoomCode)
    {
        throw new ProtocolError('INVALID_MESSAGE', 'roomCode 不能为空');
    }

    return normalizedRoomCode;
}

function normalizeOptionalRoomCode(roomCode)
{
    return typeof roomCode === 'string'
        ? roomCode.trim().toUpperCase()
        : '';
}

// 字符串字段最大字节数：防止恶意客户端用超长 name/bundleId/keyLabel 污染对端 UI / 内存
// adversarial-review #1
const MAX_STRING_FIELD_BYTES = 256;
const MAX_PRESS_COUNT = 1_000_000_000;
// icon_request 单次最多查询的 bundleId 数：防止恶意客户端用超长数组触发 per-item 循环
// 与拉爆 IconCache 查询；macOS 上活跃 App 数远小于此值。adversarial-review codex follow-up
const MAX_BUNDLE_IDS_PER_REQUEST = 100;

function normalizeRemoteState(state)
{
    try
    {
        return {
            pomodoro: {
                phase: normalizeInteger(state?.pomodoro?.phase),
                remainingSeconds: normalizeInteger(state?.pomodoro?.remainingSeconds),
                currentRound: normalizeInteger(state?.pomodoro?.currentRound),
                totalRounds: normalizeInteger(state?.pomodoro?.totalRounds),
                isRunning: Boolean(state?.pomodoro?.isRunning)
            },
            activeApp: normalizeActiveApp(state?.activeApp),
            bindingKey: normalizeBindingKey(state?.bindingKey)
        };
    }
    catch (error)
    {
        throw new ProtocolError('INVALID_MESSAGE', 'state 字段不合法');
    }
}

function normalizeActiveApp(activeApp)
{
    if (activeApp == null || typeof activeApp !== 'object')
    {
        return null;
    }
    const name = clampString(activeApp.name);
    const bundleId = clampString(activeApp.bundleId);
    const iconId = activeApp.iconId == null ? undefined : clampString(activeApp.iconId);
    if (!name && !bundleId)
    {
        return null;
    }
    return iconId ? { name, bundleId, iconId } : { name, bundleId };
}

function clampString(value)
{
    if (typeof value !== 'string')
    {
        return '';
    }
    if (value.length > MAX_STRING_FIELD_BYTES)
    {
        return value.slice(0, MAX_STRING_FIELD_BYTES);
    }
    return value;
}

// 远端按键同步：bindingKey 为 null/undefined → 透传 null，让接收端隐藏 KeyCounterPill；
// 非 null 时只取 { keyLabel, pressCount } 两个白名单字段，避免转发未受控字段或类型不匹配。
// pressCount 钳到 [0, +∞)：客户端 bug 发负值不该污染对端 UI 的 tooltip / 累加逻辑。
function normalizeBindingKey(bindingKey)
{
    if (bindingKey == null || typeof bindingKey !== 'object')
    {
        return null;
    }
    const keyLabel = clampString(bindingKey.keyLabel);
    const rawCount = Number.isInteger(bindingKey.pressCount) ? bindingKey.pressCount : 0;
    // 钳到 [0, MAX_PRESS_COUNT]：负值客户端 bug 不污染对端；上限避免对端格式化时出现 1e21 这种文本
    const pressCount = Math.max(0, Math.min(MAX_PRESS_COUNT, rawCount));
    return { keyLabel, pressCount };
}

function normalizePlayers(players)
{
    if (!Array.isArray(players))
    {
        throw new ProtocolError('INVALID_MESSAGE', 'players 必须是数组');
    }

    return players.map((player) => ({
        playerId: player.playerId,
        playerName: player.playerName,
        state: player.state == null ? null : normalizeRemoteState(player.state)
    }));
}

function normalizeInteger(value)
{
    if (!Number.isInteger(value))
    {
        throw new Error('整数校验失败');
    }

    return value;
}

function normalizeErrorCode(error)
{
    if (typeof error === 'string' && error)
    {
        return error;
    }

    if (error instanceof ProtocolError || error instanceof RoomManagerError)
    {
        return error.code;
    }

    return 'INTERNAL_ERROR';
}

function stripUndefinedFields(message)
{
    return Object.fromEntries(
        Object.entries(message).filter(([, value]) => value !== undefined)
    );
}

function normalizeBundleId(bundleId)
{
    if (typeof bundleId !== 'string' || !bundleId.trim())
    {
        throw new ProtocolError('INVALID_MESSAGE', 'bundleId 不能为空');
    }
    const trimmed = bundleId.trim();
    // bundleId 是 IconCache 的 Map key；若不在此处拒掉超长字符串，攻击者可在 100 项 LRU
    // 装填前把每条 key 撑到 frame 上限（接近 2MiB），驻留数百 MB。
    if (trimmed.length > MAX_STRING_FIELD_BYTES)
    {
        throw new ProtocolError('INVALID_MESSAGE', `bundleId 长度超过上限 ${MAX_STRING_FIELD_BYTES}`);
    }
    return trimmed;
}

function normalizeIconBase64(iconBase64)
{
    if (typeof iconBase64 !== 'string' || !iconBase64.trim())
    {
        throw new ProtocolError('INVALID_MESSAGE', 'iconBase64 不能为空');
    }
    return iconBase64;
}

function normalizeBundleIdArray(bundleIds)
{
    if (!Array.isArray(bundleIds) || bundleIds.length === 0)
    {
        throw new ProtocolError('INVALID_MESSAGE', 'bundleIds 必须是非空数组');
    }
    if (bundleIds.length > MAX_BUNDLE_IDS_PER_REQUEST)
    {
        throw new ProtocolError(
            'INVALID_MESSAGE',
            `bundleIds 数量超过上限 ${MAX_BUNDLE_IDS_PER_REQUEST}`
        );
    }
    // 去重：客户端可能在并发场景下把同一 bundleId 入两次，没必要让 IconCache 查两遍
    const seen = new Set();
    const result = [];
    for (const id of bundleIds)
    {
        const normalized = normalizeBundleId(id);
        if (!seen.has(normalized))
        {
            seen.add(normalized);
            result.push(normalized);
        }
    }
    return result;
}
