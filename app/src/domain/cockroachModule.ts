import { invoke } from '@tauri-apps/api/core';

export interface CockroachModuleSettings {
    readonly maxCount: number;
    readonly babyGrowthMinutes: number;
}

export interface CockroachModuleStatus {
    readonly installed: boolean;
    readonly running: boolean;
    readonly version: string | null;
    readonly target: string;
    readonly message: string;
    readonly settings: CockroachModuleSettings;
}

export function readCockroachModuleStatus(): Promise<CockroachModuleStatus> {
    return invoke<CockroachModuleStatus>('cockroach_module_status');
}

export function launchCockroachModule(settings: CockroachModuleSettings): Promise<CockroachModuleStatus> {
    return invoke<CockroachModuleStatus>('launch_cockroach_module', { settings });
}

export function saveCockroachModuleSettings(
    settings: CockroachModuleSettings,
): Promise<CockroachModuleStatus> {
    return invoke<CockroachModuleStatus>('save_cockroach_module_settings', { settings });
}

export function killAllCockroaches(): Promise<CockroachModuleStatus> {
    return invoke<CockroachModuleStatus>('kill_all_cockroaches');
}
