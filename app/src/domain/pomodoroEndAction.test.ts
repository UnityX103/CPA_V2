import { describe, expect, it, vi } from 'vitest';
import { resolvePomodoroEndAction, type PomodoroEndActionRuntime } from './pomodoroEndAction';
import type { PomodoroEndActionMode, PomodoroEndActionVideo } from './pomodoro';

function makeState(
    endActionMode: PomodoroEndActionMode,
    endActionVideo: PomodoroEndActionVideo,
) {
    return { endActionMode, endActionVideo };
}

function makeRuntime(): PomodoroEndActionRuntime {
    return {
        validateCustomVideoPath: vi.fn(),
        customVideoSrc: vi.fn(),
        showCustomVideoMissingMessage: vi.fn(),
    };
}

describe('pomodoro end-action resolver', () => {
    it('returns topWindow for topWindow mode without calling runtime hooks', async () => {
        const runtime = makeRuntime();

        await expect(resolvePomodoroEndAction(makeState('topWindow', {
            sourceKind: 'custom',
            builtinVideoId: 'qianqian',
            customVideoPath: '/Users/xpy/Videos/end.webm',
        }), runtime)).resolves.toEqual({ kind: 'topWindow' });

        expect(runtime.validateCustomVideoPath).not.toHaveBeenCalled();
        expect(runtime.customVideoSrc).not.toHaveBeenCalled();
        expect(runtime.showCustomVideoMissingMessage).not.toHaveBeenCalled();
    });

    it('resolves builtin qianqian to its playable video URL and title', async () => {
        const runtime = makeRuntime();

        await expect(resolvePomodoroEndAction(makeState('playVideo', {
            sourceKind: 'builtin',
            builtinVideoId: 'qianqian',
            customVideoPath: '',
        }), runtime)).resolves.toEqual({
            kind: 'video',
            src: '/videos/ms1-alpha.mov',
            title: '千千',
        });
    });

    it('falls back to topWindow when the configured builtin video is missing', async () => {
        const runtime = makeRuntime();

        await expect(resolvePomodoroEndAction(makeState('playVideo', {
            sourceKind: 'builtin',
            builtinVideoId: 'missing',
            customVideoPath: '',
        }), runtime)).resolves.toEqual({ kind: 'topWindow' });

        expect(runtime.validateCustomVideoPath).not.toHaveBeenCalled();
        expect(runtime.customVideoSrc).not.toHaveBeenCalled();
        expect(runtime.showCustomVideoMissingMessage).not.toHaveBeenCalled();
    });

    it('validates a custom video path and resolves it with a basename title', async () => {
        const runtime = makeRuntime();
        vi.mocked(runtime.validateCustomVideoPath).mockResolvedValue({ ok: true, message: null });
        vi.mocked(runtime.customVideoSrc).mockResolvedValue('asset://localhost/Users/xpy/Library/Caches/app/focus-end.mov');

        await expect(resolvePomodoroEndAction(makeState('playVideo', {
            sourceKind: 'custom',
            builtinVideoId: 'qianqian',
            customVideoPath: '/Users/xpy/Videos/focus-end.webm',
        }), runtime)).resolves.toEqual({
            kind: 'video',
            src: 'asset://localhost/Users/xpy/Library/Caches/app/focus-end.mov',
            title: 'focus-end.webm',
        });

        expect(runtime.validateCustomVideoPath).toHaveBeenCalledWith('/Users/xpy/Videos/focus-end.webm');
        expect(runtime.customVideoSrc).toHaveBeenCalledWith('/Users/xpy/Videos/focus-end.webm');
        expect(runtime.showCustomVideoMissingMessage).not.toHaveBeenCalled();
    });

    it('shows the missing custom video message and falls back to topWindow when custom validation fails', async () => {
        const runtime = makeRuntime();
        vi.mocked(runtime.validateCustomVideoPath).mockResolvedValue({ ok: false, message: '文件不存在' });

        await expect(resolvePomodoroEndAction(makeState('playVideo', {
            sourceKind: 'custom',
            builtinVideoId: 'qianqian',
            customVideoPath: '/Users/xpy/Videos/missing.webm',
        }), runtime)).resolves.toEqual({ kind: 'topWindow' });

        expect(runtime.showCustomVideoMissingMessage).toHaveBeenCalledWith('文件不存在');
        expect(runtime.customVideoSrc).not.toHaveBeenCalled();
    });

    it('shows a conversion message and falls back to topWindow when custom alpha preparation fails', async () => {
        const runtime = makeRuntime();
        vi.mocked(runtime.validateCustomVideoPath).mockResolvedValue({ ok: true, message: null });
        vi.mocked(runtime.customVideoSrc).mockRejectedValue(new Error('透明 WebM 转换失败'));

        await expect(resolvePomodoroEndAction(makeState('playVideo', {
            sourceKind: 'custom',
            builtinVideoId: 'qianqian',
            customVideoPath: '/Users/xpy/Videos/focus-end.webm',
        }), runtime)).resolves.toEqual({ kind: 'topWindow' });

        expect(runtime.showCustomVideoMissingMessage).toHaveBeenCalledWith('透明 WebM 转换失败');
    });

    it('falls back to topWindow for empty custom paths without validation or messages', async () => {
        const runtime = makeRuntime();

        await expect(resolvePomodoroEndAction(makeState('playVideo', {
            sourceKind: 'custom',
            builtinVideoId: 'qianqian',
            customVideoPath: '',
        }), runtime)).resolves.toEqual({ kind: 'topWindow' });

        expect(runtime.validateCustomVideoPath).not.toHaveBeenCalled();
        expect(runtime.customVideoSrc).not.toHaveBeenCalled();
        expect(runtime.showCustomVideoMissingMessage).not.toHaveBeenCalled();
    });
});
