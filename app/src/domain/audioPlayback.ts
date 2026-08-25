import { invoke } from '@tauri-apps/api/core';
import { useSettingsStore } from './settings';

export interface AudioOutputDevice {
    readonly id: string;
    readonly name: string;
    readonly isDefault: boolean;
}

export type SoundSource =
    | { readonly kind: 'builtin'; readonly id: string }
    | { readonly kind: 'custom'; readonly path: string };

interface AudioPlaybackResult {
    readonly fellBackToDefault: boolean;
}

export async function listAudioOutputDevices(): Promise<AudioOutputDevice[]> {
    const devices = await invoke<AudioOutputDevice[]>('list_audio_output_devices');
    return Array.isArray(devices) ? devices : [];
}

export async function playSound(source: SoundSource): Promise<void> {
    const { audioOutputDeviceId, soundVolume } = useSettingsStore.getState();
    const result = await invoke<AudioPlaybackResult>('play_sound', {
        request: {
            source,
            outputDeviceId: audioOutputDeviceId,
            volume: soundVolume,
        },
    });
    if (result?.fellBackToDefault) {
        console.warn('[audio] selected output device is unavailable; using the system default');
    }
}
