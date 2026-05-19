import assert from 'node:assert/strict';
import test from 'node:test';

import {
    EMPTY_ROOM_TTL_MS,
    MAX_PLAYERS_PER_ROOM,
    RoomManager
} from '../src/RoomManager.js';

function createFakeSocket(name)
{
    return {
        name,
        readyState: 1,
        send()
        {
        }
    };
}

function createFakeClock(startAt = 0)
{
    let now = startAt;
    let nextTimerId = 1;
    const timers = new Map();

    return {
        now()
        {
            return now;
        },
        schedule(callback, delayMs)
        {
            const timerId = nextTimerId++;
            timers.set(timerId, {
                callback,
                runAt: now + delayMs
            });
            return timerId;
        },
        cancel(timerId)
        {
            timers.delete(timerId);
        },
        advance(ms)
        {
            now += ms;

            let foundDueTimer = true;
            while (foundDueTimer)
            {
                foundDueTimer = false;

                const dueTimers = [...timers.entries()]
                    .filter(([, timer]) => timer.runAt <= now)
                    .sort((left, right) => left[1].runAt - right[1].runAt);

                if (dueTimers.length > 0)
                {
                    foundDueTimer = true;
                    const [timerId, timer] = dueTimers[0];
                    timers.delete(timerId);
                    timer.callback();
                }
            }
        }
    };
}

function createManager(options = {})
{
    const clock = options.clock ?? createFakeClock();
    const roomCodeFactory = options.roomCodeFactory ?? (() => 'ABCDEF');

    return {
        clock,
        roomManager: new RoomManager({
            now: () => clock.now(),
            scheduleTimeout: (callback, delayMs) => clock.schedule(callback, delayMs),
            clearScheduledTimeout: (timerId) => clock.cancel(timerId),
            roomCodeFactory
        })
    };
}

test('createRoom 在房间码冲突时仍生成唯一房间码', () =>
{
    const roomCodes = ['ABCDEF', 'ABCDEF', 'UVWXYZ'];
    const { roomManager } = createManager({
        roomCodeFactory: () => roomCodes.shift()
    });

    const firstRoom = roomManager.createRoom({
        playerId: 'player-1',
        playerName: '主机',
        ws: createFakeSocket('host-1')
    });
    const secondRoom = roomManager.createRoom({
        playerId: 'player-2',
        playerName: '副机',
        ws: createFakeSocket('host-2')
    });

    assert.equal(firstRoom.code, 'ABCDEF');
    assert.equal(secondRoom.code, 'UVWXYZ');
    assert.notEqual(firstRoom.code, secondRoom.code);
});

test('joinRoom 在房间满员时拒绝第九名玩家', () =>
{
    const { roomManager } = createManager({
        roomCodeFactory: () => 'ROOM01'
    });

    const room = roomManager.createRoom({
        playerId: 'player-1',
        playerName: '主机',
        ws: createFakeSocket('host')
    });

    for (let index = 2; index <= MAX_PLAYERS_PER_ROOM; index += 1)
    {
        roomManager.joinRoom({
            roomCode: room.code,
            playerId: `player-${index}`,
            playerName: `玩家${index}`,
            ws: createFakeSocket(`player-${index}`)
        });
    }

    assert.throws(
        () => roomManager.joinRoom({
            roomCode: room.code,
            playerId: 'player-9',
            playerName: '玩家9',
            ws: createFakeSocket('player-9')
        }),
        (error) => error.code === 'ROOM_FULL'
    );
});

test('leaveRoom 会在空房 30 秒后销毁，并在新玩家加入时取消销毁', () =>
{
    const { clock, roomManager } = createManager({
        roomCodeFactory: () => 'STAY01'
    });

    const room = roomManager.createRoom({
        playerId: 'player-1',
        playerName: '主机',
        ws: createFakeSocket('host')
    });

    roomManager.leaveRoom({
        roomCode: room.code,
        playerId: 'player-1'
    });

    assert.ok(roomManager.getRoom(room.code));

    clock.advance(EMPTY_ROOM_TTL_MS - 1);
    assert.ok(roomManager.getRoom(room.code));

    roomManager.joinRoom({
        roomCode: room.code,
        playerId: 'player-2',
        playerName: '回来了',
        ws: createFakeSocket('player-2')
    });

    clock.advance(2);
    assert.ok(roomManager.getRoom(room.code));

    roomManager.leaveRoom({
        roomCode: room.code,
        playerId: 'player-2'
    });

    clock.advance(EMPTY_ROOM_TTL_MS);
    assert.equal(roomManager.getRoom(room.code), null);
});

test('updatePlayerState 在 phase 切换时绕过 10Hz 节流并保留最新快照', () =>
{
    const { clock, roomManager } = createManager({
        roomCodeFactory: () => 'RATE01'
    });

    const room = roomManager.createRoom({
        playerId: 'player-1',
        playerName: '主机',
        ws: createFakeSocket('host')
    });

    const baseState = {
        pomodoro: {
            phase: 0,
            remainingSeconds: 1200,
            currentRound: 1,
            totalRounds: 4,
            isRunning: false
        },
        activeApp: null
    };

    for (let index = 0; index < 10; index += 1)
    {
        const result = roomManager.updatePlayerState({
            roomCode: room.code,
            playerId: 'player-1',
            state: {
                pomodoro: {
                    ...baseState.pomodoro,
                    remainingSeconds: baseState.pomodoro.remainingSeconds - index
                },
                activeApp: null
            }
        });

        assert.equal(result.shouldBroadcast, true);
        clock.advance(50);
    }

    const throttled = roomManager.updatePlayerState({
        roomCode: room.code,
        playerId: 'player-1',
        state: {
            pomodoro: {
                ...baseState.pomodoro,
                remainingSeconds: 999
            },
            activeApp: null
        }
    });

    assert.equal(throttled.shouldBroadcast, false);

    const bypassed = roomManager.updatePlayerState({
        roomCode: room.code,
        playerId: 'player-1',
        state: {
            pomodoro: {
                ...baseState.pomodoro,
                phase: 1,
                isRunning: true,
                remainingSeconds: 998
            },
            activeApp: null
        }
    });

    assert.equal(bypassed.shouldBroadcast, true);
    assert.deepEqual(roomManager.getRoomSnapshot(room.code)[0].state, bypassed.player.latestState);
});
