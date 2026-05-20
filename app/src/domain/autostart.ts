import { disable, enable, isEnabled } from '@tauri-apps/plugin-autostart';

export async function readAutostartEnabled(fallback: boolean): Promise<boolean> {
    try {
        return await isEnabled();
    } catch (err) {
        console.warn('[autostart] read failed', err);
        return fallback;
    }
}

export async function applyAutostartEnabled(
    enabled: boolean,
    fallback: boolean,
): Promise<boolean> {
    try {
        if (enabled) {
            await enable();
        } else {
            await disable();
        }
        return await readAutostartEnabled(enabled);
    } catch (err) {
        console.warn('[autostart] apply failed', err);
        return readAutostartEnabled(fallback);
    }
}
