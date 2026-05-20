import assert from 'node:assert/strict';
import test from 'node:test';

import {
    PROTOCOL_VERSION,
    ProtocolError,
    createPlayerJoinedMessage,
    createRoomSnapshotMessage,
    encodeMessage,
    parseClientMessage
} from '../src/protocol.js';

test('encodeMessage 会为服务端消息自动补齐协议版本字段', () =>
{
    const encoded = encodeMessage(createRoomSnapshotMessage({
        roomCode: 'ABCDEF',
        players: [
            {
                playerId: 'player-1',
                playerName: '主机',
                state: null
            }
        ]
    }));
    const parsed = JSON.parse(encoded);

    assert.equal(parsed.v, PROTOCOL_VERSION);
    assert.equal(parsed.type, 'room_snapshot');
    assert.equal(parsed.roomCode, 'ABCDEF');
    assert.deepEqual(parsed.players, [
        {
            playerId: 'player-1',
            playerName: '主机',
            state: null
        }
    ]);
});

test('parseClientMessage 会把旧版 sync_state 兼容为 player_state_update', () =>
{
    const message = parseClientMessage(JSON.stringify({
        v: PROTOCOL_VERSION,
        type: 'sync_state',
        roomCode: 'ABCDEF',
        data: {
            pomodoro: {
                phase: 0,
                remainingSeconds: 1200,
                currentRound: 1,
                totalRounds: 4,
                isRunning: false
            },
            activeApp: null
        }
    }));

    assert.equal(message.type, 'player_state_update');
    assert.equal(message.roomCode, 'ABCDEF');
    assert.equal(message.state.pomodoro.remainingSeconds, 1200);
});

test('parseClientMessage 在协议版本不匹配时抛出 INVALID_VERSION', () =>
{
    assert.throws(
        () => parseClientMessage(JSON.stringify({
            v: PROTOCOL_VERSION + 1,
            type: 'create_room',
            playerName: '版本错误'
        })),
        (error) => error instanceof ProtocolError && error.code === 'INVALID_VERSION'
    );
});

test('parseClientMessage 在 player_state_update 中保留 bindingKey 字段（远端按键同步必需）', () =>
{
    const message = parseClientMessage(JSON.stringify({
        v: PROTOCOL_VERSION,
        type: 'player_state_update',
        state: {
            pomodoro: { phase: 0, remainingSeconds: 1500, currentRound: 1, totalRounds: 4, isRunning: true },
            activeApp: null,
            bindingKey: { keyLabel: 'Space', pressCount: 47 }
        }
    }));

    // 历史 bug：normalizeRemoteState 没把 bindingKey 复制到归一化结果，导致 broadcast 出口字段丢失。
    assert.deepEqual(message.state.bindingKey, { keyLabel: 'Space', pressCount: 47 });
});

test('parseClientMessage 在 bindingKey=null 时 normalizeRemoteState 显式产出 null（区别于"字段缺失"）', () =>
{
    const message = parseClientMessage(JSON.stringify({
        v: PROTOCOL_VERSION,
        type: 'player_state_update',
        state: {
            pomodoro: { phase: 0, remainingSeconds: 1500, currentRound: 1, totalRounds: 4, isRunning: true },
            activeApp: null,
            bindingKey: null
        }
    }));

    assert.equal(Object.prototype.hasOwnProperty.call(message.state, 'bindingKey'), true);
    assert.equal(message.state.bindingKey, null);
});

test('parseClientMessage 把 bindingKey.pressCount 钳到 0 以上（防止客户端 bug 发负值）', () =>
{
    const message = parseClientMessage(JSON.stringify({
        v: PROTOCOL_VERSION,
        type: 'player_state_update',
        state: {
            pomodoro: { phase: 0, remainingSeconds: 1500, currentRound: 1, totalRounds: 4, isRunning: true },
            activeApp: null,
            bindingKey: { keyLabel: 'Space', pressCount: -5 }
        }
    }));

    assert.equal(message.state.bindingKey.pressCount, 0);
});

