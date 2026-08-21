import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DownloadEvent } from '@tauri-apps/plugin-updater';
import {
    APP_UPDATE_CHECK_INTERVAL_MS,
    APP_UPDATE_STARTUP_DELAY_MS,
    createAppUpdateStore,
    type AppUpdateDeps,
} from './appUpdate';

function deps(overrides: Partial<AppUpdateDeps> = {}): AppUpdateDeps {
    return {
        checkForUpdate: vi.fn(async () => null),
        relaunchApp: vi.fn(async () => {}),
        getVersion: vi.fn(async () => '0.1.0'),
        loadSettings: vi.fn(async () => ({ autoUpdateEnabled: true })),
        saveSettings: vi.fn(async () => {}),
        isReleaseBuild: () => true,
        setTimeoutFn: vi.fn((_fn: () => void, _ms: number) => 1),
        clearTimeoutFn: vi.fn(),
        setIntervalFn: vi.fn((_fn: () => void, _ms: number) => 2),
        clearIntervalFn: vi.fn(),
        now: () => 1_700_000_000_000,
        ...overrides,
    };
}

beforeEach(() => {
    vi.restoreAllMocks();
});

describe('app update store', () => {
    it('defaults automatic updates to enabled', () => {
        const store = createAppUpdateStore(deps());
        expect(store.getState().autoUpdateEnabled).toBe(true);
        expect(store.getState().status).toBe('idle');
    });

    it('hydrates persisted disabled setting', async () => {
        const store = createAppUpdateStore(deps({
            loadSettings: vi.fn(async () => ({ autoUpdateEnabled: false })),
        }));
        await store.getState().hydrate();
        expect(store.getState().autoUpdateEnabled).toBe(false);
        expect(store.getState().status).toBe('disabled');
    });

    it('hydrates settings without leaving readyToRestart', async () => {
        const store = createAppUpdateStore(deps({
            getVersion: vi.fn(async () => '0.1.2'),
            loadSettings: vi.fn(async () => ({ autoUpdateEnabled: false })),
        }));
        store.setState({ status: 'readyToRestart' });

        await store.getState().hydrate();

        expect(store.getState().autoUpdateEnabled).toBe(false);
        expect(store.getState().currentVersion).toBe('0.1.2');
        expect(store.getState().status).toBe('readyToRestart');
    });

    it('persists automatic update toggle', async () => {
        const saveSettings = vi.fn(async () => {});
        const store = createAppUpdateStore(deps({ saveSettings }));
        await store.getState().setAutoUpdateEnabled(false);
        expect(store.getState().autoUpdateEnabled).toBe(false);
        expect(store.getState().status).toBe('disabled');
        expect(saveSettings).toHaveBeenCalledWith({ autoUpdateEnabled: false });
    });

    it('persists automatic update toggle without leaving readyToRestart', async () => {
        const saveSettings = vi.fn(async () => {});
        const store = createAppUpdateStore(deps({ saveSettings }));
        store.setState({ status: 'readyToRestart' });

        await store.getState().setAutoUpdateEnabled(false);

        expect(store.getState().autoUpdateEnabled).toBe(false);
        expect(store.getState().status).toBe('readyToRestart');
        expect(saveSettings).toHaveBeenCalledWith({ autoUpdateEnabled: false });
    });

    it('skips checks when disabled', async () => {
        const checkForUpdate = vi.fn(async () => null);
        const store = createAppUpdateStore(deps({ checkForUpdate }));
        await store.getState().setAutoUpdateEnabled(false);
        await store.getState().checkNow();
        expect(checkForUpdate).not.toHaveBeenCalled();
        expect(store.getState().status).toBe('disabled');
    });

    it('skips checks when ready to restart', async () => {
        const checkForUpdate = vi.fn(async () => null);
        const store = createAppUpdateStore(deps({ checkForUpdate }));
        store.setState({ status: 'readyToRestart' });

        await store.getState().checkNow();

        expect(checkForUpdate).not.toHaveBeenCalled();
        expect(store.getState().status).toBe('readyToRestart');
    });

    it('sets up startup delay and periodic checks in release builds', () => {
        const setTimeoutFn = vi.fn((_fn: () => void, _ms: number) => 1);
        const clearTimeoutFn = vi.fn();
        const setIntervalFn = vi.fn((_fn: () => void, _ms: number) => 2);
        const clearIntervalFn = vi.fn();
        const store = createAppUpdateStore(deps({
            setTimeoutFn,
            clearTimeoutFn,
            setIntervalFn,
            clearIntervalFn,
        }));
        const stop = store.getState().startAutomaticChecks();
        expect(setTimeoutFn).toHaveBeenCalledWith(expect.any(Function), APP_UPDATE_STARTUP_DELAY_MS);
        expect(setIntervalFn).toHaveBeenCalledWith(expect.any(Function), APP_UPDATE_CHECK_INTERVAL_MS);
        stop();
        expect(clearTimeoutFn).toHaveBeenCalledWith(1);
        expect(clearIntervalFn).toHaveBeenCalledWith(2);
    });

    it('does not schedule automatic checks in dev builds', () => {
        const setTimeoutFn = vi.fn();
        const setIntervalFn = vi.fn();
        const store = createAppUpdateStore(deps({
            isReleaseBuild: () => false,
            setTimeoutFn,
            setIntervalFn,
        }));
        store.getState().startAutomaticChecks();
        expect(setTimeoutFn).not.toHaveBeenCalled();
        expect(setIntervalFn).not.toHaveBeenCalled();
        expect(store.getState().status).toBe('idle');
    });

    it('moves to upToDate when no update is available', async () => {
        const store = createAppUpdateStore(deps({
            checkForUpdate: vi.fn(async () => null),
        }));
        await store.getState().checkNow();
        expect(store.getState().status).toBe('upToDate');
        expect(store.getState().lastCheckedAt).toBe(1_700_000_000_000);
    });

    it('downloads and installs an available update', async () => {
        const downloadAndInstall = vi.fn(async () => {});
        const store = createAppUpdateStore(deps({
            checkForUpdate: vi.fn(async () => ({
                version: '0.1.1',
                currentVersion: '0.1.0',
                body: 'notes',
                date: '2026-05-18T00:00:00Z',
                downloadAndInstall,
            })),
        }));
        await store.getState().checkNow();
        expect(downloadAndInstall).toHaveBeenCalledTimes(1);
        expect(store.getState()).toMatchObject({
            status: 'readyToRestart',
            availableVersion: '0.1.1',
            currentVersion: '0.1.0',
            releaseNotes: 'notes',
        });
    });

    it('does not download an update if automatic updates are disabled while checking', async () => {
        const downloadAndInstall = vi.fn(async () => {});
        const fakeUpdate = {
            version: '0.1.1',
            currentVersion: '0.1.0',
            body: 'notes',
            date: '2026-05-18T00:00:00Z',
            downloadAndInstall,
        };
        let resolveCheck!: (value: typeof fakeUpdate) => void;
        const checkForUpdate = vi.fn(() => new Promise<typeof fakeUpdate>((resolve) => {
            resolveCheck = resolve;
        }));
        const store = createAppUpdateStore(deps({ checkForUpdate }));

        const check = store.getState().checkNow();
        await store.getState().setAutoUpdateEnabled(false);
        resolveCheck(fakeUpdate);
        await check;

        expect(downloadAndInstall).not.toHaveBeenCalled();
        expect(store.getState().status).toBe('disabled');
    });

    it('reports download progress and switches to installing when the download finishes', async () => {
        let store: ReturnType<typeof createAppUpdateStore>;
        const downloadAndInstall = vi.fn(async (onEvent?: (event: DownloadEvent) => void) => {
            onEvent?.({ event: 'Started', data: { contentLength: 100 } });
            onEvent?.({ event: 'Progress', data: { chunkLength: 25 } });
            expect(store.getState()).toMatchObject({
                status: 'downloading',
                downloadedBytes: 25,
                downloadTotalBytes: 100,
            });
            onEvent?.({ event: 'Finished' });
            expect(store.getState().status).toBe('installing');
        });
        store = createAppUpdateStore(deps({
            checkForUpdate: vi.fn(async () => ({
                version: '0.1.1',
                currentVersion: '0.1.0',
                body: 'notes',
                date: '2026-05-18T00:00:00Z',
                downloadAndInstall,
            })),
        }));

        await store.getState().checkNow();

        expect(store.getState().status).toBe('readyToRestart');
    });

    it('moves to error on check failure', async () => {
        const store = createAppUpdateStore(deps({
            checkForUpdate: vi.fn(async () => { throw new Error('cdn down'); }),
        }));
        await store.getState().checkNow();
        expect(store.getState().status).toBe('error');
        expect(store.getState().errorMessage).toContain('cdn down');
    });

    it('keeps disabled status when a check fails after automatic updates are disabled', async () => {
        let rejectCheck!: (err: Error) => void;
        const checkForUpdate = vi.fn(() => new Promise<null>((_resolve, reject) => {
            rejectCheck = reject;
        }));
        const store = createAppUpdateStore(deps({ checkForUpdate }));

        const check = store.getState().checkNow();
        await store.getState().setAutoUpdateEnabled(false);
        rejectCheck(new Error('cdn down'));
        await check;

        expect(store.getState().status).toBe('disabled');
        expect(store.getState().errorMessage).toBeNull();
    });

    it('ignores overlapping checks', async () => {
        let releaseCheck!: () => void;
        const checkForUpdate = vi.fn(() => new Promise<null>((resolve) => { releaseCheck = () => resolve(null); }));
        const store = createAppUpdateStore(deps({ checkForUpdate }));
        const first = store.getState().checkNow();
        const second = store.getState().checkNow();
        expect(checkForUpdate).toHaveBeenCalledTimes(1);
        releaseCheck();
        await Promise.all([first, second]);
    });

    it('relaunches only when ready', async () => {
        const relaunchApp = vi.fn(async () => {});
        const store = createAppUpdateStore(deps({ relaunchApp }));
        await store.getState().restartForUpdate();
        expect(relaunchApp).not.toHaveBeenCalled();
        store.setState({ status: 'readyToRestart' });
        await store.getState().restartForUpdate();
        expect(relaunchApp).toHaveBeenCalledTimes(1);
    });
});
