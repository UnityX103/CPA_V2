import { invoke } from '@tauri-apps/api/core';
import { normalizeKegelSettings, type KegelSettings } from './domain/kegel';
import { normalizeKegelHistory, type KegelRecord } from './domain/kegelHistory';
export interface KegelPreferences { settings: KegelSettings; history: KegelRecord[]; }
export async function loadKegelPreferences(): Promise<KegelPreferences> {
    const value = await invoke<KegelPreferences>('kegel_module_preferences');
    return { settings: normalizeKegelSettings({ ...value.settings, enabled: true }), history: normalizeKegelHistory(value.history) };
}
export async function saveKegelSettings(settings: KegelSettings): Promise<void> {
    await invoke('save_kegel_module_settings', { settings });
}
export async function saveKegelHistory(history: KegelRecord[]): Promise<void> {
    await invoke('save_kegel_module_history', { history });
}
