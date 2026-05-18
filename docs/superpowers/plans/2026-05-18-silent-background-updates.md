# Silent Background Updates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add signed, self-hosted, stable-channel background updates that silently check/download/install and only restart after the user chooses to relaunch.

**Architecture:** Use the official Tauri updater and process plugins for package verification, install, and relaunch. Keep update scheduling/status in a focused frontend domain store, mirror it to Settings through the existing bridge, and generate CDN-ready static update manifests with a local release script.

**Tech Stack:** Tauri 2, Rust, React 19, TypeScript, Zustand, Vitest, Node ESM release tooling, Pencil MCP.

---

## Scope Check

This plan implements one vertical slice: stable-channel updater client, Settings control/status, and local release artifact preparation. It intentionally excludes CDN upload, beta UI, gray rollout, forced update, rollback UI, delta updates, and automatic restart.

## File Structure

- Modify `AUI/PUI.pen`: add one Global settings row for automatic updates plus status text, using Pencil MCP only.
- Modify `app/package.json`: add updater/process JS dependencies and a release-script test command.
- Modify `app/src-tauri/Cargo.toml`: add updater/process Rust plugins.
- Modify `app/src-tauri/tauri.conf.json`: add updater endpoint, public key, Windows passive install mode, and updater artifact generation.
- Modify `app/src-tauri/capabilities/default.json`: add only updater/process permissions required by the frontend API.
- Modify `app/src-tauri/src/lib.rs`: initialize updater and process plugins.
- Create `app/src/updateConfig.test.ts`: guard updater config, capability scope, and version alignment.
- Create `app/src/domain/appUpdate.ts`: Zustand store, scheduling, check/download/install flow, and restart action.
- Create `app/src/domain/appUpdate.test.ts`: unit tests for setting, state transitions, failures, and overlap guard.
- Create `app/src/domain/appUpdatePersistence.ts`: persist `autoUpdateEnabled` separately from existing Settings persistence.
- Create `app/src/domain/appUpdatePersistence.test.ts`: load/save/default persistence tests.
- Modify `app/src/domain/bridge/protocol.ts`: add `appUpdate` snapshot and dispatch payloads.
- Modify `app/src/domain/bridge/host.ts`: include appUpdate in snapshots and apply appUpdate dispatches.
- Modify `app/src/domain/bridge/client.ts`: hydrate appUpdate mirror state in Settings.
- Add tests to `app/src/domain/bridge/*.test.ts`: snapshot, dispatch, and mirror coverage.
- Modify `app/src/App.tsx`: start the app update service and render the ready-to-restart prompt.
- Create `app/src/ui/AppUpdateReadyNotice.tsx`: low-interruption restart prompt.
- Create `app/src/ui/AppUpdateReadyNotice.css`: prompt styling.
- Modify `app/src/ui/SettingsPanel.tsx`: render toggle/status in Global tab.
- Modify `app/src/ui/SettingsPanel.css`: add compact update status styles if the existing card styles are insufficient.
- Modify `app/src/ui/SettingsPanel.test.tsx`: cover toggle/status rendering.
- Create `scripts/release-updater.mjs`: build/verify/copy updater artifacts and generate `release-dist/stable/latest.json`.
- Create `scripts/release-updater.test.mjs`: Node test coverage for release helper functions.
- Create or update `release-dist/.gitignore`: keep generated release artifacts out of git.

## Constants To Use

- Update channel: `stable`
- Default endpoint: `https://updates.nanzhai.com/cpa/stable/latest.json`
- Startup delay: `30_000` ms
- Periodic interval: `6 * 60 * 60 * 1000` ms
- Windows updater install mode: `"passive"`
- Settings label: `自动下载并安装更新`
- Ready prompt text: `新版本已准备好，重启后生效`
- Restart button text: `重启更新`

## Task 1: Update Pencil Design For The Global Settings Row

**Files:**
- Modify: `AUI/PUI.pen`

- [ ] **Step 1: Read current Global tab structure through Pencil MCP**

Use Pencil MCP, not shell reads:

```text
1. Call mcp__pencil__get_editor_state with include_schema=true.
2. Call mcp__pencil__batch_get on AUI/PUI.pen for nodes around Global tab `Pdj9C`, existing scale row, active file title row, and binding-key card.
3. Record the exact parent node that owns Global tab rows before editing.
```

Expected: the editable parent for the Global tab content is identified, and the existing card spacing is known.

- [ ] **Step 2: Add update card in Pencil**

Insert a new card between `显示打开的文件名` and `按键计数`:

```text
Card label: 自动下载并安装更新
Right control: toggle, default on
Secondary/status text: 当前版本 0.1.0 · 等待检查
```

Use the existing Global tab card style, not a new visual pattern. Keep the row compact so the content remains scroll-owned by `settings-content-scroll`.

- [ ] **Step 3: Screenshot-check the edited Global tab**

Use Pencil screenshot on the Global tab or its smallest meaningful parent.

Expected:
- no overlapping text
- row order is scale, file title, auto update, key counter
- update status text fits at the current Settings width

- [ ] **Step 4: Commit design-only change**

```bash
git status --short
git add AUI/PUI.pen
git commit -m "design: add update setting row"
```

Expected: commit includes only `AUI/PUI.pen`.

## Task 2: Add Updater Dependencies And Guarded Native Configuration

**Files:**
- Modify: `app/package.json`
- Modify: `app/package-lock.json`
- Modify: `app/src-tauri/Cargo.toml`
- Modify: `app/src-tauri/Cargo.lock`
- Modify: `app/src-tauri/tauri.conf.json`
- Modify: `app/src-tauri/capabilities/default.json`
- Modify: `app/src-tauri/src/lib.rs`
- Create: `app/src/updateConfig.test.ts`

