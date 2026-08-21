import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { message, open } from '@tauri-apps/plugin-dialog';

export interface CustomSoundValidation {
    readonly ok: boolean;
    readonly message: string | null;
}

export async function pickCustomMp3Path(): Promise<string | null> {
    const selected = await open({
        multiple: false,
        directory: false,
        filters: [{ name: 'MP3 音频', extensions: ['mp3'] }],
    });

    return typeof selected === 'string' ? selected : null;
}

export async function validateCustomSoundPath(path: string): Promise<CustomSoundValidation> {
    return invoke<CustomSoundValidation>('validate_custom_sound_path', { path });
}

export async function customSoundSrc(path: string): Promise<string> {
    const playablePath = await invoke<string>('prepare_custom_sound_path', { path });
    return convertFileSrc(playablePath);
}

export async function showCustomSoundMissingMessage(text: string): Promise<void> {
    await message(text, {
        title: '自定义铃声不可用',
        kind: 'warning',
    });
}
