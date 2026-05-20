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

test('state_update 端到端广播延迟不超过 500ms', async (t) =>
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
    await inboxA.waitFor('room_snapshot');

    sendJson(clientB, {
        type: 'join_room',
        roomCode: roomCreated.roomCode,
        playerName: '访客'
    });

    await inboxB.waitFor('room_joined');
    await inboxB.waitFor('room_snapshot');
    await inboxA.waitFor('player_joined');

    const sentAt = Date.now();
    sendJson(clientA, {
        type: 'player_state_update',
        state: {
            pomodoro: {
                phase: 0,
                remainingSeconds: 1200,
                currentRound: 1,
                totalRounds: 4,
                isRunning: true
            },
            activeApp: null
        }
    });

    const broadcast = await inboxB.waitFor('player_state_broadcast');
    const latencyMs = Date.now() - sentAt;

    assert.equal(broadcast.type, 'player_state_broadcast');
    assert.ok(latencyMs <= 500, `端到端延迟为 ${latencyMs}ms，超过 500ms`);
});