- [ ] **Step 1: Write failing config tests**

Create `app/src/updateConfig.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.join(here, '..');
const packageJsonPath = path.join(appRoot, 'package.json');
const cargoTomlPath = path.join(appRoot, 'src-tauri/Cargo.toml');
const tauriConfPath = path.join(appRoot, 'src-tauri/tauri.conf.json');
const capabilitiesPath = path.join(appRoot, 'src-tauri/capabilities/default.json');
const libRsPath = path.join(appRoot, 'src-tauri/src/lib.rs');

function readJson(pathname: string) {
    return JSON.parse(readFileSync(pathname, 'utf8'));
}

function cargoPackageVersion(source: string): string {
    const match = source.match(/\[package\][\s\S]*?\nversion\s*=\s*"([^"]+)"/);
    if (!match) throw new Error('Cargo package version not found');
    return match[1];
}

describe('updater configuration', () => {
    it('keeps app, cargo, and tauri versions aligned', () => {
        const pkg = readJson(packageJsonPath);
        const conf = readJson(tauriConfPath);
        const cargo = readFileSync(cargoTomlPath, 'utf8');
        expect(pkg.version).toBe(conf.version);
        expect(cargoPackageVersion(cargo)).toBe(conf.version);
    });

    it('creates signed updater artifacts and points at the stable CDN manifest', () => {
        const conf = readJson(tauriConfPath);
        expect(conf.bundle?.createUpdaterArtifacts).toBe(true);
        expect(conf.plugins?.updater?.endpoints).toEqual([
            'https://updates.nanzhai.com/cpa/stable/latest.json',
        ]);
        expect(conf.plugins?.updater?.pubkey).toEqual(expect.any(String));
        expect(conf.plugins.updater.pubkey.length).toBeGreaterThan(40);
        expect(conf.plugins.updater.pubkey).not.toContain('PRIVATE');
        expect(conf.plugins.updater.windows?.installMode).toBe('passive');
    });

    it('initializes updater and process plugins in Rust', () => {
        const source = readFileSync(libRsPath, 'utf8');
        expect(source).toContain('tauri_plugin_updater::Builder::new().build()');
        expect(source).toContain('tauri_plugin_process::init()');
    });

    it('grants only updater/process permissions needed by the frontend', () => {
        const capabilities = readJson(capabilitiesPath);
        expect(capabilities.permissions).toContain('updater:allow-check');
        expect(capabilities.permissions).toContain('updater:allow-download-and-install');
        expect(capabilities.permissions).toContain('process:allow-restart');
        expect(capabilities.permissions).not.toContain('shell:default');
        expect(capabilities.permissions).not.toContain('fs:default');
    });
});
```

- [ ] **Step 2: Run the failing test**

```bash
cd app && npx vitest run src/updateConfig.test.ts
```

Expected: FAIL because updater config, permissions, and plugins are not present yet.

- [ ] **Step 3: Add JavaScript dependencies**

Run:

```bash
cd app && npm install @tauri-apps/plugin-updater@^2 @tauri-apps/plugin-process@^2
```

Expected: `app/package.json` and `app/package-lock.json` include the two dependencies.

- [ ] **Step 4: Add Rust dependencies**

Edit `app/src-tauri/Cargo.toml` dependencies:

```toml
tauri-plugin-updater = "2"
tauri-plugin-process = "2"
```

Then run:

```bash
cd app/src-tauri && cargo check
```

Expected: dependencies resolve and `Cargo.lock` updates. If `cargo` is not on PATH, export:

```bash
export PATH="/Users/xpy/.rustup/toolchains/stable-aarch64-apple-darwin/bin:$PATH"
```

- [ ] **Step 5: Generate or locate updater signing key**

If `/Users/xpy/.tauri/cpa-updater.key` does not exist, run:

```bash
cd app && npm run tauri signer generate -- -w /Users/xpy/.tauri/cpa-updater.key
```

Copy only the public key printed by the command. Do not commit `/Users/xpy/.tauri/cpa-updater.key`.

Expected: private key exists outside the repo; public key is available for `tauri.conf.json`.

- [ ] **Step 6: Configure Tauri updater**

Modify `app/src-tauri/tauri.conf.json`. Preserve the existing top-level fields and existing `bundle.icon` list. Add `bundle.createUpdaterArtifacts`, add a top-level `plugins.updater` object, and set `plugins.updater.pubkey` to the exact public key printed in Step 5:

```json
{
  "bundle": {
    "active": true,
    "targets": "all",
    "createUpdaterArtifacts": true,
    "icon": [
      "icons/32x32.png",
      "icons/128x128.png",
      "icons/128x128@2x.png",
      "icons/icon.icns",
      "icons/icon.ico"
    ]
  },
  "plugins": {
    "updater": {
      "endpoints": [
        "https://updates.nanzhai.com/cpa/stable/latest.json"
      ],
      "windows": {
        "installMode": "passive"
      }
    }
  }
}
```

Do not paste the private key. Do not commit `/Users/xpy/.tauri/cpa-updater.key`. After editing, `plugins.updater.pubkey` must be a real public key string longer than 40 characters, which is what `app/src/updateConfig.test.ts` checks.

- [ ] **Step 7: Add narrow capabilities**

Modify `app/src-tauri/capabilities/default.json` permissions to include:

```json
"updater:allow-check",
"updater:allow-download-and-install",
"process:allow-restart"
```

Do not add broad shell or filesystem permissions.

- [ ] **Step 8: Initialize plugins**

In `app/src-tauri/src/lib.rs`, add the plugins near existing plugin initialization:

