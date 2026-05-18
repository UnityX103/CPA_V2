export interface BuiltinPomodoroVideo {
    readonly id: string;
    readonly name: string;
    readonly macosUrl: string;
    readonly windowsUrl: string;
}

export interface PlayableBuiltinPomodoroVideo {
    readonly id: string;
    readonly name: string;
    readonly url: string;
}

export const DEFAULT_BUILTIN_POMODORO_VIDEO_ID = 'qianqian';

export const BUILTIN_POMODORO_VIDEOS: readonly BuiltinPomodoroVideo[] = [
    {
        id: DEFAULT_BUILTIN_POMODORO_VIDEO_ID,
        name: '千千',
        macosUrl: '/videos/ms1-alpha.mov',
        windowsUrl: '/videos/ms1.webm',
    },
];

function isWindowsRuntime(): boolean {
    if (typeof navigator === 'undefined') return false;
    return /\bWindows\b/i.test(navigator.userAgent);
}

export function getBuiltinPomodoroVideo(id: string): PlayableBuiltinPomodoroVideo | null {
    const video = BUILTIN_POMODORO_VIDEOS.find((candidate) => candidate.id === id);
    if (!video) return null;
    return {
        id: video.id,
        name: video.name,
        url: isWindowsRuntime() ? video.windowsUrl : video.macosUrl,
    };
}
