import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BRIDGE_VERSION, EVT_DISPATCH } from '../domain/bridge/protocol';

const invoke = vi.hoisted(() => vi.fn(async () => undefined));
const emit = vi.hoisted(() => vi.fn(async () => undefined));
const getByLabel = vi.hoisted(() => vi.fn(async () => ({ emit })));

vi.mock('@tauri-apps/api/core', () => ({ invoke }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }));
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
    it('dispatches camera authorization only after the explicit button click', async () => {
        const [{ SettingsPanel }, { usePresenceStore }] = await Promise.all([
            import('./SettingsPanel'),
            import('../domain/presence'),
        ]);
        usePresenceStore.setState({ enabled: true, availability: 'permissionRequired' });
        render(<SettingsPanel />);

        expect(invoke).not.toHaveBeenCalledWith('request_camera_presence_access');
        expect(emit).not.toHaveBeenCalledWith(EVT_DISPATCH, expect.anything());

        fireEvent.click(screen.getByRole('button', { name: '申请权限' }));

        await waitFor(() => {
            expect(emit).toHaveBeenCalledWith(EVT_DISPATCH, {
                v: BRIDGE_VERSION,
                store: 'presence',
                action: 'requestAccess',
                args: [],
            });
        });
        expect(getByLabel).toHaveBeenCalledWith('main');
        expect(invoke).not.toHaveBeenCalledWith('request_camera_presence_access');
    });
});
