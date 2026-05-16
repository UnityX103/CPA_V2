export interface BuiltinPomodoroVideo {
    id: string;
    name: string;
    url: string;
}

export const DEFAULT_BUILTIN_POMODORO_VIDEO_ID = 'qianqian';

export const BUILTIN_POMODORO_VIDEOS: BuiltinPomodoroVideo[] = [
    {
        id: DEFAULT_BUILTIN_POMODORO_VIDEO_ID,
        name: '千千',
        url: '/videos/ms1.webm',
    },
];

export function getBuiltinPomodoroVideo(id: string): BuiltinPomodoroVideo | null {
    return BUILTIN_POMODORO_VIDEOS.find((video) => video.id === id) ?? null;
}
