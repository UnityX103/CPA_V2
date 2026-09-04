import { invoke } from '@tauri-apps/api/core';

export interface CameraDevice {
    id: string;
    name: string;
    isDefault: boolean;
}

export async function listCameraDevices(): Promise<CameraDevice[]> {
    const devices = await invoke<CameraDevice[]>('list_camera_devices');
    return Array.isArray(devices) ? devices : [];
}
