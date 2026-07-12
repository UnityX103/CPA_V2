import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { open, save } from '@tauri-apps/plugin-dialog';
import type { VideoProbe, VideoProcessRequest } from './videoEditor';

export interface VideoProcessResult {
    readonly outputPath: string;
}

export interface VideoEditorProgress {
    readonly jobId: string;
    readonly percent: number;
    readonly stage: string;
}

export interface VideoEditorRuntimeStatus {
    readonly ready: boolean;
    readonly message: string;
    readonly ffmpegPath?: string | null;
    readonly ffprobePath?: string | null;
    readonly backgroundRemoverPath?: string | null;
}

export async function pickVideoForEditing(): Promise<string | null> {
    const selected = await open({
        multiple: false,
        directory: false,
        filters: [{ name: '视频文件', extensions: ['mp4', 'mov', 'webm', 'm4v', 'ogv', 'ogg'] }],
    });
    return typeof selected === 'string' ? selected : null;
}

export async function probeVideoForEditing(path: string): Promise<VideoProbe> {
    return invoke<VideoProbe>('probe_video_for_editing', { path });
}

export function videoEditorPreviewSrc(path: string): string {
    return convertFileSrc(path);
}

export async function pickEditedVideoOutputPath(inputPath: string): Promise<string | null> {
    const filename = pathBasename(inputPath);
    const stem = filename.replace(/\.[^.]+$/, '') || 'edited-video';
    const selected = await save({
        defaultPath: `${stem}-transparent.webm`,
        filters: [{ name: '透明 WebM 视频', extensions: ['webm'] }],
    });
    return typeof selected === 'string' ? selected : null;
}

export async function processBackgroundRemovedVideo(
    request: VideoProcessRequest,
): Promise<VideoProcessResult> {
    return invoke<VideoProcessResult>('process_background_removed_video', { request });
}

export async function videoEditorRuntimeStatus(): Promise<VideoEditorRuntimeStatus> {
    return invoke<VideoEditorRuntimeStatus>('video_editor_runtime_status');
}

export async function listenVideoEditorProgress(
    handler: (progress: VideoEditorProgress) => void,
): Promise<UnlistenFn> {
    return listen<VideoEditorProgress>('video-editor-progress', (event) => handler(event.payload));
}

function pathBasename(path: string): string {
    return path.split(/[\\/]/).pop() || path;
}