```rust
.plugin(tauri_plugin_updater::Builder::new().build())
.plugin(tauri_plugin_process::init())
```

Expected: both plugins are initialized before `.setup(...)`.

- [ ] **Step 9: Verify config tests and build**

```bash
cd app && npx vitest run src/updateConfig.test.ts
cd app && npm run build
cd app/src-tauri && cargo check
```

Expected: all commands pass.

- [ ] **Step 10: Commit**

```bash
git add app/package.json app/package-lock.json app/src-tauri/Cargo.toml app/src-tauri/Cargo.lock app/src-tauri/tauri.conf.json app/src-tauri/capabilities/default.json app/src-tauri/src/lib.rs app/src/updateConfig.test.ts
git commit -m "feat: configure signed app updates"
```

## Task 3: Add App Update Store, Persistence, And Unit Tests

**Files:**
- Create: `app/src/domain/appUpdate.ts`
- Create: `app/src/domain/appUpdate.test.ts`
- Create: `app/src/domain/appUpdatePersistence.ts`
- Create: `app/src/domain/appUpdatePersistence.test.ts`

- [ ] **Step 1: Write failing persistence tests**

Create `app/src/domain/appUpdatePersistence.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const storeData = new Map<string, unknown>();
const save = vi.fn(async () => {});

vi.mock('@tauri-apps/plugin-store', () => ({
    load: vi.fn(async () => ({
        get: async (key: string) => storeData.get(key),
        set: async (key: string, value: unknown) => { storeData.set(key, value); },
        save,
    })),
}));

const persistence = await import('./appUpdatePersistence');

beforeEach(() => {
    storeData.clear();
    save.mockClear();
});

describe('app update persistence', () => {
    it('returns default enabled when no persisted value exists', async () => {
        await expect(persistence.loadPersistedAppUpdateSettings()).resolves.toEqual({
            autoUpdateEnabled: true,
        });
    });

    it('loads persisted disabled value', async () => {
        storeData.set('appUpdate', { v: 1, autoUpdateEnabled: false });
        await expect(persistence.loadPersistedAppUpdateSettings()).resolves.toEqual({
            autoUpdateEnabled: false,
        });
    });

    it('ignores malformed persisted values', async () => {
        storeData.set('appUpdate', { v: 1, autoUpdateEnabled: 'nope' });
        await expect(persistence.loadPersistedAppUpdateSettings()).resolves.toEqual({
            autoUpdateEnabled: true,
        });
    });

    it('saves v1 app update settings', async () => {
        await persistence.savePersistedAppUpdateSettings({ autoUpdateEnabled: false });
        expect(storeData.get('appUpdate')).toEqual({ v: 1, autoUpdateEnabled: false });
        expect(save).toHaveBeenCalledTimes(1);
    });
});
```

- [ ] **Step 2: Write failing store tests**

Create `app/src/domain/appUpdate.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
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
        setTimeoutFn: vi.fn((_fn: () => void, _ms: number) => 1 as unknown as ReturnType<typeof setTimeout>),
        clearTimeoutFn: vi.fn(),
        setIntervalFn: vi.fn((_fn: () => void, _ms: number) => 2 as unknown as ReturnType<typeof setInterval>),
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

    it('persists automatic update toggle', async () => {
        const saveSettings = vi.fn(async () => {});
        const store = createAppUpdateStore(deps({ saveSettings }));
        await store.getState().setAutoUpdateEnabled(false);
        expect(store.getState().autoUpdateEnabled).toBe(false);
        expect(store.getState().status).toBe('disabled');
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

    it('sets up startup delay and periodic checks in release builds', () => {
        const setTimeoutFn = vi.fn((_fn: () => void, _ms: number) => 1 as unknown as ReturnType<typeof setTimeout>);
        const setIntervalFn = vi.fn((_fn: () => void, _ms: number) => 2 as unknown as ReturnType<typeof setInterval>);
        const store = createAppUpdateStore(deps({ setTimeoutFn, setIntervalFn }));
        const stop = store.getState().startAutomaticChecks();
        expect(setTimeoutFn).toHaveBeenCalledWith(expect.any(Function), APP_UPDATE_STARTUP_DELAY_MS);
        expect(setIntervalFn).toHaveBeenCalledWith(expect.any(Function), APP_UPDATE_CHECK_INTERVAL_MS);
        stop();
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

    it('moves to error on check failure', async () => {
        const store = createAppUpdateStore(deps({
            checkForUpdate: vi.fn(async () => { throw new Error('cdn down'); }),
        }));
        await store.getState().checkNow();
        expect(store.getState().status).toBe('error');
        expect(store.getState().errorMessage).toContain('cdn down');
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
```

- [ ] **Step 3: Run failing tests**

```bash
cd app && npx vitest run src/domain/appUpdatePersistence.test.ts src/domain/appUpdate.test.ts
```

Expected: FAIL because the modules do not exist.

- [ ] **Step 4: Implement persistence**

Create `app/src/domain/appUpdatePersistence.ts`:

