import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createBindingKeyStore } from './bindingKey';
import * as dispatchMod from './bridge/dispatch';
import { BRIDGE_VERSION } from './bridge/protocol';

describe('createBindingKeyStore — settings-window mode', () => {
    it('addEntry dispatches and does not mutate local state', () => {
        const spy = vi.spyOn(dispatchMod, 'dispatch').mockResolvedValue();
        const store = createBindingKeyStore({ isSettingsWindow: true });
        const before = store.getState().entries.length;
        store.getState().addEntry();
        expect(store.getState().entries.length).toBe(before);
        expect(spy).toHaveBeenCalledWith(expect.objectContaining({
            v: BRIDGE_VERSION, store: 'bindingKey', action: 'addEntry', args: [],
        }));
        spy.mockRestore();
    });

    it('removeEntry, setSynced, beginCapture all dispatch', () => {
        const spy = vi.spyOn(dispatchMod, 'dispatch').mockResolvedValue();
        const store = createBindingKeyStore({ isSettingsWindow: true });
        store.getState().removeEntry('bk-1');
        store.getState().setSynced('bk-2');
        store.getState().beginCapture('bk-3');
        expect(spy).toHaveBeenCalledWith(expect.objectContaining({ v: BRIDGE_VERSION, store: 'bindingKey', action: 'removeEntry',  args: ['bk-1'] }));
        expect(spy).toHaveBeenCalledWith(expect.objectContaining({ v: BRIDGE_VERSION, store: 'bindingKey', action: 'setSynced',    args: ['bk-2'] }));
        expect(spy).toHaveBeenCalledWith(expect.objectContaining({ v: BRIDGE_VERSION, store: 'bindingKey', action: 'beginCapture', args: ['bk-3'] }));
        spy.mockRestore();
    });
});

describe('createBindingKeyStore — permission state', () => {
    it('defaults permissionGranted to true and platform to null before fetch', () => {
        const store = createBindingKeyStore({ isSettingsWindow: false });
        expect(store.getState().permissionGranted).toBe(true);
        expect(store.getState().platform).toBe(null);
    });

    it('setPermission updates both fields', () => {
        const store = createBindingKeyStore({ isSettingsWindow: false });
        store.getState().setPermission(false, 'macos');
        expect(store.getState().permissionGranted).toBe(false);
        expect(store.getState().platform).toBe('macos');
    });
});

import { renderHook } from '@testing-library/react';

const { listenMock, invokeMock } = vi.hoisted(() => ({
    listenMock: vi.fn(),
    invokeMock: vi.fn(),
}));

vi.mock('@tauri-apps/api/event', () => ({ listen: listenMock }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));

describe('useBindingKeyListener — permission event', () => {
    beforeEach(() => {
        listenMock.mockReset();
        invokeMock.mockReset();
    });

    it('flips permissionGranted when accessibility-permission-changed fires', async () => {
        invokeMock.mockResolvedValue({ granted: true, platform: 'macos' });
        const handlers: Record<string, (e: { payload: unknown }) => void> = {};
        listenMock.mockImplementation((event: string, cb: (e: { payload: unknown }) => void) => {
            handlers[event] = cb;
            return Promise.resolve(() => {});
        });

        const { useBindingKeyListener, useBindingKeyStore } = await import('./bindingKey');
        renderHook(() => useBindingKeyListener());

        // Wait for mount-time invoke + listen calls to settle
        await new Promise((r) => setTimeout(r, 0));
        expect(useBindingKeyStore.getState().permissionGranted).toBe(true);

        // Simulate event flip false
        handlers['accessibility-permission-changed']({ payload: { granted: false } });
        expect(useBindingKeyStore.getState().permissionGranted).toBe(false);

        // And back true
        handlers['accessibility-permission-changed']({ payload: { granted: true } });
        expect(useBindingKeyStore.getState().permissionGranted).toBe(true);
    });
});
