import { beforeEach, describe, expect, it, vi } from 'vitest';
import { focusAppWindow } from './focusWindow';

const { invokeMock } = vi.hoisted(() => ({
    invokeMock: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));

beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValue(undefined);
});

describe('focusAppWindow', () => {
    it('focuses an allowlisted app window through Tauri', async () => {
        await focusAppWindow('main');

        expect(invokeMock).toHaveBeenCalledWith('focus_app_window', {
            label: 'main',
        });
    });
});
