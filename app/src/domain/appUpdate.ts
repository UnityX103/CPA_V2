import { create, type StoreApi, type UseBoundStore } from 'zustand';
import { check, type Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { getVersion } from '@tauri-apps/api/app';
import {
    loadPersistedAppUpdateSettings,
    savePersistedAppUpdateSettings,
    type PersistedAppUpdateSettings,
} from './appUpdatePersistence';
import { dispatch } from './bridge/dispatch';
import { BRIDGE_VERSION } from './bridge/protocol';

export const APP_UPDATE_STARTUP_DELAY_MS = 30_000;
export const APP_UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

export type AppUpdateStatus =
    | 'idle'
    | 'checking'
    | 'upToDate'
    | 'downloading'
    | 'installing'
    | 'readyToRestart'
    | 'disabled'
    | 'error';

export interface AppUpdateSnapshot {
    autoUpdateEnabled: boolean;
    status: AppUpdateStatus;
    currentVersion: string | null;
    availableVersion: string | null;
    releaseNotes: string | null;
    lastCheckedAt: number | null;
    errorMessage: string | null;
}

type UpdaterUpdate = Pick<Update, 'version' | 'currentVersion' | 'body' | 'date' | 'downloadAndInstall'>;
type TimerId = number;

export interface AppUpdateDeps {
    checkForUpdate: () => Promise<UpdaterUpdate | null>;
    relaunchApp: () => Promise<void>;
    getVersion: () => Promise<string>;
    loadSettings: () => Promise<PersistedAppUpdateSettings>;
    saveSettings: (settings: PersistedAppUpdateSettings) => Promise<void>;
    isReleaseBuild: () => boolean;
    setTimeoutFn: (fn: () => void, ms: number) => TimerId;
    clearTimeoutFn: (id: TimerId) => void;
    setIntervalFn: (fn: () => void, ms: number) => TimerId;
    clearIntervalFn: (id: TimerId) => void;
    now: () => number;
}

interface AppUpdateActions {
    hydrate: () => Promise<void>;
    setAutoUpdateEnabled: (enabled: boolean) => Promise<void>;
    checkNow: () => Promise<void>;
    startAutomaticChecks: () => () => void;
    restartForUpdate: () => Promise<void>;
    applySnapshot: (snapshot: AppUpdateSnapshot) => void;
}

export type AppUpdateStore = UseBoundStore<StoreApi<AppUpdateSnapshot & AppUpdateActions>>;

function defaultIsReleaseBuild(): boolean {
    return import.meta.env.PROD;
}

function errorToMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}

function createDefaultDeps(): AppUpdateDeps {
    return {
        checkForUpdate: () => check(),
        relaunchApp: () => relaunch(),
        getVersion,
        loadSettings: loadPersistedAppUpdateSettings,
        saveSettings: savePersistedAppUpdateSettings,
        isReleaseBuild: defaultIsReleaseBuild,
        setTimeoutFn: window.setTimeout.bind(window),
        clearTimeoutFn: window.clearTimeout.bind(window),
        setIntervalFn: window.setInterval.bind(window),
        clearIntervalFn: window.clearInterval.bind(window),
        now: () => Date.now(),
    };
}

function appUpdateDispatchPayload(action: 'checkNow' | 'restartForUpdate') {
    return { v: BRIDGE_VERSION, store: 'appUpdate', action, args: [] } as unknown as Parameters<typeof dispatch>[0];
}

function appUpdateTogglePayload(enabled: boolean) {
    return {
        v: BRIDGE_VERSION,
        store: 'appUpdate',
        action: 'setAutoUpdateEnabled',
        args: [enabled],
    } as unknown as Parameters<typeof dispatch>[0];
}

