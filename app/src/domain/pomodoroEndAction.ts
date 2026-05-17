import type { PomodoroState } from './pomodoro';
import { getBuiltinPomodoroVideo } from './pomodoroVideos';

type MaybePromise<T> = T | Promise<T>;

export type PomodoroEndActionState = Pick<PomodoroState, 'endActionMode' | 'endActionVideo'>;

export type PomodoroEndActionResolution =
    | { kind: 'topWindow' }
    | { kind: 'video'; src: string; title: string };

export interface PomodoroEndActionRuntime {
    validateCustomVideoPath: (path: string) => MaybePromise<{
        readonly valid: boolean;
        readonly message?: string | null;
    }>;
    customVideoSrc: (path: string) => string;
    showCustomVideoMissingMessage: (message: string) => MaybePromise<void>;
}

export async function resolvePomodoroEndAction(
    state: PomodoroEndActionState,
    runtime: PomodoroEndActionRuntime,
): Promise<PomodoroEndActionResolution> {
    if (state.endActionMode === 'topWindow') {
        return { kind: 'topWindow' };
    }

    const video = state.endActionVideo;
    if (video.sourceKind === 'builtin') {
        const builtinVideo = getBuiltinPomodoroVideo(video.builtinVideoId);
        if (!builtinVideo) {
            return { kind: 'topWindow' };
        }
        return {
            kind: 'video',
            src: builtinVideo.url,
            title: builtinVideo.name,
        };
    }

    const path = video.customVideoPath;
    if (!path) {
        return { kind: 'topWindow' };
    }

    const validation = await runtime.validateCustomVideoPath(path);
    if (!validation.valid) {
        await runtime.showCustomVideoMissingMessage(validation.message || '自定义视频不可用');
        return { kind: 'topWindow' };
    }

    return {
        kind: 'video',
        src: runtime.customVideoSrc(path),
        title: basename(path) || '自定义视频',
    };
}

function basename(path: string): string {
    return path.split(/[\\/]/).pop() ?? '';
}
