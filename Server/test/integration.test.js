import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';

import { WebSocket } from 'ws';

import { createPomodoroServer } from '../src/index.js';
import { PROTOCOL_VERSION } from '../src/protocol.js';

async function openClient(url)
{
    const socket = new WebSocket(url);
    await once(socket, 'open');
    return socket;
}

function sendJson(socket, payload)
{
    socket.send(JSON.stringify({
        v: PROTOCOL_VERSION,
        ...payload
    }));
}

function createMessageCollector(socket)
{
    const queuedMessages = [];
    const waiters = [];

    socket.on('message', (rawBuffer) =>
    {
        const message = JSON.parse(rawBuffer.toString());
        const waiterIndex = waiters.findIndex((waiter) => waiter.type === message.type);

        if (waiterIndex >= 0)
        {
            const [waiter] = waiters.splice(waiterIndex, 1);
            clearTimeout(waiter.timerId);
            waiter.resolve(message);
            return;
        }

        queuedMessages.push(message);
    });

    return {
        waitFor(type, timeoutMs = 2000)
        {
            const queuedIndex = queuedMessages.findIndex((message) => message.type === type);
            if (queuedIndex >= 0)
            {
                return Promise.resolve(queuedMessages.splice(queuedIndex, 1)[0]);
            }

            return new Promise((resolve, reject) =>
            {
                const timerId = setTimeout(() =>
                {
                    const waiterIndex = waiters.findIndex((waiter) => waiter.timerId === timerId);
                    if (waiterIndex >= 0)
                    {
                        waiters.splice(waiterIndex, 1);
                    }

                    reject(new Error(`等待消息超时: ${type}`));
                }, timeoutMs);

                waiters.push({
                    type,
                    resolve,
                    timerId
                });
            });
        }
    };
}

test('两个客户端可以完成 create/join/state_update/leave 流程', async (t) =>
{
    const app = await createPomodoroServer({
        port: 0,
        heartbeatIntervalMs: 5000,
        initTimeoutMs: 1000
    });

    t.after(async () =>
    {
        await app.close();
    });

    const clientA = await openClient(app.url);
    const clientB = await openClient(app.url);
    const inboxA = createMessageCollector(clientA);
    const inboxB = createMessageCollector(clientB);

    t.after(() =>
    {
        clientA.close();
        clientB.close();
    });

    sendJson(clientA, {
        type: 'create_room',
        playerName: '主机'
    });

    const roomCreated = await inboxA.waitFor('room_created');
    const hostSnapshot = await inboxA.waitFor('room_snapshot');

    assert.equal(roomCreated.roomCode.length, 6);
    assert.equal(roomCreated.playerId.length > 0, true);
    assert.equal(hostSnapshot.players.length, 1);
    assert.equal(hostSnapshot.players[0].playerName, '主机');

    sendJson(clientB, {
        type: 'join_room',
        roomCode: roomCreated.roomCode,
        playerName: '访客'
    });

    const roomJoined = await inboxB.waitFor('room_joined');
    const guestSnapshot = await inboxB.waitFor('room_snapshot');
    const playerJoined = await inboxA.waitFor('player_joined');

    assert.equal(roomJoined.roomCode, roomCreated.roomCode);
    assert.equal(guestSnapshot.players.length, 2);
    assert.deepEqual(playerJoined.players, [
        {
            playerId: roomJoined.playerId,
            playerName: '访客',
            state: null
        }
    ]);

    sendJson(clientA, {
        type: 'player_state_update',
        state: {
            pomodoro: {
                phase: 0,
                remainingSeconds: 1499,
                currentRound: 1,
                totalRounds: 4,
                isRunning: true
            },
            activeApp: null
        }
    });

    const broadcast = await inboxB.waitFor('player_state_broadcast');
    assert.equal(broadcast.playerId, roomCreated.playerId);
    assert.equal(broadcast.state.pomodoro.remainingSeconds, 1499);

    sendJson(clientB, {
        type: 'leave_room'
    });

    const playerLeft = await inboxA.waitFor('player_left');
    assert.equal(playerLeft.playerId, roomJoined.playerId);
});