```ts
import { load } from '@tauri-apps/plugin-store';

const STORE_PATH = 'app-update.json';
const STORE_KEY = 'appUpdate';

export interface PersistedAppUpdateSettings {
    autoUpdateEnabled: boolean;
}

interface PersistedAppUpdateSettingsV1 {
    v: 1;
    autoUpdateEnabled: boolean;
}

function isPersistedAppUpdateSettingsV1(value: unknown): value is PersistedAppUpdateSettingsV1 {
    if (!value || typeof value !== 'object') return false;
    const candidate = value as Partial<PersistedAppUpdateSettingsV1>;
    return candidate.v === 1 && typeof candidate.autoUpdateEnabled === 'boolean';
}

async function openStore() {
    return load(STORE_PATH, { defaults: {}, autoSave: false });
}

export async function loadPersistedAppUpdateSettings(): Promise<PersistedAppUpdateSettings> {
    try {
        const store = await openStore();
        const value = await store.get<unknown>(STORE_KEY);
        if (!isPersistedAppUpdateSettingsV1(value)) {
            return { autoUpdateEnabled: true };
        }
        return { autoUpdateEnabled: value.autoUpdateEnabled };
    } catch (err) {
        console.warn('[appUpdatePersistence] load failed', err);
        return { autoUpdateEnabled: true };
    }
}

export async function savePersistedAppUpdateSettings(settings: PersistedAppUpdateSettings): Promise<void> {
    try {
        const store = await openStore();
        await store.set(STORE_KEY, {
            v: 1,
            autoUpdateEnabled: settings.autoUpdateEnabled,
        } satisfies PersistedAppUpdateSettingsV1);
        await store.save();
    } catch (err) {
        console.warn('[appUpdatePersistence] save failed', err);
    }
}
```

- [ ] **Step 5: Implement app update store**

Create `app/src/domain/appUpdate.ts`:

```ts
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

export interface AppUpdateDeps {
    checkForUpdate: () => Promise<UpdaterUpdate | null>;
    relaunchApp: () => Promise<void>;
    getVersion: () => Promise<string>;
    loadSettings: () => Promise<PersistedAppUpdateSettings>;
    saveSettings: (settings: PersistedAppUpdateSettings) => Promise<void>;
    isReleaseBuild: () => boolean;
    setTimeoutFn: typeof setTimeout;
    clearTimeoutFn: typeof clearTimeout;
    setIntervalFn: typeof setInterval;
    clearIntervalFn: typeof clearInterval;
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
            set({
                autoUpdateEnabled: settings.autoUpdateEnabled,
                currentVersion,
                status: settings.autoUpdateEnabled ? get().status : 'disabled',
            });
        },
        setAutoUpdateEnabled: async (enabled) => {
            set({
                autoUpdateEnabled: enabled,
                status: enabled ? 'idle' : 'disabled',
                errorMessage: null,
            });
            await deps.saveSettings({ autoUpdateEnabled: enabled });
        },
        checkNow: async () => {
            if (inFlight) return inFlight;
            if (!get().autoUpdateEnabled) {
                set({ status: 'disabled', errorMessage: null });
                return;
            }
            inFlight = (async () => {
                try {
                    set({ status: 'checking', errorMessage: null });
                    const update = await deps.checkForUpdate();
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
                    await update.downloadAndInstall(() => {
                        if (get().status === 'downloading') {
                            set({ status: 'installing' });
                        }
                    });
                    set({ status: 'readyToRestart', errorMessage: null });
                } catch (err) {
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
const mirrorStore = detectIsMirrorWindow();

if (mirrorStore) {
    appUpdateStore.setState({
        setAutoUpdateEnabled: async (enabled) => {
            await dispatch({ v: BRIDGE_VERSION, store: 'appUpdate', action: 'setAutoUpdateEnabled', args: [enabled] });
        },
        checkNow: async () => {
            await dispatch({ v: BRIDGE_VERSION, store: 'appUpdate', action: 'checkNow', args: [] });
        },
        restartForUpdate: async () => {
            await dispatch({ v: BRIDGE_VERSION, store: 'appUpdate', action: 'restartForUpdate', args: [] });
        },
    });
}

export const useAppUpdateStore: AppUpdateStore = appUpdateStore;
```

- [ ] **Step 6: Run tests**

```bash
cd app && npx vitest run src/domain/appUpdatePersistence.test.ts src/domain/appUpdate.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add app/src/domain/appUpdate.ts app/src/domain/appUpdate.test.ts app/src/domain/appUpdatePersistence.ts app/src/domain/appUpdatePersistence.test.ts
git commit -m "feat: add app update domain store"
```

## Task 4: Mirror App Update State Through The Existing Bridge

**Files:**
- Modify: `app/src/domain/bridge/protocol.ts`
- Modify: `app/src/domain/bridge/host.ts`
- Modify: `app/src/domain/bridge/client.ts`
- Modify: `app/src/domain/bridge/protocol.test.ts`
- Modify: `app/src/domain/bridge/host.test.ts`
- Modify: `app/src/domain/bridge/client.test.ts`

- [ ] **Step 1: Add failing bridge tests**

In `app/src/domain/bridge/protocol.test.ts`, add:

```ts
it('accepts appUpdate dispatch payload shape', () => {
    const payload = {
        v: BRIDGE_VERSION,
        store: 'appUpdate',
        action: 'setAutoUpdateEnabled',
        args: [false],
    } satisfies DispatchPayload;
    expect(payload.store).toBe('appUpdate');
});
```

In `app/src/domain/bridge/host.test.ts`, add tests that `buildSnapshot()` includes `appUpdate` and `applyDispatch()` handles `appUpdate/setAutoUpdateEnabled`, `appUpdate/checkNow`, and `appUpdate/restartForUpdate`.

In `app/src/domain/bridge/client.test.ts`, add a test that `applySnapshotToMirrors()` copies `snap.appUpdate` into `useAppUpdateStore`.

- [ ] **Step 2: Run failing bridge tests**

```bash
cd app && npx vitest run src/domain/bridge/protocol.test.ts src/domain/bridge/host.test.ts src/domain/bridge/client.test.ts
```

Expected: FAIL because bridge types and functions do not include `appUpdate`.

- [ ] **Step 3: Extend bridge protocol**

Modify `app/src/domain/bridge/protocol.ts`:

```ts
import type { AppUpdateSnapshot } from '../appUpdate';
```

Add to `BridgeSnapshot`:

