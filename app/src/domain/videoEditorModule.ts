import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

export interface VideoEditorModuleStatus {
    readonly installed: boolean;
    readonly version: string | null;
    readonly target: string;
    readonly message: string;
}

export interface VideoEditorModuleProgress {
    readonly stage: 'index' | 'download' | 'install' | 'complete';
    readonly downloadedBytes: number;
    readonly totalBytes: number | null;
    readonly message: string;
}

export function readVideoEditorModuleStatus(): Promise<VideoEditorModuleStatus> {
    return invoke<VideoEditorModuleStatus>('video_editor_module_status');
}

export function downloadVideoEditorModule(): Promise<VideoEditorModuleStatus> {
    return invoke<VideoEditorModuleStatus>('download_video_editor_module');
}

export function launchVideoEditorModule(): Promise<void> {
    return invoke<void>('launch_video_editor_module');
}

export function uninstallVideoEditorModule(): Promise<VideoEditorModuleStatus> {
    return invoke<VideoEditorModuleStatus>('uninstall_video_editor_module');
}

export function listenVideoEditorModuleProgress(
    listener: (progress: VideoEditorModuleProgress) => void,
): Promise<UnlistenFn> {
    return listen<VideoEditorModuleProgress>('video-editor-module-progress', (event) => {
        listener(event.payload);
    });
}

export function videoEditorModuleProgressText(progress: VideoEditorModuleProgress | null): string {
    if (!progress) return '';
    if (progress.stage === 'download' && progress.totalBytes && progress.totalBytes > 0) {
        const percent = Math.min(100, Math.floor(
            (progress.downloadedBytes / progress.totalBytes) * 100,
        ));
        return `${progress.message} · ${percent}%`;
    }
    return progress.message;
}
