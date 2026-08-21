import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    customSoundSrc,
    pickCustomMp3Path,
    showCustomSoundMissingMessage,
    validateCustomSoundPath,
} from './soundFiles';

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

describe('custom sound file adapter', () => {
    beforeEach(() => Object.values(mocks).forEach((mock) => mock.mockReset()));

    it('picks a single MP3 path', async () => {
        mocks.open.mockResolvedValue('/Users/xpy/Music/focus-end.mp3');

        await expect(pickCustomMp3Path()).resolves.toBe('/Users/xpy/Music/focus-end.mp3');
        expect(mocks.open).toHaveBeenCalledWith({
            multiple: false,
            directory: false,
            filters: [{ name: 'MP3 音频', extensions: ['mp3'] }],
        });
    });

    it('validates, authorizes, and converts custom audio through native commands', async () => {
        mocks.invoke
            .mockResolvedValueOnce({ ok: true, message: null })
            .mockResolvedValueOnce('/Users/xpy/Music/focus-end.mp3');
        mocks.convertFileSrc.mockReturnValue('asset://localhost/focus-end.mp3');

        await expect(validateCustomSoundPath('/Users/xpy/Music/focus-end.mp3'))
            .resolves.toEqual({ ok: true, message: null });
        await expect(customSoundSrc('/Users/xpy/Music/focus-end.mp3'))
            .resolves.toBe('asset://localhost/focus-end.mp3');
        expect(mocks.invoke).toHaveBeenNthCalledWith(1, 'validate_custom_sound_path', {
            path: '/Users/xpy/Music/focus-end.mp3',
        });
        expect(mocks.invoke).toHaveBeenNthCalledWith(2, 'prepare_custom_sound_path', {
            path: '/Users/xpy/Music/focus-end.mp3',
        });
    });

    it('shows the native missing-file warning', async () => {
        await showCustomSoundMissingMessage('铃声文件不存在，请重新选择');
        expect(mocks.message).toHaveBeenCalledWith('铃声文件不存在，请重新选择', {
            title: '自定义铃声不可用',
            kind: 'warning',
        });
    });
});