// 回归：曾经 normalizeRemoteState / cloneRemoteState 都没复制 bindingKey，
// 服务端把字段静默丢掉 → 其他玩家面板上 PlayerCard 的 KeyCounterPill 永远不显示。
test('player_state_broadcast 把 bindingKey 透传给其它玩家，远端按键同步可见', async (t) =>
{
    const app = await createPomodoroServer({
        port: 0,
        heartbeatIntervalMs: 5000,
        initTimeoutMs: 1000
    });
    t.after(async () => { await app.close(); });

    const clientA = await openClient(app.url);
    const clientB = await openClient(app.url);
    const inboxA = createMessageCollector(clientA);
    const inboxB = createMessageCollector(clientB);
    t.after(() => { clientA.close(); clientB.close(); });

    sendJson(clientA, { type: 'create_room', playerName: 'A' });
    const roomCreated = await inboxA.waitFor('room_created');
    await inboxA.waitFor('room_snapshot');
    sendJson(clientB, { type: 'join_room', roomCode: roomCreated.roomCode, playerName: 'B' });
    await inboxB.waitFor('room_joined');
    await inboxB.waitFor('room_snapshot');
    await inboxA.waitFor('player_joined');

    sendJson(clientA, {
        type: 'player_state_update',
        state: {
            pomodoro: { phase: 0, remainingSeconds: 1499, currentRound: 1, totalRounds: 4, isRunning: true },
            activeApp: null,
            bindingKey: { keyLabel: 'Space', pressCount: 7 }
        }
    });

    const broadcast = await inboxB.waitFor('player_state_broadcast');
    assert.deepEqual(broadcast.state.bindingKey, { keyLabel: 'Space', pressCount: 7 });

    // 取消同步：发送 bindingKey=null，B 端必须能感知（用来隐藏自己 PlayerCard 上的 pill）。
    sendJson(clientA, {
        type: 'player_state_update',
        state: {
            pomodoro: { phase: 0, remainingSeconds: 1498, currentRound: 1, totalRounds: 4, isRunning: true },
            activeApp: null,
            bindingKey: null
        }
    });

    const broadcast2 = await inboxB.waitFor('player_state_broadcast');
    assert.equal(broadcast2.state.bindingKey, null);
});

test('room_snapshot 把已有玩家的 bindingKey 透传给新进来的玩家（cloneRemoteState 路径）', async (t) =>
{
    const app = await createPomodoroServer({
        port: 0,
        heartbeatIntervalMs: 5000,
        initTimeoutMs: 1000
    });
    t.after(async () => { await app.close(); });

    const clientA = await openClient(app.url);
    const inboxA = createMessageCollector(clientA);
    t.after(() => { clientA.close(); });

    sendJson(clientA, { type: 'create_room', playerName: 'A' });
    const roomCreated = await inboxA.waitFor('room_created');
    await inboxA.waitFor('room_snapshot');

    sendJson(clientA, {
        type: 'player_state_update',
        state: {
            pomodoro: { phase: 0, remainingSeconds: 1490, currentRound: 1, totalRounds: 4, isRunning: true },
            activeApp: null,
            bindingKey: { keyLabel: 'F', pressCount: 3 }
        }
    });

    // 等待状态写入 RoomManager 后，新客户端 B 加入应拿到带 bindingKey 的 snapshot。
    const clientB = await openClient(app.url);
    const inboxB = createMessageCollector(clientB);
    t.after(() => { clientB.close(); });

    sendJson(clientB, { type: 'join_room', roomCode: roomCreated.roomCode, playerName: 'B' });
    await inboxB.waitFor('room_joined');
    const snapshot = await inboxB.waitFor('room_snapshot');

    const playerA = snapshot.players.find((p) => p.playerName === 'A');
    assert.ok(playerA, 'snapshot 必须包含 A');
    assert.deepEqual(playerA.state.bindingKey, { keyLabel: 'F', pressCount: 3 });
});

test('图标流程：state_update → icon_need → icon_upload → icon_broadcast', async (t) =>
{
    const app = await createPomodoroServer({
        port: 0,
        heartbeatIntervalMs: 5000,
        initTimeoutMs: 1000
    });

    t.after(async () => { await app.close(); });

    const clientA = await openClient(app.url);
    const clientB = await openClient(app.url);
    const inboxA = createMessageCollector(clientA);
    const inboxB = createMessageCollector(clientB);

    t.after(() => { clientA.close(); clientB.close(); });

    // A 创建房间，B 加入
    sendJson(clientA, { type: 'create_room', playerName: 'A' });
    const roomCreated = await inboxA.waitFor('room_created');
    await inboxA.waitFor('room_snapshot');

    sendJson(clientB, { type: 'join_room', roomCode: roomCreated.roomCode, playerName: 'B' });
    await inboxB.waitFor('room_joined');
    await inboxB.waitFor('room_snapshot');
    await inboxA.waitFor('player_joined');

    // B 发带未知 bundleId 的 state_update
    sendJson(clientB, {
        type: 'player_state_update',
        state: {
            pomodoro: { phase: 0, remainingSeconds: 1500, currentRound: 1, totalRounds: 4, isRunning: false },
            activeApp: { name: 'Safari', bundleId: 'com.apple.Safari' }
        }
    });

    // B 应收到 icon_need
    const iconNeed = await inboxB.waitFor('icon_need');
    assert.equal(iconNeed.bundleId, 'com.apple.Safari');

    // B 上传图标
    sendJson(clientB, {
        type: 'icon_upload',
        bundleId: 'com.apple.Safari',
        iconBase64: 'QUFB'  // "AAA" base64
    });

    // A 与 B 都应收到 icon_broadcast
    const bcA = await inboxA.waitFor('icon_broadcast');
    const bcB = await inboxB.waitFor('icon_broadcast');
    assert.equal(bcA.bundleId, 'com.apple.Safari');
    assert.equal(bcA.iconBase64, 'QUFB');
    assert.equal(bcB.bundleId, 'com.apple.Safari');

    // A 后续 icon_request 命中缓存
    sendJson(clientA, { type: 'icon_request', bundleIds: ['com.apple.Safari'] });
    const bcA2 = await inboxA.waitFor('icon_broadcast');
    assert.equal(bcA2.bundleId, 'com.apple.Safari');
});