```ts
appUpdate: AppUpdateSnapshot;
```

Add to `DispatchPayload`:

```ts
| { v: typeof BRIDGE_VERSION; store: 'appUpdate'; action: 'setAutoUpdateEnabled'; args: [boolean] }
| { v: typeof BRIDGE_VERSION; store: 'appUpdate'; action: 'checkNow' | 'restartForUpdate'; args: [] }
```

- [ ] **Step 4: Extend host snapshot and dispatch**

In `app/src/domain/bridge/host.ts`, import `useAppUpdateStore`.

Add `appUpdate: { ...u }` to `buildSnapshot()` using:

```ts
const u = useAppUpdateStore.getState();
```

Add an `appUpdateSig()` function:

```ts
export function appUpdateSig(s: AppUpdateSnapshot): string {
    return JSON.stringify([
        s.autoUpdateEnabled,
        s.status,
        s.currentVersion,
        s.availableVersion,
        s.releaseNotes,
        s.lastCheckedAt,
        s.errorMessage,
    ]);
}
```

Add `appUpdate` handling to `applyDispatch()`:

```ts
case 'appUpdate': {
    const u = useAppUpdateStore.getState();
    switch (payload.action) {
        case 'setAutoUpdateEnabled': void u.setAutoUpdateEnabled(...payload.args); return;
        case 'checkNow': void u.checkNow(); return;
        case 'restartForUpdate': void u.restartForUpdate(); return;
    }
    return;
}
```

Subscribe in `useBridgeHost()` the same way as settings/network:

```ts
let prevAppUpdate = appUpdateSig(useAppUpdateStore.getState());
useAppUpdateStore.subscribe((s) => {
    const sig = appUpdateSig(s);
    if (sig === prevAppUpdate) return;
    prevAppUpdate = sig;
    void sendSnapshot();
});
```

- [ ] **Step 5: Extend mirror client**

In `app/src/domain/bridge/client.ts`, import `useAppUpdateStore` and add to `applySnapshotToMirrors()`:

```ts
useAppUpdateStore.getState().applySnapshot({ ...snap.appUpdate });
```

- [ ] **Step 6: Run bridge tests**

```bash
cd app && npx vitest run src/domain/bridge/protocol.test.ts src/domain/bridge/host.test.ts src/domain/bridge/client.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add app/src/domain/bridge/protocol.ts app/src/domain/bridge/host.ts app/src/domain/bridge/client.ts app/src/domain/bridge/protocol.test.ts app/src/domain/bridge/host.test.ts app/src/domain/bridge/client.test.ts
git commit -m "feat: mirror app update state"
```

## Task 5: Start Background Checks And Show Restart Prompt

**Files:**
- Modify: `app/src/App.tsx`
- Create: `app/src/ui/AppUpdateReadyNotice.tsx`
- Create: `app/src/ui/AppUpdateReadyNotice.css`
- Create or modify: `app/src/App.test.tsx`
- Create: `app/src/ui/AppUpdateReadyNotice.test.tsx`

- [ ] **Step 1: Write failing UI tests**

Create `app/src/ui/AppUpdateReadyNotice.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppUpdateStore } from '../domain/appUpdate';
import { AppUpdateReadyNotice } from './AppUpdateReadyNotice';

beforeEach(() => {
    useAppUpdateStore.setState({
        autoUpdateEnabled: true,
        status: 'idle',
        currentVersion: '0.1.0',
        availableVersion: null,
        releaseNotes: null,
        lastCheckedAt: null,
        errorMessage: null,
    });
});

describe('AppUpdateReadyNotice', () => {
    it('stays hidden until an update is ready to restart', () => {
        render(<AppUpdateReadyNotice />);
        expect(screen.queryByText('新版本已准备好，重启后生效')).not.toBeInTheDocument();
    });

    it('shows ready prompt and relaunch action', async () => {
        const restartForUpdate = vi.fn(async () => {});
        useAppUpdateStore.setState({
            status: 'readyToRestart',
            availableVersion: '0.1.1',
            restartForUpdate,
        });
        render(<AppUpdateReadyNotice />);
        expect(screen.getByText('新版本已准备好，重启后生效')).toBeInTheDocument();
        expect(screen.getByText('0.1.1')).toBeInTheDocument();
        await userEvent.click(screen.getByRole('button', { name: '重启更新' }));
        expect(restartForUpdate).toHaveBeenCalledTimes(1);
    });
});
```

In `app/src/App.test.tsx`, add:

```tsx
it('starts the app update service on mount', () => {
    const startAutomaticChecks = vi.fn(() => vi.fn());
    useAppUpdateStore.setState({ startAutomaticChecks });
    render(<App />);
    expect(startAutomaticChecks).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Run failing UI tests**

```bash
cd app && npx vitest run src/ui/AppUpdateReadyNotice.test.tsx src/App.test.tsx
```

Expected: FAIL because the component and App integration do not exist yet.

- [ ] **Step 3: Implement restart prompt**

Create `app/src/ui/AppUpdateReadyNotice.tsx`:

```tsx
import { useAppUpdateStore } from '../domain/appUpdate';
import './AppUpdateReadyNotice.css';

