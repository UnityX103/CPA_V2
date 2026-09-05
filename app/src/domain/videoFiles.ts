import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { message, open } from '@tauri-apps/plugin-dialog';

export interface CustomVideoValidation {
    readonly ok: boolean;
    readonly message: string | null;
}

export async function pickCustomWebmPath(): Promise<string | null> {
    const selected = await open({
        multiple: false,
        directory: false,
        filters: [{ name: 'WebM 视频', extensions: ['webm'] }],
    });

    if (typeof selected !== 'string') return null;
    return invoke<string>('import_custom_video', { path: selected });
}

export async function validateCustomVideoPath(path: string): Promise<CustomVideoValidation> {
    return invoke<CustomVideoValidation>('validate_custom_video_path', { path });
}

export async function customVideoSrc(path: string): Promise<string> {
    const playablePath = await invoke<string>('prepare_custom_alpha_video_path', { path });
    // The app-owned file has a stable path but its contents change on replacement.
    return `${convertFileSrc(playablePath)}?v=${crypto.randomUUID()}`;
}

export async function showCustomVideoMissingMessage(text: string): Promise<void> {
    await message(text, {
        title: '自定义视频不可用',
        kind: 'warning',
    });
}
