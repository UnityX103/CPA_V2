import { describe, expect, it } from 'vitest';
import {
    BUILTIN_POMODORO_VIDEOS,
    DEFAULT_BUILTIN_POMODORO_VIDEO_ID,
    getBuiltinPomodoroVideo,
} from './pomodoroVideos';

describe('pomodoro video registry', () => {
    it('registers 千千 as the default bundled video', () => {
        expect(DEFAULT_BUILTIN_POMODORO_VIDEO_ID).toBe('qianqian');
        expect(BUILTIN_POMODORO_VIDEOS).toEqual([
            {
                id: 'qianqian',
                name: '千千',
                url: '/videos/ms1.webm',
            },
        ]);
        expect(getBuiltinPomodoroVideo('qianqian')?.name).toBe('千千');
        expect(getBuiltinPomodoroVideo('missing')).toBeNull();
    });
});
