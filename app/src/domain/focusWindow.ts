import { invoke } from '@tauri-apps/api/core';

export type FocusableAppWindowLabel = 'main';

export async function focusAppWindow(label: FocusableAppWindowLabel): Promise<void> {
    await invoke('focus_app_window', { label });
}
