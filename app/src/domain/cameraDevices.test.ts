import { beforeEach, describe, expect, it, vi } from 'vitest';
import { listCameraDevices } from './cameraDevices';

const invoke = vi.hoisted(() => vi.fn());

vi.mock('@tauri-apps/api/core', () => ({ invoke }));

describe('camera device adapter', () => {
    beforeEach(() => invoke.mockReset());

    it('lists native camera devices', async () => {
        invoke.mockResolvedValue([
            { id: 'camera-built-in', name: 'FaceTime HD Camera', isDefault: true },
            { id: 'camera-usb', name: 'USB Camera', isDefault: false },
        ]);

        await expect(listCameraDevices()).resolves.toEqual([
            { id: 'camera-built-in', name: 'FaceTime HD Camera', isDefault: true },
            { id: 'camera-usb', name: 'USB Camera', isDefault: false },
        ]);
        expect(invoke).toHaveBeenCalledWith('list_camera_devices');
    });
});
