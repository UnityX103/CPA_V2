import { invoke } from '@tauri-apps/api/core';

export interface VideoEditorModuleStatus {
    readonly installed: boolean;
    readonly version: string | null;
    readonly target: string;
    readonly message: string;
}

export function readVideoEditorModuleStatus(): Promise<VideoEditorModuleStatus> {
    return invoke<VideoEditorModuleStatus>('video_editor_module_status');
}

export function launchVideoEditorModule(): Promise<void> {
    return invoke<void>('launch_video_editor_module');
}