export function AppUpdateReadyNotice() {
    const status = useAppUpdateStore((s) => s.status);
    const availableVersion = useAppUpdateStore((s) => s.availableVersion);
    const restartForUpdate = useAppUpdateStore((s) => s.restartForUpdate);

    if (status !== 'readyToRestart') return null;

    return (
        <div className="app-update-ready" role="status">
            <div className="app-update-ready-text">
                <span>新版本已准备好，重启后生效</span>
                {availableVersion && <strong>{availableVersion}</strong>}
            </div>
            <button className="app-update-ready-button" onClick={() => { void restartForUpdate(); }}>
                重启更新
            </button>
        </div>
    );
}
```

Create `app/src/ui/AppUpdateReadyNotice.css`:

```css
.app-update-ready {
    position: fixed;
    left: 12px;
    right: 12px;
    bottom: 12px;
    z-index: 20;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 10px 12px;
    border: 1px solid var(--panel-border);
    border-radius: 8px;
    background: var(--panel-bg);
    color: var(--text-primary);
    box-shadow: 0 8px 20px rgba(0, 0, 0, 0.16);
}

.app-update-ready-text {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
    font-size: 12px;
    line-height: 1.2;
}

.app-update-ready-text strong {
    font-size: 11px;
    color: var(--text-secondary);
}

.app-update-ready-button {
    flex: 0 0 auto;
    border: 0;
    border-radius: 6px;
    padding: 6px 10px;
    background: var(--btn-primary-bg-idle);
    color: var(--btn-primary-text);
    font-size: 12px;
    font-weight: 700;
    cursor: pointer;
}
```

- [ ] **Step 4: Start app update service from App**

Modify `app/src/App.tsx`:

```tsx
import { AppUpdateReadyNotice } from './ui/AppUpdateReadyNotice';
import { useAppUpdateStore } from './domain/appUpdate';
```

Inside `App()`:

```tsx
useEffect(() => {
    let cancelled = false;
    let cleanup = () => {};
    void useAppUpdateStore.getState().hydrate().then(() => {
        if (cancelled) return;
        const stop = useAppUpdateStore.getState().startAutomaticChecks();
        cleanup = stop;
    });
    return () => {
        cancelled = true;
        cleanup();
    };
}, []);
```

Render `<AppUpdateReadyNotice />` inside `.app-root`, after `<PomodoroEndActionLayer />`.

- [ ] **Step 5: Run tests**

```bash
cd app && npx vitest run src/ui/AppUpdateReadyNotice.test.tsx src/App.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/src/App.tsx app/src/App.test.tsx app/src/ui/AppUpdateReadyNotice.tsx app/src/ui/AppUpdateReadyNotice.css app/src/ui/AppUpdateReadyNotice.test.tsx
git commit -m "feat: start background update checks"
```

## Task 6: Add Settings Toggle And Status Text

**Files:**
- Modify: `app/src/ui/SettingsPanel.tsx`
- Modify: `app/src/ui/SettingsPanel.css`
- Modify: `app/src/ui/SettingsPanel.test.tsx`

- [ ] **Step 1: Write failing Settings tests**

Add to `app/src/ui/SettingsPanel.test.tsx`:

```tsx
it('renders automatic update toggle and status in Global settings', () => {
    useSettingsStore.setState({ activeTab: 'global' });
    useAppUpdateStore.setState({
        autoUpdateEnabled: true,
        status: 'upToDate',
        currentVersion: '0.1.0',
        availableVersion: null,
        releaseNotes: null,
        lastCheckedAt: 1_700_000_000_000,
        errorMessage: null,
    });
    render(<SettingsPanel />);
    expect(screen.getByText('自动下载并安装更新')).toBeInTheDocument();
    expect(screen.getByText(/当前版本 0\.1\.0/)).toBeInTheDocument();
    expect(screen.getByText(/已是最新版本/)).toBeInTheDocument();
});

it('dispatches automatic update toggle changes from Settings', async () => {
    useSettingsStore.setState({ activeTab: 'global' });
    const setAutoUpdateEnabled = vi.fn(async () => {});
    useAppUpdateStore.setState({ autoUpdateEnabled: true, setAutoUpdateEnabled });
    render(<SettingsPanel />);
    await userEvent.click(screen.getByLabelText('自动下载并安装更新'));
    expect(setAutoUpdateEnabled).toHaveBeenCalledWith(false);
});
```

- [ ] **Step 2: Run failing Settings tests**

```bash
cd app && npx vitest run src/ui/SettingsPanel.test.tsx
```

Expected: FAIL because update UI is not rendered.

- [ ] **Step 3: Render update card**

In `app/src/ui/SettingsPanel.tsx`, import `useAppUpdateStore`.

Add helpers near `GlobalTab()`:

```ts
function updateStatusLabel(status: AppUpdateStatus): string {
    switch (status) {
        case 'idle': return '等待检查';
        case 'checking': return '正在检查更新';
        case 'upToDate': return '已是最新版本';
        case 'downloading': return '正在后台下载';
        case 'installing': return '正在安装更新';
        case 'readyToRestart': return '重启后生效';
        case 'disabled': return '已关闭自动更新';
        case 'error': return '检查更新失败，稍后重试';
    }
}
```

Inside `GlobalTab()`, read:

```tsx
const appUpdate = useAppUpdateStore();
```

Render after the file-title card:

```tsx
<div className="card app-update-settings-card">
    <div className="card-row">
        <span className="card-label">自动下载并安装更新</span>
        <Toggle
            checked={appUpdate.autoUpdateEnabled}
            onChange={appUpdate.setAutoUpdateEnabled}
            ariaLabel="自动下载并安装更新"
        />
    </div>
    <p className="app-update-status">
        当前版本 {appUpdate.currentVersion ?? '未知'} · {updateStatusLabel(appUpdate.status)}
        {appUpdate.availableVersion ? ` · ${appUpdate.availableVersion}` : ''}
    </p>
    {appUpdate.errorMessage && (
        <p className="app-update-error">{appUpdate.errorMessage}</p>
    )}
</div>
```

- [ ] **Step 4: Add compact styles**

In `app/src/ui/SettingsPanel.css`, add:

```css
.app-update-settings-card {
    gap: 8px;
}

