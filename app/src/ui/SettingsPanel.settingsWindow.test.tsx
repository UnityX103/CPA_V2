import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BRIDGE_VERSION, EVT_DISPATCH } from '../domain/bridge/protocol';

const results = vi.hoisted(() => ({ receive: (_event: { payload: { requestId: string; ok: boolean } }) => {} }));
const invoke = vi.hoisted(() => vi.fn(async () => undefined));
const emit = vi.hoisted(() => vi.fn(async () => undefined));
const getByLabel = vi.hoisted(() => vi.fn(async () => ({ emit })));

vi.mock('@tauri-apps/api/core', () => ({ invoke }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async (event, callback) => {
    if (event === 'app:dispatch:result') results.receive = callback;
    return () => {};
}) }));
vi.mock('@tauri-apps/api/window', () => ({
    getCurrentWindow: () => ({ startDragging: vi.fn(async () => {}) }),
}));
vi.mock('@tauri-apps/api/webviewWindow', () => ({
    WebviewWindow: { getByLabel },
}));

beforeEach(() => {
    vi.resetModules();
    invoke.mockClear();
    emit.mockClear();
    getByLabel.mockClear();
    window.history.replaceState({}, '', '/?window=settings');
});

afterEach(() => {
    cleanup();
    window.history.replaceState({}, '', '/');
});

describe('SettingsPanel in the settings window', () => {
    it('dispatches input settings only after Apply and receives confirmation from the main window', async () => {
        const [{ SettingsPanel }, { usePresenceStore }] = await Promise.all([
            import('./SettingsPanel'),
            import('../domain/presence'),
        ]);
        usePresenceStore.setState({ inputActivityEnabled: false, inputActivityAvailability: 'disabled' });
        emit.mockImplementation(async (_event?: string, request?: { requestId: string }) => {
            if (request) results.receive({ payload: { requestId: request.requestId, ok: true } });
        });
        render(<SettingsPanel />);

        expect(invoke).not.toHaveBeenCalledWith('request_camera_presence_access');
        expect(emit).not.toHaveBeenCalledWith(EVT_DISPATCH, expect.anything());

        fireEvent.click(screen.getByRole('button', { name: '允许检测键盘和鼠标活动' }));
        expect(emit).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: '应用' }));

        await waitFor(() => {
            expect(emit).toHaveBeenCalledWith(EVT_DISPATCH, expect.objectContaining({
                replyTo: 'settings', payload: { v: BRIDGE_VERSION, store: 'presence',
                    action: 'applySettings', args: [{ inputActivityEnabled: true,
                        restDeskReminderEnabled: false, restDeskReminderMode: 'cockroachInvasion' }] },
            }));
        });
        expect(getByLabel).toHaveBeenCalledWith('main');
        expect(invoke).not.toHaveBeenCalledWith('request_camera_presence_access');
    });
});
