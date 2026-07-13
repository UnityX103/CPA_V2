import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { open } from '@tauri-apps/plugin-dialog';
import type { VideoProbe, VideoProcessRequest } from './videoEditor';
import { customVideoSrc } from './videoFiles';

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

export async function prepareVideoEditorResultPreview(path: string): Promise<string> {
    return customVideoSrc(path);
}

export async function prepareVideoEditorTempOutputPath(jobId: string): Promise<string> {
    return invoke<string>('prepare_video_editor_temp_output_path', { jobId });
}

export async function exportVideoEditorGeneratedOutput(
    generatedPath: string,
    inputPath: string,
): Promise<string | null> {
    return invoke<string | null>('export_video_editor_generated_output', {
        generatedPath,
        inputPath,
    });
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
