import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

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

export interface CockroachModuleProgress {
    readonly stage: 'index' | 'download' | 'install' | 'complete';
    readonly downloadedBytes: number;
    readonly totalBytes: number | null;
    readonly message: string;
}

export function readCockroachModuleStatus(): Promise<CockroachModuleStatus> {
    return invoke<CockroachModuleStatus>('cockroach_module_status');
}

export function downloadCockroachModule(): Promise<CockroachModuleStatus> {
    return invoke<CockroachModuleStatus>('download_cockroach_module');
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

export function uninstallCockroachModule(): Promise<CockroachModuleStatus> {
    return invoke<CockroachModuleStatus>('uninstall_cockroach_module');
}

export function listenCockroachModuleProgress(
    listener: (progress: CockroachModuleProgress) => void,
): Promise<UnlistenFn> {
    return listen<CockroachModuleProgress>('cockroach-module-progress', (event) => {
        listener(event.payload);
    });
}

export function cockroachModuleProgressText(progress: CockroachModuleProgress | null): string {
    if (!progress) return '';
    if (progress.stage === 'download' && progress.totalBytes && progress.totalBytes > 0) {
        const percent = Math.min(100, Math.floor(
            (progress.downloadedBytes / progress.totalBytes) * 100,
        ));
        return `${progress.message} · ${percent}%`;
    }
    return progress.message;
}
