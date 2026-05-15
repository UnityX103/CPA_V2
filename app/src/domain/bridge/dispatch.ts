import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { EVT_DISPATCH, type DispatchPayload } from './protocol';

export async function dispatch(payload: DispatchPayload): Promise<void> {
    try {
        const w = await WebviewWindow.getByLabel('main');
        if (!w) return;
        await w.emit(EVT_DISPATCH, payload);
    } catch {
        /* swallow — settings window in non-Tauri/test env */
    }
}
