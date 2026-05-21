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

    it('completeCapture dispatches the captured input back to the authoritative main store', () => {
        const spy = vi.spyOn(dispatchMod, 'dispatch').mockResolvedValue();
        const store = createBindingKeyStore({ isSettingsWindow: true });

        store.getState().completeCapture({ kind: 'keyboard', code: 32 }, 'Space');

        expect(spy).toHaveBeenCalledWith(expect.objectContaining({
            v: BRIDGE_VERSION,
            store: 'bindingKey',
            action: 'completeCapture',
            args: [{ kind: 'keyboard', code: 32 }, 'Space'],
        }));
        spy.mockRestore();
    });

    it('setPanelEnabled dispatches and does not mutate local mirror state', () => {
        const spy = vi.spyOn(dispatchMod, 'dispatch').mockResolvedValue();
        const store = createBindingKeyStore({ isSettingsWindow: true });
        expect(store.getState().panelEnabled).toBe(true);

        store.getState().setPanelEnabled(false);

        expect(store.getState().panelEnabled).toBe(true);
        expect(spy).toHaveBeenCalledWith(expect.objectContaining({
            v: BRIDGE_VERSION, store: 'bindingKey', action: 'setPanelEnabled', args: [false],
        }));
        spy.mockRestore();
    });

    it('setPermission updates local state (not a no-op) so the banner can react in the settings window', () => {
        const store = createBindingKeyStore({ isSettingsWindow: true });
        expect(store.getState().permissionGranted).toBe(true);
        store.getState().setPermission(false, 'macos');
        expect(store.getState().permissionGranted).toBe(false);
        expect(store.getState().platform).toBe('macos');
    });
});

