import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    customVideoSrc,
    pickCustomWebmPath,
    showCustomVideoMissingMessage,
    validateCustomVideoPath,
} from './videoFiles';

const mocks = vi.hoisted(() => ({
    convertFileSrc: vi.fn(),
    invoke: vi.fn(),
    message: vi.fn(),
    open: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({
    convertFileSrc: mocks.convertFileSrc,
    invoke: mocks.invoke,
}));
vi.mock('@tauri-apps/plugin-dialog', () => ({
    message: mocks.message,
    open: mocks.open,
}));

describe('custom video file adapter', () => {
    beforeEach(() => Object.values(mocks).forEach((mock) => mock.mockReset()));

    it('imports a picked WebM and returns only the app-owned path', async () => {
        mocks.open.mockResolvedValue('/Users/xpy/Videos/focus-end.webm');
        mocks.invoke.mockResolvedValue('/app-data/media/pomodoro-end/提示视频.webm');
        await expect(pickCustomWebmPath()).resolves.toBe('/app-data/media/pomodoro-end/提示视频.webm');
        expect(mocks.invoke).toHaveBeenCalledWith('import_custom_video', { path: '/Users/xpy/Videos/focus-end.webm' });
        expect(mocks.open).toHaveBeenCalledWith({
            multiple: false,
            directory: false,
            filters: [{ name: 'WebM 视频', extensions: ['webm'] }],
        });
    });

    it('leaves the current file alone when the picker is cancelled', async () => {
        mocks.open.mockResolvedValue(null);
        await expect(pickCustomWebmPath()).resolves.toBeNull();
        expect(mocks.invoke).not.toHaveBeenCalled();
    });

    it('propagates copy failure without returning the external source path', async () => {
        mocks.open.mockResolvedValue('/Videos/new.webm');
        mocks.invoke.mockRejectedValue(new Error('磁盘空间不足'));
        await expect(pickCustomWebmPath()).rejects.toThrow('磁盘空间不足');
    });

    it('validates and converts custom media through native commands', async () => {
        mocks.invoke
            .mockResolvedValueOnce({ ok: true, message: null })
            .mockResolvedValueOnce('/Users/xpy/Library/Caches/app/focus-end.mov');
        mocks.convertFileSrc.mockReturnValue('asset://localhost/focus-end.mov');

        await expect(validateCustomVideoPath('/Users/xpy/Videos/focus-end.webm'))
            .resolves.toEqual({ ok: true, message: null });
        await expect(customVideoSrc('/Users/xpy/Videos/focus-end.webm'))
            .resolves.toMatch(/^asset:\/\/localhost\/focus-end\.mov\?v=.+$/);
    });

    it('shows the native missing-file warning', async () => {
        await showCustomVideoMissingMessage('视频文件不存在，请重新选择');
        expect(mocks.message).toHaveBeenCalledWith('视频文件不存在，请重新选择', {
            title: '自定义视频不可用',
            kind: 'warning',
        });
    });
});