test('parseClientMessage 兼容旧客户端：state 中不带 bindingKey 字段时返回 null', () =>
{
    // 老版本客户端发的 player_state_update 没有 bindingKey 字段；新服务端必须当成 null 透传，
    // 而不是抛 INVALID_MESSAGE，否则升级期老客户端会被直接挤掉。
    const message = parseClientMessage(JSON.stringify({
        v: PROTOCOL_VERSION,
        type: 'player_state_update',
        state: {
            pomodoro: { phase: 0, remainingSeconds: 1500, currentRound: 1, totalRounds: 4, isRunning: true },
            activeApp: null
        }
    }));

    assert.equal(Object.prototype.hasOwnProperty.call(message.state, 'bindingKey'), true);
    assert.equal(message.state.bindingKey, null);
});

test('parseClientMessage 会过滤 bindingKey 中不在白名单内的字段', () =>
{
    const message = parseClientMessage(JSON.stringify({
        v: PROTOCOL_VERSION,
        type: 'player_state_update',
        state: {
            pomodoro: { phase: 0, remainingSeconds: 1500, currentRound: 1, totalRounds: 4, isRunning: true },
            activeApp: null,
            bindingKey: { keyLabel: 'F', pressCount: 3, evilExtra: 'should-be-stripped', __proto__: { x: 1 } }
        }
    }));

    // 防止旁路注入：只保留 keyLabel + pressCount。
    assert.deepEqual(message.state.bindingKey, { keyLabel: 'F', pressCount: 3 });
});

test('parseClientMessage preserves active app window title and icon data', () =>
{
    const message = parseClientMessage(JSON.stringify({
        v: PROTOCOL_VERSION,
        type: 'player_state_update',
        state: {
            pomodoro: { phase: 0, remainingSeconds: 1500, currentRound: 1, totalRounds: 4, isRunning: true },
            activeApp: {
                name: 'Visual Studio Code',
                bundleId: 'com.microsoft.VSCode',
                windowTitle: 'network.ts - CPA_V2',
                iconDataUrl: 'data:image/png;base64,QUFB',
                iconId: 'com.microsoft.VSCode:cached',
                evilExtra: 'strip-me'
            },
            bindingKey: null
        }
    }));

    assert.deepEqual(message.state.activeApp, {
        name: 'Visual Studio Code',
        bundleId: 'com.microsoft.VSCode',
        windowTitle: 'network.ts - CPA_V2',
        iconDataUrl: 'data:image/png;base64,QUFB',
        iconId: 'com.microsoft.VSCode:cached'
    });
});

test('parseClientMessage preserves 300-char active app icon data while clamping long title', () =>
{
    const long = 'x'.repeat(300);
    const message = parseClientMessage(JSON.stringify({
        v: PROTOCOL_VERSION,
        type: 'player_state_update',
        state: {
            pomodoro: { phase: 0, remainingSeconds: 1500, currentRound: 1, totalRounds: 4, isRunning: true },
            activeApp: {
                name: 'App',
                bundleId: 'com.example.App',
                windowTitle: long,
                iconDataUrl: long
            },
            bindingKey: null
        }
    }));

    assert.equal(message.state.activeApp.windowTitle.length, 256);
    assert.equal(message.state.activeApp.iconDataUrl, long);
});

test('parseClientMessage clamps oversized active app icon data to the icon cache limit', () =>
{
    const oversizedIconDataUrl = 'x'.repeat(1_048_577);
    const message = parseClientMessage(JSON.stringify({
        v: PROTOCOL_VERSION,
        type: 'player_state_update',
        state: {
            pomodoro: { phase: 0, remainingSeconds: 1500, currentRound: 1, totalRounds: 4, isRunning: true },
            activeApp: {
                name: 'App',
                bundleId: 'com.example.App',
                windowTitle: 'short title',
                iconDataUrl: oversizedIconDataUrl,
                evilExtra: 'strip-me'
            },
            bindingKey: null
        }
    }));

    assert.equal(message.state.activeApp.iconDataUrl.length, 1_048_576);
    assert.equal(message.state.activeApp.windowTitle, 'short title');
    assert.equal(Object.hasOwn(message.state.activeApp, 'evilExtra'), false);
});

