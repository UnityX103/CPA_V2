import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    customVideoSrc,
    pickCustomWebmPath,
    showCustomVideoMissingMessage,
    validateCustomVideoPath,
} from './videoFiles';

const {
    convertFileSrcMock,
    invokeMock,
    messageMock,
    openMock,
} = vi.hoisted(() => ({
    convertFileSrcMock: vi.fn(),
    invokeMock: vi.fn(),
    messageMock: vi.fn(),
    openMock: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({
    convertFileSrc: convertFileSrcMock,
    invoke: invokeMock,
}));

vi.mock('@tauri-apps/plugin-dialog', () => ({
    message: messageMock,
    open: openMock,
}));

describe('custom video file adapter', () => {
    beforeEach(() => {
        convertFileSrcMock.mockReset();
        invokeMock.mockReset();
        messageMock.mockReset();
        openMock.mockReset();
    });

    it('picks a single WebM file path with the expected dialog options', async () => {
        openMock.mockResolvedValue('/Users/xpy/movie.webm');

        await expect(pickCustomWebmPath()).resolves.toBe('/Users/xpy/movie.webm');
        expect(openMock).toHaveBeenCalledWith({
            multiple: false,
            directory: false,
            filters: [{ name: 'WebM 视频', extensions: ['webm'] }],
        });
    });

    it('returns null when picker is cancelled or does not return a single string path', async () => {
        openMock.mockResolvedValueOnce(null);
        await expect(pickCustomWebmPath()).resolves.toBeNull();

        openMock.mockResolvedValueOnce(['/Users/xpy/one.webm', '/Users/xpy/two.webm']);
        await expect(pickCustomWebmPath()).resolves.toBeNull();

        openMock.mockResolvedValueOnce(42);
        await expect(pickCustomWebmPath()).resolves.toBeNull();
    });

    it('validates a custom video path through the Rust command', async () => {
        invokeMock.mockResolvedValue({ ok: false, message: '只能选择 .webm 文件' });

        await expect(validateCustomVideoPath('/Users/xpy/movie.mp4')).resolves.toEqual({
            ok: false,
            message: '只能选择 .webm 文件',
        });
        expect(invokeMock).toHaveBeenCalledWith('validate_custom_video_path', {
            path: '/Users/xpy/movie.mp4',
        });
    });

    it('converts a custom video path into a media-safe Tauri src', () => {
        convertFileSrcMock.mockReturnValue('asset://localhost/Users/xpy/movie.webm');

        expect(customVideoSrc('/Users/xpy/movie.webm')).toBe('asset://localhost/Users/xpy/movie.webm');
        expect(convertFileSrcMock).toHaveBeenCalledWith('/Users/xpy/movie.webm');
    });

    it('shows a warning when the selected custom video is unavailable', async () => {
        messageMock.mockResolvedValue(undefined);

        await showCustomVideoMissingMessage('找不到自定义视频');

        expect(messageMock).toHaveBeenCalledWith('找不到自定义视频', {
            title: '自定义视频不可用',
            kind: 'warning',
        });
    });
});
