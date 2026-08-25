import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSettingsStore } from './settings';
import {
    listAudioOutputDevices,
    playSound,
} from './audioPlayback';

const invoke = vi.hoisted(() => vi.fn());

vi.mock('@tauri-apps/api/core', () => ({ invoke }));

describe('native audio playback adapter', () => {
    beforeEach(() => {
        invoke.mockReset();
        useSettingsStore.setState({
            audioOutputDeviceId: 'coreaudio:built-in-output',
            soundVolume: 0.65,
        });
    });

    it('lists native output devices', async () => {
        invoke.mockResolvedValue([
            { id: 'coreaudio:built-in-output', name: 'MacBook Pro 扬声器', isDefault: true },
        ]);

        await expect(listAudioOutputDevices()).resolves.toEqual([
            { id: 'coreaudio:built-in-output', name: 'MacBook Pro 扬声器', isDefault: true },
        ]);
        expect(invoke).toHaveBeenCalledWith('list_audio_output_devices');
    });

    it('plays through the selected device at the global volume', async () => {
        invoke.mockResolvedValue({ fellBackToDefault: false });

        await playSound({ kind: 'builtin', id: 'clear-success' });

        expect(invoke).toHaveBeenCalledWith('play_sound', {
            request: {
                source: { kind: 'builtin', id: 'clear-success' },
                outputDeviceId: 'coreaudio:built-in-output',
                volume: 0.65,
            },
        });
    });
});
