import { describe, expect, it, vi } from 'vitest';
import { resolvePomodoroEndAction, type PomodoroEndActionRuntime } from './pomodoroEndAction';

function runtime(): PomodoroEndActionRuntime {
    return {
        validateCustomVideoPath: vi.fn(),
        customVideoSrc: vi.fn(),
        showCustomVideoMissingMessage: vi.fn(),
    };
}

describe('pomodoro end action resolver', () => {
    it('resolves the bundled qianqian video', async () => {
        await expect(resolvePomodoroEndAction({
            endActionMode: 'playVideo',
            endActionVideo: {
                sourceKind: 'builtin',
                builtinVideoId: 'qianqian',
                customVideoPath: '',
            },
        }, runtime())).resolves.toEqual({
            kind: 'video',
            title: '千千',
            src: '/videos/ms1-alpha.mov',
        });
    });

    it('validates and resolves a custom video path', async () => {
        const deps = runtime();
        vi.mocked(deps.validateCustomVideoPath).mockResolvedValue({ ok: true, message: null });
        vi.mocked(deps.customVideoSrc).mockResolvedValue('asset://localhost/focus-end.mov');

        await expect(resolvePomodoroEndAction({
            endActionMode: 'playVideo',
            endActionVideo: {
                sourceKind: 'custom',
                builtinVideoId: 'qianqian',
                customVideoPath: '/Users/xpy/Videos/focus-end.webm',
            },
        }, deps)).resolves.toEqual({
            kind: 'video',
            title: 'focus-end.webm',
            src: 'asset://localhost/focus-end.mov',
        });
    });

    it('warns and falls back to the top prompt when a custom file is unavailable', async () => {
        const deps = runtime();
        vi.mocked(deps.validateCustomVideoPath).mockResolvedValue({
            ok: false,
            message: '视频文件不存在，请重新选择',
        });

        await expect(resolvePomodoroEndAction({
            endActionMode: 'playVideo',
            endActionVideo: {
                sourceKind: 'custom',
                builtinVideoId: 'qianqian',
                customVideoPath: '/Users/xpy/Videos/missing.webm',
            },
        }, deps)).resolves.toEqual({ kind: 'topWindow' });
        expect(deps.showCustomVideoMissingMessage)
            .toHaveBeenCalledWith('视频文件不存在，请重新选择');
    });
});
