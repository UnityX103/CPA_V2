import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { message, open } from '@tauri-apps/plugin-dialog';

export interface CustomVideoPathValidation {
    readonly ok: boolean;
    readonly message: string | null;
}

export async function pickCustomWebmPath(): Promise<string | null> {
    const selected = await open({
        multiple: false,
        directory: false,
        filters: [{ name: 'WebM 视频', extensions: ['webm'] }],
    });

    return typeof selected === 'string' ? selected : null;
}

export async function validateCustomVideoPath(path: string): Promise<CustomVideoPathValidation> {
    return invoke<CustomVideoPathValidation>('validate_custom_video_path', { path });
}

export function customVideoSrc(path: string): string {
    return convertFileSrc(path);
}

export async function showCustomVideoMissingMessage(text: string): Promise<void> {
    await message(text, {
        title: '自定义视频不可用',
        kind: 'warning',
    });
}