.app-update-status,
.app-update-error {
    margin: 0;
    font-size: 11px;
    line-height: 1.35;
}

.app-update-status {
    color: var(--text-secondary);
}

.app-update-error {
    color: var(--btn-primary-bg-idle);
}
```

- [ ] **Step 5: Run Settings tests**

```bash
cd app && npx vitest run src/ui/SettingsPanel.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/src/ui/SettingsPanel.tsx app/src/ui/SettingsPanel.css app/src/ui/SettingsPanel.test.tsx
git commit -m "feat: add update setting UI"
```

## Task 7: Add Release Packaging Script And Tests

**Files:**
- Create: `scripts/release-updater.mjs`
- Create: `scripts/release-updater.test.mjs`
- Modify: `app/package.json`
- Create or modify: `release-dist/.gitignore`

- [ ] **Step 1: Write failing Node tests**

Create `scripts/release-updater.test.mjs`:

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertVersionsMatch,
  buildStaticManifest,
  platformKey,
  updaterFileNameForPlatform,
} from './release-updater.mjs';

test('assertVersionsMatch accepts aligned versions', () => {
  assert.doesNotThrow(() => assertVersionsMatch({
    packageVersion: '0.1.1',
    cargoVersion: '0.1.1',
    tauriVersion: '0.1.1',
  }));
});

test('assertVersionsMatch rejects mismatched versions', () => {
  assert.throws(() => assertVersionsMatch({
    packageVersion: '0.1.1',
    cargoVersion: '0.1.0',
    tauriVersion: '0.1.1',
  }), /Version mismatch/);
});

test('platformKey maps node platform and arch to Tauri keys', () => {
  assert.equal(platformKey('darwin', 'arm64'), 'darwin-aarch64');
  assert.equal(platformKey('darwin', 'x64'), 'darwin-x86_64');
  assert.equal(platformKey('win32', 'x64'), 'windows-x86_64');
});

test('updaterFileNameForPlatform picks v2 updater package names', () => {
  assert.equal(updaterFileNameForPlatform('darwin-aarch64', '桌宠番茄钟', '0.1.1'), '桌宠番茄钟.app.tar.gz');
  assert.equal(updaterFileNameForPlatform('windows-x86_64', '桌宠番茄钟', '0.1.1'), '桌宠番茄钟_0.1.1_x64-setup.nsis.zip');
});

test('buildStaticManifest creates Tauri static JSON shape', () => {
  const manifest = buildStaticManifest({
    version: '0.1.1',
    notes: 'release notes',
    pubDate: '2026-05-18T00:00:00.000Z',
    platforms: [{
      key: 'darwin-aarch64',
      url: 'https://updates.nanzhai.com/cpa/stable/darwin-aarch64/桌宠番茄钟.app.tar.gz',
      signature: 'sig-content',
    }],
  });
  assert.deepEqual(manifest, {
    version: '0.1.1',
    notes: 'release notes',
    pub_date: '2026-05-18T00:00:00.000Z',
    platforms: {
      'darwin-aarch64': {
        url: 'https://updates.nanzhai.com/cpa/stable/darwin-aarch64/桌宠番茄钟.app.tar.gz',
        signature: 'sig-content',
      },
    },
  });
});
```

- [ ] **Step 2: Run failing script tests**

```bash
node --test scripts/release-updater.test.mjs
```

Expected: FAIL because `scripts/release-updater.mjs` does not exist.

- [ ] **Step 3: Implement release script helpers and CLI**

Create `scripts/release-updater.mjs` with exported helpers from the test plus CLI behavior:

```js
#!/usr/bin/env node
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import process from 'node:process';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const APP = path.join(ROOT, 'app');
const TAURI = path.join(APP, 'src-tauri');
const DEFAULT_CDN_BASE = 'https://updates.nanzhai.com/cpa';
const PRODUCT_NAME = '桌宠番茄钟';

export function assertVersionsMatch({ packageVersion, cargoVersion, tauriVersion }) {
  const versions = new Set([packageVersion, cargoVersion, tauriVersion]);
  if (versions.size !== 1) {
    throw new Error(`Version mismatch: package=${packageVersion}, cargo=${cargoVersion}, tauri=${tauriVersion}`);
  }
}

export function platformKey(platform = process.platform, arch = process.arch) {
  const os = platform === 'win32' ? 'windows' : platform;
  const mappedArch = arch === 'arm64' ? 'aarch64' : arch === 'x64' ? 'x86_64' : arch;
  return `${os}-${mappedArch}`;
}

export function updaterFileNameForPlatform(key, productName, version) {
  if (key.startsWith('darwin-')) return `${productName}.app.tar.gz`;
  if (key === 'windows-x86_64') return `${productName}_${version}_x64-setup.nsis.zip`;
  throw new Error(`Unsupported updater platform: ${key}`);
}

export function buildStaticManifest({ version, notes, pubDate, platforms }) {
  return {
    version,
    notes,
    pub_date: pubDate,
    platforms: Object.fromEntries(platforms.map((p) => [
      p.key,
      { url: p.url, signature: p.signature },
    ])),
  };
}

async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}

async function readCargoVersion() {
  const source = await readFile(path.join(TAURI, 'Cargo.toml'), 'utf8');
  const match = source.match(/\[package\][\s\S]*?\nversion\s*=\s*"([^"]+)"/);
  if (!match) throw new Error('Cargo package version not found');
  return match[1];
}

function run(cmd, args, cwd) {
  const result = spawnSync(cmd, args, { cwd, stdio: 'inherit', env: process.env });
  if (result.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed`);
}

