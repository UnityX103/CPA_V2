import type { PomodoroState } from './pomodoro';
import { getBuiltinPomodoroVideo } from './pomodoroVideos';
import type { CustomVideoValidation } from './videoFiles';

type MaybePromise<T> = T | Promise<T>;

export type PomodoroEndActionState = Pick<PomodoroState, 'endActionMode' | 'endActionVideo'>;

export type PomodoroEndActionResolution =
    | { kind: 'topWindow' }
    | { kind: 'video'; src: string; title: string };

export interface PomodoroEndActionRuntime {
    validateCustomVideoPath: (path: string) => MaybePromise<CustomVideoValidation>;
    customVideoSrc: (path: string) => MaybePromise<string>;
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
    if (!validation.ok) {
        await runtime.showCustomVideoMissingMessage(validation.message || '自定义视频不可用');
        return { kind: 'topWindow' };
    }

    try {
        return {
            kind: 'video',
            src: await runtime.customVideoSrc(path),
            title: basename(path) || '自定义视频',
        };
    } catch (error) {
        const message = error instanceof Error ? error.message : '自定义视频转换失败';
        await runtime.showCustomVideoMissingMessage(message);
        return { kind: 'topWindow' };
    }
}

function basename(path: string): string {
    return path.split(/[\\/]/).pop() ?? '';
}
