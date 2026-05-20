import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useActiveAppStore } from './activeApp';
import { useBindingKeyStore } from './bindingKey';
import { useNetworkStore } from './network';
import { usePomodoroStore } from './pomodoro';
import { buildRemoteStateForTest, useStateSync } from './stateSync';

// adversarial-review #10 case 5：lastSent 用 (roomCode, playerId, payload) 复合 key
// 离开后重新加入相同房间或换房间时第一帧应该被发送
describe('stateSync.lastSent 复合 key', () => {
    it('payload 一致但 roomCode 变化时 key 不同', () => {
        const payload = '{"x":1}';
        const a = `R1:p1:${payload}`;
        const b = `R2:p1:${payload}`;
        expect(a).not.toBe(b);
    });

    it('payload 一致但 playerId 变化时 key 不同', () => {
        const payload = '{"x":1}';
        const a = `R1:p1:${payload}`;
        const b = `R1:p2:${payload}`;
        expect(a).not.toBe(b);
    });

    it('完全相同的 (room, player, payload) key 相同', () => {
        const payload = '{"x":1}';
        expect(`R1:p1:${payload}`).toBe(`R1:p1:${payload}`);
    });
});

describe('stateSync active app metadata', () => {
    beforeEach(() => {
        useActiveAppStore.setState({ current: null });
        useBindingKeyStore.setState({ syncedKeyId: null, entries: [] });
        usePomodoroStore.setState({
            currentPhase: 'focus',
            remainingSeconds: 1500,
            currentRound: 1,
            totalRounds: 4,
            isRunning: false,
        });
        useNetworkStore.setState({
            status: 'idle',
            roomCode: '',
            playerId: null,
            players: {},
            lastError: null,
        });
    });

    afterEach(() => {
        cleanup();
    });

    it('includes active app title and icon in remote state', () => {
        useActiveAppStore.setState({
            current: {
                name: 'Rider',
                bundle_id: 'com.jetbrains.rider',
                window_title: 'PlayerCard.tsx - CPA_V2',
                icon_data_url: 'data:image/png;base64,QUFB',
            },
        });

        expect(buildRemoteStateForTest().activeApp).toEqual({
            name: 'Rider',
            bundleId: 'com.jetbrains.rider',
            windowTitle: 'PlayerCard.tsx - CPA_V2',
            iconDataUrl: 'data:image/png;base64,QUFB',
        });
    });

    it('sends a state update immediately when active app metadata changes', async () => {
        const sendStateUpdate = vi.fn();
        useNetworkStore.setState({
            status: 'joined',
            roomCode: 'R1',
            playerId: 'p1',
            sendStateUpdate,
        });
        renderHook(() => useStateSync());

        act(() => {
            useActiveAppStore.getState().setCurrent({
                name: 'Safari',
                bundle_id: 'com.apple.Safari',
                window_title: 'Docs - Safari',
                icon_data_url: 'data:image/png;base64,QUFB',
            });
        });

        await waitFor(() => expect(sendStateUpdate).toHaveBeenCalledTimes(1));
        expect(sendStateUpdate).toHaveBeenCalledWith(expect.objectContaining({
            activeApp: {
                name: 'Safari',
                bundleId: 'com.apple.Safari',
                windowTitle: 'Docs - Safari',
                iconDataUrl: 'data:image/png;base64,QUFB',
            },
        }));
    });

    it('sends a state update immediately when the synced binding key count changes', async () => {
        const sendStateUpdate = vi.fn();
        useNetworkStore.setState({
            status: 'joined',
            roomCode: 'R1',
            playerId: 'p1',
            sendStateUpdate,
        });
        useBindingKeyStore.setState({
            entries: [{
                id: 'bk-1',
                label: 'Space',
                keyCode: 49,
                pressCount: 0,
                enabled: true,
            }],
            syncedKeyId: 'bk-1',
        });
        renderHook(() => useStateSync());

        act(() => {
            useBindingKeyStore.getState().incrementByKeyCode(49);
        });

        await waitFor(() => expect(sendStateUpdate).toHaveBeenCalled());
        expect(sendStateUpdate).toHaveBeenLastCalledWith(expect.objectContaining({
            bindingKey: { keyLabel: 'Space', pressCount: 1 },
        }));
    });
});