export function createAppUpdateStore(deps: AppUpdateDeps): AppUpdateStore {
    let inFlight: Promise<void> | null = null;
    return create<AppUpdateSnapshot & AppUpdateActions>((set, get) => ({
        autoUpdateEnabled: true,
        status: 'idle',
        currentVersion: null,
        availableVersion: null,
        releaseNotes: null,
        lastCheckedAt: null,
        errorMessage: null,
        hydrate: async () => {
            const [settings, currentVersion] = await Promise.all([
                deps.loadSettings(),
                deps.getVersion().catch(() => null),
            ]);
            const status = get().status;
            set({
                autoUpdateEnabled: settings.autoUpdateEnabled,
                currentVersion,
                status: status === 'readyToRestart' ? status : settings.autoUpdateEnabled ? status : 'disabled',
            });
        },
        setAutoUpdateEnabled: async (enabled) => {
            const status = get().status;
            set({
                autoUpdateEnabled: enabled,
                status: status === 'readyToRestart' ? status : enabled ? 'idle' : 'disabled',
                errorMessage: null,
            });
            await deps.saveSettings({ autoUpdateEnabled: enabled });
        },
        checkNow: async () => {
            if (inFlight) return inFlight;
            if (get().status === 'readyToRestart') return;
            if (!get().autoUpdateEnabled) {
                set({ status: 'disabled', errorMessage: null });
                return;
            }
            inFlight = (async () => {
                try {
                    set({ status: 'checking', errorMessage: null });
                    const update = await deps.checkForUpdate();
                    const stateAfterCheck = get();
                    if (stateAfterCheck.status === 'readyToRestart') return;
                    if (!stateAfterCheck.autoUpdateEnabled) {
                        set({ status: 'disabled', errorMessage: null });
                        return;
                    }
                    const checkedAt = deps.now();
                    if (!update) {
                        set({
                            status: 'upToDate',
                            lastCheckedAt: checkedAt,
                            availableVersion: null,
                            releaseNotes: null,
                            errorMessage: null,
                        });
                        return;
                    }
                    set({
                        status: 'downloading',
                        currentVersion: update.currentVersion,
                        availableVersion: update.version,
                        releaseNotes: update.body ?? null,
                        lastCheckedAt: checkedAt,
                    });
                    await update.downloadAndInstall(() => {});
                    set({ status: 'readyToRestart', errorMessage: null });
                } catch (err) {
                    const stateAfterError = get();
                    if (stateAfterError.status === 'readyToRestart') return;
                    if (!stateAfterError.autoUpdateEnabled || stateAfterError.status === 'disabled') {
                        set({ status: 'disabled', errorMessage: null });
                        return;
                    }
                    set({ status: 'error', errorMessage: errorToMessage(err), lastCheckedAt: deps.now() });
                } finally {
                    inFlight = null;
                }
            })();
            return inFlight;
        },
        startAutomaticChecks: () => {
            if (!deps.isReleaseBuild()) return () => {};
            const timeoutId = deps.setTimeoutFn(() => { void get().checkNow(); }, APP_UPDATE_STARTUP_DELAY_MS);
            const intervalId = deps.setIntervalFn(() => { void get().checkNow(); }, APP_UPDATE_CHECK_INTERVAL_MS);
            return () => {
                deps.clearTimeoutFn(timeoutId);
                deps.clearIntervalFn(intervalId);
            };
        },
        restartForUpdate: async () => {
            if (get().status !== 'readyToRestart') return;
            await deps.relaunchApp();
        },
        applySnapshot: (snapshot) => {
            set({ ...snapshot });
        },
    }));
}

function detectIsMirrorWindow(): boolean {
    if (typeof window === 'undefined') return false;
    const which = new URLSearchParams(window.location.search).get('window');
    return which === 'settings' || which === 'input-counter';
}

const appUpdateStore = createAppUpdateStore(createDefaultDeps());

if (detectIsMirrorWindow()) {
    appUpdateStore.setState({
        setAutoUpdateEnabled: async (enabled) => {
            await dispatch(appUpdateTogglePayload(enabled));
        },
        checkNow: async () => {
            await dispatch(appUpdateDispatchPayload('checkNow'));
        },
        restartForUpdate: async () => {
            await dispatch(appUpdateDispatchPayload('restartForUpdate'));
        },
    });
}

export const useAppUpdateStore: AppUpdateStore = appUpdateStore;