describe('createBindingKeyStore — permission state', () => {
    it('defaults permissionGranted to true and platform to null before fetch', () => {
        const store = createBindingKeyStore({ isSettingsWindow: false });
        expect(store.getState().permissionGranted).toBe(true);
        expect(store.getState().platform).toBe(null);
    });

    it('defaults listener health to unknown before fetch', () => {
        const store = createBindingKeyStore({ isSettingsWindow: false });
        expect(store.getState().listenerRunning).toBe(null);
        expect(store.getState().listenerError).toBe(null);
        expect(store.getState().listenerDiagnostic).toBe(null);
    });

    it('setPermission updates both fields', () => {
        const store = createBindingKeyStore({ isSettingsWindow: false });
        store.getState().setPermission(false, 'macos');
        expect(store.getState().permissionGranted).toBe(false);
        expect(store.getState().platform).toBe('macos');
    });

    it('setListenerHealth mirrors listener status and diagnostics', () => {
        const store = createBindingKeyStore({ isSettingsWindow: false });
        store.getState().setListenerHealth({
            permissionGranted: true,
            platform: 'macos',
            listenerRunning: false,
            lastStartError: '[key_counter] CGEventTap create failed',
            lastStartedAtMs: null,
            lastStoppedAtMs: 1770000000000,
            bundleIdentifier: 'com.nanzhai.cpa',
            executablePath: '/Applications/桌宠番茄钟.app/Contents/MacOS/app',
            codeSignIdentifier: 'app-461de596266994b3',
        });

        expect(store.getState()).toEqual(expect.objectContaining({
            permissionGranted: true,
            platform: 'macos',
            listenerRunning: false,
            listenerError: '[key_counter] CGEventTap create failed',
            listenerDiagnostic: {
                bundleIdentifier: 'com.nanzhai.cpa',
                executablePath: '/Applications/桌宠番茄钟.app/Contents/MacOS/app',
                codeSignIdentifier: 'app-461de596266994b3',
            },
        }));
    });

    it('toggles the independent input counter panel visibility flag', () => {
        const store = createBindingKeyStore({ isSettingsWindow: false });
        expect(store.getState().panelEnabled).toBe(true);

        store.getState().setPanelEnabled(false);

        expect(store.getState().panelEnabled).toBe(false);
    });

    it('increments only enabled bound entries with matching key codes', () => {
        const store = createBindingKeyStore({ isSettingsWindow: false });
        store.setState({
            entries: [
                { id: 'bound', label: 'Space', keyCode: 49, pressCount: 4, enabled: true },
                { id: 'disabled', label: 'A', keyCode: 0, pressCount: 8, enabled: false },
                { id: 'unbound', label: '未绑定', keyCode: -1, pressCount: 2, enabled: true },
            ],
        });

        store.getState().incrementByKeyCode(49);
        store.getState().incrementByKeyCode(0);
        store.getState().incrementByKeyCode(-1);

        expect(store.getState().entries).toEqual([
            { id: 'bound', label: 'Space', keyCode: 49, pressCount: 5, enabled: true },
            { id: 'disabled', label: 'A', keyCode: 0, pressCount: 8, enabled: false },
            { id: 'unbound', label: '未绑定', keyCode: -1, pressCount: 2, enabled: true },
        ]);
    });

    it('captures and increments typed keyboard input', () => {
        const store = createBindingKeyStore({ isSettingsWindow: false });
        const id = store.getState().addEntry();

        store.getState().completeCapture({ kind: 'keyboard', code: 49 }, 'Space');
        store.getState().incrementByInput({ kind: 'keyboard', code: 49 });
        store.getState().incrementByInput({ kind: 'keyboard', code: 50 });

        expect(store.getState().entries[0]).toEqual(expect.objectContaining({
            id,
            label: 'Space',
            keyCode: 49,
            input: { kind: 'keyboard', code: 49 },
            pressCount: 1,
        }));
    });

    it('captures and increments typed mouse input', () => {
        const store = createBindingKeyStore({ isSettingsWindow: false });
        store.getState().addEntry();

        store.getState().completeCapture({ kind: 'mouse', button: 'left' }, '鼠标左键');
        store.getState().incrementByInput({ kind: 'mouse', button: 'left' });
        store.getState().incrementByInput({ kind: 'mouse', button: 'right' });

        expect(store.getState().entries[0]).toEqual(expect.objectContaining({
            label: '鼠标左键',
            keyCode: -1,
            input: { kind: 'mouse', button: 'left' },
            pressCount: 1,
        }));
    });

    it('derives old keyCode entries as keyboard input for visibility and counting', () => {
        const store = createBindingKeyStore({ isSettingsWindow: false });
        store.setState({
            entries: [
                { id: 'old', label: 'A', keyCode: 0, pressCount: 2, enabled: true },
            ],
        });

        expect(store.getState().entries[0].input).toBeUndefined();
        store.getState().incrementByInput({ kind: 'keyboard', code: 0 });

        expect(store.getState().entries[0].pressCount).toBe(3);
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
        invokeMock.mockImplementation((command: string) => {
            if (command === 'accessibility_status') {
                return Promise.resolve({ granted: true, platform: 'macos' });
            }
            if (command === 'key_counter_health') {
                return Promise.resolve({
                    permissionGranted: true,
                    platform: 'macos',
                    listenerRunning: true,
                    lastStartError: null,
                    lastStartedAtMs: 1770000000000,
                    lastStoppedAtMs: null,
                    bundleIdentifier: 'com.nanzhai.cpa',
                    executablePath: '/Applications/桌宠番茄钟.app/Contents/MacOS/app',
                    codeSignIdentifier: 'app-461de596266994b3',
                });
            }
            return Promise.resolve();
        });
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
        handlers['accessibility-permission-changed']({ payload: { granted: false, platform: 'macos' } });
        expect(useBindingKeyStore.getState().permissionGranted).toBe(false);

        // And back true
        handlers['accessibility-permission-changed']({ payload: { granted: true, platform: 'macos' } });
        expect(useBindingKeyStore.getState().permissionGranted).toBe(true);
    });

    it('loads key counter health and reacts to health change events', async () => {
        invokeMock.mockImplementation((command: string) => {
            if (command === 'accessibility_status') {
                return Promise.resolve({ granted: true, platform: 'macos' });
            }
            if (command === 'key_counter_health') {
                return Promise.resolve({
                    permissionGranted: true,
                    platform: 'macos',
                    listenerRunning: true,
                    lastStartError: null,
                    lastStartedAtMs: 1770000000000,
                    lastStoppedAtMs: null,
                    bundleIdentifier: 'com.nanzhai.cpa',
                    executablePath: '/Applications/桌宠番茄钟.app/Contents/MacOS/app',
                    codeSignIdentifier: 'app-461de596266994b3',
                });
            }
            return Promise.resolve();
        });
        const handlers: Record<string, (e: { payload: unknown }) => void> = {};
        listenMock.mockImplementation((event: string, cb: (e: { payload: unknown }) => void) => {
            handlers[event] = cb;
            return Promise.resolve(() => {});
        });

        const { useBindingKeyListener, useBindingKeyStore } = await import('./bindingKey');
        renderHook(() => useBindingKeyListener());
        await new Promise((r) => setTimeout(r, 0));

        expect(invokeMock).toHaveBeenCalledWith('key_counter_health');
        expect(useBindingKeyStore.getState().listenerRunning).toBe(true);

        handlers['key-counter-health-changed']({
            payload: {
                permissionGranted: true,
                platform: 'macos',
                listenerRunning: false,
                lastStartError: 'tap failed',
                lastStartedAtMs: null,
                lastStoppedAtMs: 1770000001000,
                bundleIdentifier: 'com.nanzhai.cpa',
                executablePath: '/Applications/桌宠番茄钟.app/Contents/MacOS/app',
                codeSignIdentifier: 'app-461de596266994b3',
            },
        });
        expect(useBindingKeyStore.getState().listenerRunning).toBe(false);
        expect(useBindingKeyStore.getState().listenerError).toBe('tap failed');
    });

    it('restarts the listener on window focus when permission is granted but listener is stopped', async () => {
        invokeMock.mockImplementation((command: string) => {
            if (command === 'accessibility_status') {
                return Promise.resolve({ granted: true, platform: 'macos' });
            }
            if (command === 'key_counter_health') {
                return Promise.resolve({
                    permissionGranted: true,
                    platform: 'macos',
                    listenerRunning: false,
                    lastStartError: 'tap failed',
                    lastStartedAtMs: null,
                    lastStoppedAtMs: 1770000001000,
                    bundleIdentifier: 'com.nanzhai.cpa',
                    executablePath: '/Applications/桌宠番茄钟.app/Contents/MacOS/app',
                    codeSignIdentifier: 'app-461de596266994b3',
                });
            }
            if (command === 'restart_key_counter_listener') {
                return Promise.resolve({
                    permissionGranted: true,
                    platform: 'macos',
                    listenerRunning: true,
                    lastStartError: null,
                    lastStartedAtMs: 1770000002000,
                    lastStoppedAtMs: 1770000001000,
                    bundleIdentifier: 'com.nanzhai.cpa',
                    executablePath: '/Applications/桌宠番茄钟.app/Contents/MacOS/app',
                    codeSignIdentifier: 'app-461de596266994b3',
                });
            }
            return Promise.resolve();
        });
        listenMock.mockResolvedValue(() => {});

        const { useBindingKeyListener, useBindingKeyStore } = await import('./bindingKey');
        renderHook(() => useBindingKeyListener());
        await new Promise((r) => setTimeout(r, 0));

        window.dispatchEvent(new Event('focus'));
        await new Promise((r) => setTimeout(r, 0));

        expect(invokeMock).toHaveBeenCalledWith('restart_key_counter_listener');
        expect(useBindingKeyStore.getState().listenerRunning).toBe(true);
    });

    it('captures mouse input from input-pressed events', async () => {
        const handlers: Record<string, (e: { payload: unknown }) => void> = {};
        listenMock.mockImplementation((event: string, cb: (e: { payload: unknown }) => void) => {
            handlers[event] = cb;
            return Promise.resolve(() => {});
        });
        invokeMock.mockResolvedValue({ granted: true, platform: 'macos' });

        const { useBindingKeyListener, useBindingKeyStore } = await import('./bindingKey');
        useBindingKeyStore.setState({
            panelEnabled: true,
            entries: [],
            syncedKeyId: null,
            capturingId: null,
            permissionGranted: true,
            platform: null,
        });
        const id = useBindingKeyStore.getState().addEntry();
        renderHook(() => useBindingKeyListener());
        await new Promise((r) => setTimeout(r, 0));

        handlers['input-pressed']({ payload: { kind: 'mouse', button: 'right' } });

        expect(useBindingKeyStore.getState().entries[0]).toEqual(expect.objectContaining({
            id,
            label: '鼠标右键',
            input: { kind: 'mouse', button: 'right' },
            pressCount: 0,
        }));
    });

    it('ignores malformed input-pressed payloads', async () => {
        const handlers: Record<string, (e: { payload: unknown }) => void> = {};
        listenMock.mockImplementation((event: string, cb: (e: { payload: unknown }) => void) => {
            handlers[event] = cb;
            return Promise.resolve(() => {});
        });
        invokeMock.mockResolvedValue({ granted: true, platform: 'macos' });

        const { useBindingKeyListener, useBindingKeyStore } = await import('./bindingKey');
        useBindingKeyStore.setState({
            panelEnabled: true,
            entries: [],
            syncedKeyId: null,
            capturingId: null,
            permissionGranted: true,
            platform: null,
        });
        useBindingKeyStore.getState().addEntry();
        renderHook(() => useBindingKeyListener());
        await new Promise((r) => setTimeout(r, 0));

        handlers['input-pressed']({ payload: { kind: 'mouse', button: 'side' } });
        handlers['input-pressed']({ payload: { kind: 'keyboard', code: -1 } });

        expect(useBindingKeyStore.getState().capturingId).not.toBe(null);
        expect(useBindingKeyStore.getState().entries[0].label).toBe('未绑定');
    });

    it('cleans up listener subscriptions that resolve after unmount', async () => {
        invokeMock.mockImplementation((command: string) => {
            if (command === 'accessibility_status') {
                return Promise.resolve({ granted: true, platform: 'macos' });
            }
            if (command === 'key_counter_health') {
                return Promise.resolve({
                    permissionGranted: true,
                    platform: 'macos',
                    listenerRunning: true,
                    lastStartError: null,
                    lastStartedAtMs: 1770000000000,
                    lastStoppedAtMs: null,
                    bundleIdentifier: 'com.nanzhai.cpa',
                    executablePath: '/Applications/桌宠番茄钟.app/Contents/MacOS/app',
                    codeSignIdentifier: 'app-461de596266994b3',
                });
            }
            return Promise.resolve();
        });
        const unlisteners = [vi.fn(), vi.fn(), vi.fn(), vi.fn()];
        const resolvers: Array<(unlisten: () => void) => void> = [];
        listenMock.mockImplementation(() => new Promise((resolve) => {
            resolvers.push(resolve);
        }));

        const { useBindingKeyListener } = await import('./bindingKey');
        const { unmount } = renderHook(() => useBindingKeyListener());

        expect(resolvers).toHaveLength(4);
        unmount();
        resolvers.forEach((resolve, index) => resolve(unlisteners[index]));
        await new Promise((r) => setTimeout(r, 0));

        expect(unlisteners[0]).toHaveBeenCalledTimes(1);
        expect(unlisteners[1]).toHaveBeenCalledTimes(1);
        expect(unlisteners[2]).toHaveBeenCalledTimes(1);
        expect(unlisteners[3]).toHaveBeenCalledTimes(1);
    });
});
