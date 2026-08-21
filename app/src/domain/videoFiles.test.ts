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

    it('picks a single webm path', async () => {
        mocks.open.mockResolvedValue('/Users/xpy/Videos/focus-end.webm');
        await expect(pickCustomWebmPath()).resolves.toBe('/Users/xpy/Videos/focus-end.webm');
        expect(mocks.open).toHaveBeenCalledWith({
            multiple: false,
            directory: false,
            filters: [{ name: 'WebM 视频', extensions: ['webm'] }],
        });
    });

    it('validates and converts custom media through native commands', async () => {
        mocks.invoke
            .mockResolvedValueOnce({ ok: true, message: null })
            .mockResolvedValueOnce('/Users/xpy/Library/Caches/app/focus-end.mov');
        mocks.convertFileSrc.mockReturnValue('asset://localhost/focus-end.mov');

        await expect(validateCustomVideoPath('/Users/xpy/Videos/focus-end.webm'))
            .resolves.toEqual({ ok: true, message: null });
        await expect(customVideoSrc('/Users/xpy/Videos/focus-end.webm'))
            .resolves.toBe('asset://localhost/focus-end.mov');
    });

    it('shows the native missing-file warning', async () => {
        await showCustomVideoMissingMessage('视频文件不存在，请重新选择');
        expect(mocks.message).toHaveBeenCalledWith('视频文件不存在，请重新选择', {
            title: '自定义视频不可用',
            kind: 'warning',
        });
    });
});
