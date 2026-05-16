import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import {
    BRIDGE_VERSION,
    EVT_DISPATCH,
    EVT_STATE,
    EVT_STATE_REQUEST,
    type BridgeSnapshot,
    type DispatchPayload,
} from './protocol';

describe('bridge protocol', () => {
    it('defines stable event names', () => {
        expect(EVT_STATE_REQUEST).toBe('app:state:request');
        expect(EVT_STATE).toBe('app:state');
        expect(EVT_DISPATCH).toBe('app:dispatch');
    });

    it('uses BRIDGE_VERSION = 1', () => {
        expect(BRIDGE_VERSION).toBe(1);
    });

    it('BridgeSnapshot accepts a fully-populated payload', () => {
        const snap: BridgeSnapshot = {
            v: 1,
            settings: { uiScale: 1.5 },
            pomodoro: { focusDurationSeconds: 1500, breakDurationSeconds: 300, totalRounds: 4 },
            network: {
                autoConnect: false, playerName: 'me', playerId: 'p-1',
                roomCode: 'R1', status: 'idle',
                players: {}, lastError: null,
            },
            bindingKey: { entries: [], capturingId: null, syncedKeyId: null },
        };
        expect(snap.v).toBe(1);
        expect('targetMonitorIndex' in snap.settings).toBe(false);
    });

    it('DispatchPayload accepts every action shape', () => {
        const samples: DispatchPayload[] = [
            { v: 1, store: 'settings',   action: 'setUiScale',     args: [1.5] },
            { v: 1, store: 'pomodoro',   action: 'applySettings',  args: [1500, 300, 4, true] },
            { v: 1, store: 'network',    action: 'createRoom',     args: ['R1'] },
            { v: 1, store: 'network',    action: 'joinRoom',       args: ['R1'] },
            { v: 1, store: 'network',    action: 'leaveRoom',      args: [] },
            { v: 1, store: 'network',    action: 'setAutoConnect', args: [true] },
            { v: 1, store: 'network',    action: 'setPlayerName',  args: ['me'] },
            { v: 1, store: 'bindingKey', action: 'beginCapture',   args: ['bk-1'] },
            { v: 1, store: 'bindingKey', action: 'removeEntry',    args: ['bk-1'] },
            { v: 1, store: 'bindingKey', action: 'setSynced',      args: [null] },
            { v: 1, store: 'bindingKey', action: 'addEntry',       args: [] },
        ];
        expect(samples).toHaveLength(11);
        const here = path.dirname(fileURLToPath(import.meta.url));
        const protocol = readFileSync(path.join(here, 'protocol.ts'), 'utf8');
        expect(protocol).not.toContain('setTargetMonitor');
    });
});
