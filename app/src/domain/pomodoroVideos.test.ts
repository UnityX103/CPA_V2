import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    BUILTIN_POMODORO_VIDEOS,
    DEFAULT_BUILTIN_POMODORO_VIDEO_ID,
    getBuiltinPomodoroVideo,
} from './pomodoroVideos';

describe('pomodoro video registry', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('registers qianqian as the default bundled video', () => {
        expect(DEFAULT_BUILTIN_POMODORO_VIDEO_ID).toBe('qianqian');
        expect(getBuiltinPomodoroVideo('qianqian')).toEqual({
            id: 'qianqian',
            name: '千千',
            url: '/videos/ms1-alpha.mov',
        });
        expect(getBuiltinPomodoroVideo('missing')).toBeNull();
        expect(new Set(BUILTIN_POMODORO_VIDEOS.map((video) => video.id)).size)
            .toBe(BUILTIN_POMODORO_VIDEOS.length);
    });

    it('uses the bundled webm on Windows', () => {
        vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' });
        expect(getBuiltinPomodoroVideo('qianqian')?.url).toBe('/videos/ms1.webm');
    });
});
