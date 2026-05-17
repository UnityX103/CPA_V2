import { describe, expect, it } from 'vitest';
import {
    BUILTIN_POMODORO_VIDEOS,
    DEFAULT_BUILTIN_POMODORO_VIDEO_ID,
    getBuiltinPomodoroVideo,
} from './pomodoroVideos';

describe('pomodoro video registry', () => {
    it('registers 千千 as the default bundled video', () => {
        expect(DEFAULT_BUILTIN_POMODORO_VIDEO_ID).toBe('qianqian');

        const qianqian = getBuiltinPomodoroVideo('qianqian');
        expect(qianqian?.name).toBe('千千');
        expect(qianqian?.url).toBe('/videos/ms1-alpha.mov');
        expect(getBuiltinPomodoroVideo('missing')).toBeNull();
    });

    it('keeps built-in video ids unique', () => {
        const ids = BUILTIN_POMODORO_VIDEOS.map((video) => video.id);

        expect(new Set(ids).size).toBe(ids.length);
    });
});