async function main() {
  if (!process.env.TAURI_SIGNING_PRIVATE_KEY) {
    throw new Error('TAURI_SIGNING_PRIVATE_KEY is required to build updater artifacts');
  }
  const pkg = await readJson(path.join(APP, 'package.json'));
  const conf = await readJson(path.join(TAURI, 'tauri.conf.json'));
  const cargoVersion = await readCargoVersion();
  assertVersionsMatch({
    packageVersion: pkg.version,
    cargoVersion,
    tauriVersion: conf.version,
  });

  const cdnBase = process.env.CPA_UPDATE_CDN_BASE_URL || DEFAULT_CDN_BASE;
  const channel = process.env.CPA_UPDATE_CHANNEL || 'stable';
  const key = platformKey();
  const updaterName = updaterFileNameForPlatform(key, PRODUCT_NAME, pkg.version);

  run('npm', ['run', 'tauri', 'build'], APP);

  const bundleRoot = path.join(TAURI, 'target/release/bundle');
  const source = key.startsWith('darwin-')
    ? path.join(bundleRoot, 'macos', updaterName)
    : path.join(bundleRoot, 'nsis', updaterName);
  const sig = `${source}.sig`;
  if (!existsSync(source)) throw new Error(`Updater artifact not found: ${source}`);
  if (!existsSync(sig)) throw new Error(`Updater signature not found: ${sig}`);

  const outDir = path.join(ROOT, 'release-dist', channel, key);
  await mkdir(outDir, { recursive: true });
  await copyFile(source, path.join(outDir, updaterName));

  const signature = (await readFile(sig, 'utf8')).trim();
  const manifest = buildStaticManifest({
    version: pkg.version,
    notes: process.env.CPA_UPDATE_NOTES || '',
    pubDate: new Date().toISOString(),
    platforms: [{
      key,
      url: `${cdnBase}/${channel}/${key}/${encodeURIComponent(updaterName)}`,
      signature,
    }],
  });
  const manifestPath = path.join(ROOT, 'release-dist', channel, 'latest.json');
  await mkdir(path.dirname(manifestPath), { recursive: true });
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(path.join(ROOT, 'release-dist', 'README.md'), `Upload the contents of this directory to ${cdnBase}/.\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
```

- [ ] **Step 4: Add generated artifact ignore**

Create `release-dist/.gitignore`:

```gitignore
*
!.gitignore
```

- [ ] **Step 5: Add package script**

In `app/package.json`, add:

```json
"test:release-updater": "node --test ../scripts/release-updater.test.mjs"
```

- [ ] **Step 6: Run script tests**

```bash
node --test scripts/release-updater.test.mjs
cd app && npm run test:release-updater
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add scripts/release-updater.mjs scripts/release-updater.test.mjs release-dist/.gitignore app/package.json app/package-lock.json
git commit -m "feat: add updater release script"
```

## Task 8: Full Verification And Manual Release Notes

**Files:**
- Modify: `docs/superpowers/specs/2026-05-18-silent-background-updates-design.md` only if verification reveals a spec mismatch.

- [ ] **Step 1: Run frontend tests**

```bash
cd app && npm test
```

Expected: all Vitest suites pass.

- [ ] **Step 2: Run release script tests**

```bash
node --test scripts/release-updater.test.mjs
```

Expected: PASS.

- [ ] **Step 3: Run frontend build**

```bash
cd app && npm run build
```

Expected: TypeScript and Vite build pass.

- [ ] **Step 4: Run Rust check**

```bash
cd app/src-tauri && cargo check
```

Expected: Rust compiles with updater/process plugins.

- [ ] **Step 5: Verify updater artifacts can be produced on macOS**

Use the signing key from Task 2:

```bash
export TAURI_SIGNING_PRIVATE_KEY="/Users/xpy/.tauri/cpa-updater.key"
cd app && npm run tauri build
```

Expected: `app/src-tauri/target/release/bundle/macos/桌宠番茄钟.app.tar.gz` and `.sig` exist on macOS.

- [ ] **Step 6: Run release script on macOS**

```bash
export TAURI_SIGNING_PRIVATE_KEY="/Users/xpy/.tauri/cpa-updater.key"
CPA_UPDATE_NOTES="Silent background updater test" node scripts/release-updater.mjs
```

Expected:
- `release-dist/stable/latest.json` exists.
- `release-dist/stable/darwin-aarch64/桌宠番茄钟.app.tar.gz` exists on Apple Silicon.
- `latest.json` has `version`, `notes`, `pub_date`, and `platforms.darwin-aarch64.signature`.

- [ ] **Step 7: Inspect working tree**

```bash
git status --short
```

Expected: only intentionally generated ignored release files are absent from git status; no untracked build artifacts need committing.

- [ ] **Step 8: Commit any final verification/doc adjustments**

If no files changed, skip this step. If a documentation correction was required:

```bash
git add docs/superpowers/specs/2026-05-18-silent-background-updates-design.md
git commit -m "docs: clarify updater verification"
```

## Final Manual Acceptance

Manual runtime update acceptance needs two installed versions. Do this after the implementation branch builds cleanly:

1. Build and install version `0.1.0`.
2. Bump app/Cargo/Tauri versions to `0.1.1` in a disposable release checkout.
3. Build signed updater artifacts for `0.1.1`.
4. Serve `release-dist` from an HTTPS-capable static host, or use a temporary local HTTPS proxy.
5. Launch installed `0.1.0`.
6. Wait for the 30 second delayed check.
7. Confirm no intrusive popup appears while downloading/installing.
8. Confirm the ready prompt appears with `新版本已准备好，重启后生效`.
9. Click `重启更新`.
10. Confirm the relaunched app reports version `0.1.1`.
11. Repeat on Windows before advertising Windows updater support.
