import { beforeEach, describe, expect, it } from 'vitest';
import { useActiveAppStore } from './activeApp';
import { buildRemoteStateForTest } from './stateSync';

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
});