test('player_joined 使用 players 数组携带远端玩家资料，避免新增字段', () =>
{
    const encoded = encodeMessage(createPlayerJoinedMessage({
        roomCode: 'ABCDEF',
        player: {
            playerId: 'player-2',
            playerName: '加入者',
            state: null
        }
    }));
    const parsed = JSON.parse(encoded);

    assert.deepEqual(parsed, {
        v: PROTOCOL_VERSION,
        type: 'player_joined',
        roomCode: 'ABCDEF',
        players: [
            {
                playerId: 'player-2',
                playerName: '加入者',
                state: null
            }
        ]
    });
});

// adversarial-review codex follow-up：bundleId / bundleIds 容量护栏
// 防止恶意客户端用超长 bundleId 撑爆 IconCache key 或用超长数组拉爆 CPU。

test('parseClientMessage 拒绝 icon_upload 中超长的 bundleId（防 IconCache key 撑爆）', () =>
{
    const oversized = 'a'.repeat(257); // MAX_STRING_FIELD_BYTES = 256
    assert.throws(
        () => parseClientMessage(JSON.stringify({
            v: PROTOCOL_VERSION,
            type: 'icon_upload',
            bundleId: oversized,
            iconBase64: 'YWJj'
        })),
        (err) => err instanceof ProtocolError && err.code === 'INVALID_MESSAGE'
    );
});

test('parseClientMessage 接受 icon_upload 中刚好达到上限的 bundleId', () =>
{
    const atLimit = 'a'.repeat(256);
    const message = parseClientMessage(JSON.stringify({
        v: PROTOCOL_VERSION,
        type: 'icon_upload',
        bundleId: atLimit,
        iconBase64: 'YWJj'
    }));
    assert.equal(message.bundleId.length, 256);
});

test('parseClientMessage 拒绝 icon_request 中超过 100 项的 bundleIds 数组', () =>
{
    const tooMany = Array.from({ length: 101 }, (_, i) => `com.example.app${i}`);
    assert.throws(
        () => parseClientMessage(JSON.stringify({
            v: PROTOCOL_VERSION,
            type: 'icon_request',
            bundleIds: tooMany
        })),
        (err) => err instanceof ProtocolError && err.code === 'INVALID_MESSAGE'
    );
});

test('parseClientMessage 接受 icon_request 中刚好 100 项的 bundleIds 数组', () =>
{
    const atLimit = Array.from({ length: 100 }, (_, i) => `com.example.app${i}`);
    const message = parseClientMessage(JSON.stringify({
        v: PROTOCOL_VERSION,
        type: 'icon_request',
        bundleIds: atLimit
    }));
    assert.equal(message.bundleIds.length, 100);
});

test('parseClientMessage 在 icon_request.bundleIds 中去重，保留首次出现的顺序', () =>
{
    const message = parseClientMessage(JSON.stringify({
        v: PROTOCOL_VERSION,
        type: 'icon_request',
        bundleIds: ['com.a', 'com.b', 'com.a', 'com.c', 'com.b']
    }));
    assert.deepEqual(message.bundleIds, ['com.a', 'com.b', 'com.c']);
});

test('parseClientMessage 拒绝 icon_request.bundleIds 数组中任一超长元素', () =>
{
    const oversized = 'a'.repeat(257);
    assert.throws(
        () => parseClientMessage(JSON.stringify({
            v: PROTOCOL_VERSION,
            type: 'icon_request',
            bundleIds: ['com.ok', oversized, 'com.also.ok']
        })),
        (err) => err instanceof ProtocolError && err.code === 'INVALID_MESSAGE'
    );
});
