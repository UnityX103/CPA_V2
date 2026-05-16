# Dangerous Global Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a reusable dangerous Global settings flow where UI scale previews immediately, shows a blocking 5 second confirmation dialog, reverts on timeout/cancel, and persists only on Apply.

**Architecture:** Keep the main window as the source of truth. Extend the settings domain store with committed scale, effective preview scale, and one pending dangerous change; mirror that state through the existing settings bridge. Persist committed settings through a small Tauri Store helper and keep UI components limited to calling domain actions.

**Tech Stack:** React 19, TypeScript, Zustand, Vitest/jsdom, Tauri 2, `@tauri-apps/plugin-store`, native CSS.

---

## File Structure

- Modify `app/src/domain/settings.ts`
  - Owns scale clamping, committed/effective scale state, dangerous preview/apply/revert actions, and settings-window dispatch behavior.
- Create `app/src/domain/settingsPersistence.ts`
  - Owns Tauri Store load/save for persisted settings. This is the only frontend file that imports `@tauri-apps/plugin-store`.
- Modify `app/src/domain/settings.test.ts`
  - Covers dangerous preview semantics and settings-window dispatch semantics.
- Modify `app/src/domain/bridge/protocol.ts`
  - Adds committed scale and pending dangerous change to snapshots; adds preview/apply/revert dispatch variants.
- Modify `app/src/domain/bridge/host.ts`
  - Includes new fields in snapshots and routes new dispatch actions into the source settings store.
- Modify `app/src/domain/bridge/client.ts`
  - Mirrors new fields into the settings-window store.
- Modify `app/src/domain/bridge/host.test.ts`, `app/src/domain/bridge/client.test.ts`, `app/src/domain/bridge/protocol.test.ts`
  - Updates bridge coverage for dangerous settings.
- Create `app/src/ui/DangerousChangeDialog.tsx`
  - Renders the `bfMCZ`-style blocking mask/dialog and owns countdown timer behavior.
- Modify `app/src/ui/SettingsPanel.tsx`
  - Routes the scale slider through dangerous preview actions and makes the slider pointer-capture based.
- Modify `app/src/ui/SettingsPanel.css`
  - Adds dialog/mask styling and slider dragging affordances.
- Modify `app/src/ui/SettingsPanel.test.tsx`
  - Covers slider drag, modal presence, apply/cancel actions, and timeout revert.
- Modify `app/src/App.tsx`, `app/src/SettingsApp.tsx`, `app/src/styles/global.css`
  - Applies the effective scale to main/settings content roots without resizing windows, and hydrates persisted settings from the main window.

---

### Task 1: Settings Domain Dangerous State

**Files:**
- Modify: `app/src/domain/settings.ts`
- Modify: `app/src/domain/settings.test.ts`

- [ ] **Step 1: Replace the reset helper in `settings.test.ts` and add failing dangerous state tests**

Add these imports and helpers near the top of `app/src/domain/settings.test.ts`:

```ts
import {
    useSettingsStore,
    MIN_SCALE,
    MAX_SCALE,
    DANGEROUS_CHANGE_TIMEOUT_MS,
    type DangerousChange,
} from './settings';
```

Replace the existing `beforeEach` body with:

```ts
beforeEach(() => {
    useSettingsStore.setState({
        activeTab: 'pomodoro',
        uiScale: 1.0,
        committedUiScale: 1.0,
        dangerousChange: null,
    });
});
```

Add these tests inside `describe('useSettingsStore', ...)`:

```ts
it('previewDangerousUiScale records previous and next values', () => {
    const before = Date.now();
    useSettingsStore.getState().previewDangerousUiScale(1.75);
    const state = useSettingsStore.getState();

    expect(state.uiScale).toBe(1.75);
    expect(state.committedUiScale).toBe(1.0);
    expect(state.dangerousChange).toEqual(expect.objectContaining({
        kind: 'uiScale',
        previousValue: 1.0,
        nextValue: 1.75,
    }));
    expect(state.dangerousChange!.expiresAt).toBeGreaterThanOrEqual(before + DANGEROUS_CHANGE_TIMEOUT_MS);
});

it('previewDangerousUiScale updates an existing preview without changing previousValue', () => {
    useSettingsStore.getState().previewDangerousUiScale(1.5);
    const first = useSettingsStore.getState().dangerousChange as DangerousChange;

    useSettingsStore.getState().previewDangerousUiScale(2.0);
    const second = useSettingsStore.getState().dangerousChange as DangerousChange;

    expect(second.id).toBe(first.id);
    expect(second.previousValue).toBe(1.0);
    expect(second.nextValue).toBe(2.0);
    expect(useSettingsStore.getState().uiScale).toBe(2.0);
});

it('revertDangerousChange restores previous committed scale', () => {
    useSettingsStore.getState().previewDangerousUiScale(1.8);
    const id = useSettingsStore.getState().dangerousChange!.id;

    useSettingsStore.getState().revertDangerousChange(id);

    expect(useSettingsStore.getState().uiScale).toBe(1.0);
    expect(useSettingsStore.getState().committedUiScale).toBe(1.0);
    expect(useSettingsStore.getState().dangerousChange).toBeNull();
});

it('applyDangerousChange commits the preview scale', () => {
    useSettingsStore.getState().previewDangerousUiScale(1.8);
    const id = useSettingsStore.getState().dangerousChange!.id;

    useSettingsStore.getState().applyDangerousChange(id);

    expect(useSettingsStore.getState().uiScale).toBe(1.8);
    expect(useSettingsStore.getState().committedUiScale).toBe(1.8);
    expect(useSettingsStore.getState().dangerousChange).toBeNull();
});

it('ignores stale apply and revert ids', () => {
    useSettingsStore.getState().previewDangerousUiScale(1.8);

    useSettingsStore.getState().applyDangerousChange('stale-id');
    expect(useSettingsStore.getState().dangerousChange).not.toBeNull();
    expect(useSettingsStore.getState().committedUiScale).toBe(1.0);

    useSettingsStore.getState().revertDangerousChange('stale-id');
    expect(useSettingsStore.getState().dangerousChange).not.toBeNull();
    expect(useSettingsStore.getState().uiScale).toBe(1.8);
});

it('hydrateSettings clamps persisted scale into committed and effective scale', () => {
    useSettingsStore.getState().hydrateSettings({ uiScale: 99 });
    expect(useSettingsStore.getState().uiScale).toBe(MAX_SCALE);
    expect(useSettingsStore.getState().committedUiScale).toBe(MAX_SCALE);
    expect(useSettingsStore.getState().dangerousChange).toBeNull();
});
```

- [ ] **Step 2: Run the domain tests and verify they fail**

Run:

```bash
cd app && npx vitest run src/domain/settings.test.ts
```

Expected: FAIL with TypeScript/runtime errors for missing `DANGEROUS_CHANGE_TIMEOUT_MS`, `DangerousChange`, `committedUiScale`, `dangerousChange`, `previewDangerousUiScale`, `applyDangerousChange`, `revertDangerousChange`, and `hydrateSettings`.

- [ ] **Step 3: Implement dangerous state in `settings.ts`**

Replace `app/src/domain/settings.ts` with:

```ts
import { create, type StoreApi, type UseBoundStore } from 'zustand';
import { dispatch } from './bridge/dispatch';
import { BRIDGE_VERSION } from './bridge/protocol';
import { savePersistedSettings } from './settingsPersistence';

export type SettingsTab = 'pomodoro' | 'online' | 'pet' | 'global';
export type DangerousSettingKind = 'uiScale';

export interface DangerousChange {
    id: string;
    kind: DangerousSettingKind;
    previousValue: number;
    nextValue: number;
    expiresAt: number;
}

export interface SettingsState {
    activeTab: SettingsTab;
    uiScale: number;
    committedUiScale: number;
    dangerousChange: DangerousChange | null;
}

export interface PersistedSettingsSnapshot {
    uiScale: number;
}

interface SettingsActions {
    setActiveTab: (tab: SettingsTab) => void;
    setUiScale: (scale: number) => void;
    previewDangerousUiScale: (scale: number) => void;
    applyDangerousChange: (id: string) => void;
    revertDangerousChange: (id: string) => void;
    hydrateSettings: (snapshot: PersistedSettingsSnapshot) => void;
}

export const MIN_SCALE = 0.5;
export const MAX_SCALE = 3.0;
export const DANGEROUS_CHANGE_TIMEOUT_MS = 5000;

export type SettingsStore = UseBoundStore<StoreApi<SettingsState & SettingsActions>>;

function clampScale(scale: number): number {
    if (!Number.isFinite(scale)) return 1.0;
    return Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale));
}

function createDangerousChangeId(): string {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
        return crypto.randomUUID();
    }
    return `danger-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function createSettingsStore(opts: { isSettingsWindow: boolean }): SettingsStore {
    if (opts.isSettingsWindow) {
        return create<SettingsState & SettingsActions>((set) => ({
            activeTab: 'pomodoro',
            uiScale: 1.0,
            committedUiScale: 1.0,
            dangerousChange: null,
            setActiveTab: (tab) => set({ activeTab: tab }),
            setUiScale: (scale) => {
                void dispatch({ v: BRIDGE_VERSION, store: 'settings', action: 'setUiScale', args: [scale] });
            },
            previewDangerousUiScale: (scale) => {
                void dispatch({ v: BRIDGE_VERSION, store: 'settings', action: 'previewDangerousUiScale', args: [scale] });
            },
            applyDangerousChange: (id) => {
                void dispatch({ v: BRIDGE_VERSION, store: 'settings', action: 'applyDangerousChange', args: [id] });
            },
            revertDangerousChange: (id) => {
                void dispatch({ v: BRIDGE_VERSION, store: 'settings', action: 'revertDangerousChange', args: [id] });
            },
            hydrateSettings: (snapshot) => {
                const uiScale = clampScale(snapshot.uiScale);
                set({ uiScale, committedUiScale: uiScale, dangerousChange: null });
            },
        }));
    }

    return create<SettingsState & SettingsActions>((set, get) => ({
        activeTab: 'pomodoro',
        uiScale: 1.0,
        committedUiScale: 1.0,
        dangerousChange: null,
        setActiveTab: (tab) => set({ activeTab: tab }),
        setUiScale: (scale) => {
            const uiScale = clampScale(scale);
            set({ uiScale, committedUiScale: uiScale, dangerousChange: null });
        },
        previewDangerousUiScale: (scale) => {
            const nextValue = clampScale(scale);
            const existing = get().dangerousChange;
            const previousValue = existing?.kind === 'uiScale'
                ? existing.previousValue
                : get().committedUiScale;
            set({
                uiScale: nextValue,
                dangerousChange: {
                    id: existing?.kind === 'uiScale' ? existing.id : createDangerousChangeId(),
                    kind: 'uiScale',
                    previousValue,
                    nextValue,
                    expiresAt: Date.now() + DANGEROUS_CHANGE_TIMEOUT_MS,
                },
            });
        },
        applyDangerousChange: (id) => {
            const change = get().dangerousChange;
            if (!change || change.id !== id) return;
            const committedUiScale = change.nextValue;
            set({ uiScale: committedUiScale, committedUiScale, dangerousChange: null });
            void savePersistedSettings({ uiScale: committedUiScale });
        },
        revertDangerousChange: (id) => {
            const change = get().dangerousChange;
            if (!change || change.id !== id) return;
            set({ uiScale: change.previousValue, dangerousChange: null });
        },
        hydrateSettings: (snapshot) => {
            const uiScale = clampScale(snapshot.uiScale);
            set({ uiScale, committedUiScale: uiScale, dangerousChange: null });
        },
    }));
}

function detectIsSettingsWindow(): boolean {
    if (typeof window === 'undefined') return false;
    return new URLSearchParams(window.location.search).get('window') === 'settings';
}

export const useSettingsStore: SettingsStore = createSettingsStore({
    isSettingsWindow: detectIsSettingsWindow(),
});
```

- [ ] **Step 4: Create a temporary persistence stub so TypeScript resolves**

Create `app/src/domain/settingsPersistence.ts` with:

```ts
export interface PersistedSettings {
    uiScale: number;
}

export async function loadPersistedSettings(): Promise<PersistedSettings | null> {
    return null;
}

export async function savePersistedSettings(_settings: PersistedSettings): Promise<void> {
    return Promise.resolve();
}
```

- [ ] **Step 5: Run the domain tests and verify they pass**

Run:

```bash
cd app && npx vitest run src/domain/settings.test.ts
```

Expected: PASS for `settings.test.ts`.

- [ ] **Step 6: Commit Task 1**

```bash
git add app/src/domain/settings.ts app/src/domain/settings.test.ts app/src/domain/settingsPersistence.ts
git commit -m "feat: model dangerous settings previews"
```

---

### Task 2: Persistence Helper and Main-Window Hydration

**Files:**
- Modify: `app/src/domain/settingsPersistence.ts`
- Create: `app/src/domain/settingsPersistence.test.ts`
- Modify: `app/src/App.tsx`

- [ ] **Step 1: Write failing persistence helper tests**

Create `app/src/domain/settingsPersistence.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const store = {
    get: vi.fn(),
    set: vi.fn(),
    save: vi.fn(),
};

vi.mock('@tauri-apps/plugin-store', () => ({
    load: vi.fn(() => Promise.resolve(store)),
}));

describe('settingsPersistence', () => {
    beforeEach(() => {
        store.get.mockReset();
        store.set.mockReset();
        store.save.mockReset();
    });

    it('loads persisted v1 settings', async () => {
        store.get.mockResolvedValue({ v: 1, uiScale: 1.75 });
        const { loadPersistedSettings } = await import('./settingsPersistence');

        await expect(loadPersistedSettings()).resolves.toEqual({ uiScale: 1.75 });
    });

    it('ignores malformed persisted settings', async () => {
        store.get.mockResolvedValue({ v: 1, uiScale: 'large' });
        const { loadPersistedSettings } = await import('./settingsPersistence');

        await expect(loadPersistedSettings()).resolves.toBeNull();
    });

    it('saves persisted v1 settings', async () => {
        const { savePersistedSettings } = await import('./settingsPersistence');

        await savePersistedSettings({ uiScale: 2 });

        expect(store.set).toHaveBeenCalledWith('settings', { v: 1, uiScale: 2 });
        expect(store.save).toHaveBeenCalledTimes(1);
    });
});
```

- [ ] **Step 2: Run the persistence tests and verify they fail**

Run:

```bash
cd app && npx vitest run src/domain/settingsPersistence.test.ts
```

Expected: FAIL because the stub always returns `null` and does not call Tauri Store.

- [ ] **Step 3: Implement `settingsPersistence.ts`**

Replace `app/src/domain/settingsPersistence.ts` with:

```ts
import { load } from '@tauri-apps/plugin-store';

const STORE_PATH = 'settings.json';
const STORE_KEY = 'settings';

export interface PersistedSettings {
    uiScale: number;
}

interface PersistedSettingsV1 {
    v: 1;
    uiScale: number;
}

function isPersistedSettingsV1(value: unknown): value is PersistedSettingsV1 {
    if (!value || typeof value !== 'object') return false;
    const candidate = value as Partial<PersistedSettingsV1>;
    return candidate.v === 1 && typeof candidate.uiScale === 'number' && Number.isFinite(candidate.uiScale);
}

async function openStore() {
    return load(STORE_PATH, { autoSave: false });
}

export async function loadPersistedSettings(): Promise<PersistedSettings | null> {
    try {
        const store = await openStore();
        const value = await store.get<unknown>(STORE_KEY);
        if (!isPersistedSettingsV1(value)) return null;
        return { uiScale: value.uiScale };
    } catch (err) {
        console.warn('[settingsPersistence] load failed', err);
        return null;
    }
}

export async function savePersistedSettings(settings: PersistedSettings): Promise<void> {
    try {
        const store = await openStore();
        await store.set(STORE_KEY, { v: 1, uiScale: settings.uiScale } satisfies PersistedSettingsV1);
        await store.save();
    } catch (err) {
        console.warn('[settingsPersistence] save failed', err);
    }
}
```

- [ ] **Step 4: Run persistence tests and verify they pass**

Run:

```bash
cd app && npx vitest run src/domain/settingsPersistence.test.ts
```

Expected: PASS.

- [ ] **Step 5: Add main-window hydration in `App.tsx`**

Modify `app/src/App.tsx`:

```tsx
import { useEffect, type CSSProperties } from 'react';
import { PomodoroPanel } from './ui/PomodoroPanel';
import { RemoteRoster } from './ui/RemoteRoster';
import { useStateSync } from './domain/stateSync';
import { useActiveAppListener } from './domain/activeApp';
import { useBindingKeyListener } from './domain/bindingKey';
import { useBridgeHost } from './domain/bridge/host';
import { useSettingsStore } from './domain/settings';
import { loadPersistedSettings } from './domain/settingsPersistence';

export default function App() {
    useStateSync();
    useActiveAppListener();
    useBindingKeyListener();
    useBridgeHost();

    useEffect(() => {
        let cancelled = false;
        loadPersistedSettings()
            .then((settings) => {
                if (cancelled || !settings) return;
                useSettingsStore.getState().hydrateSettings(settings);
            })
            .catch((err) => {
                console.warn('[settings] hydration failed', err);
            });
        return () => {
            cancelled = true;
        };
    }, []);

    return (
        <div className="app-scale-root" style={{ '--app-ui-scale': String(useSettingsStore((s) => s.uiScale)) } as CSSProperties}>
            <div className="app-root">
                <PomodoroPanel />
                <RemoteRoster />
            </div>
        </div>
    );
}
```

- [ ] **Step 6: Run domain tests touched so far**

Run:

```bash
cd app && npx vitest run src/domain/settings.test.ts src/domain/settingsPersistence.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit Task 2**

```bash
git add app/src/domain/settingsPersistence.ts app/src/domain/settingsPersistence.test.ts app/src/App.tsx
git commit -m "feat: persist dangerous settings commits"
```

---

### Task 3: Bridge Dangerous Settings State

**Files:**
- Modify: `app/src/domain/bridge/protocol.ts`
- Modify: `app/src/domain/bridge/host.ts`
- Modify: `app/src/domain/bridge/client.ts`
- Modify: `app/src/domain/bridge/host.test.ts`
- Modify: `app/src/domain/bridge/client.test.ts`
- Modify: `app/src/domain/bridge/protocol.test.ts`
- Modify: `app/src/domain/settings.test.ts`

- [ ] **Step 1: Write failing bridge tests**

In `app/src/domain/bridge/host.test.ts`, change the `beforeEach` to:

```ts
beforeEach(() => {
    useSettingsStore.setState({
        uiScale: 1.0,
        committedUiScale: 1.0,
        dangerousChange: null,
        activeTab: 'pomodoro',
    });
});
```

Add this test under `buildSnapshot`:

```ts
it('includes committed scale and dangerous change state', () => {
    useSettingsStore.getState().previewDangerousUiScale(1.5);
    const snap = buildSnapshot();

    expect(snap.settings.uiScale).toBe(1.5);
    expect(snap.settings.committedUiScale).toBe(1.0);
    expect(snap.settings.dangerousChange).toEqual(expect.objectContaining({
        kind: 'uiScale',
        previousValue: 1.0,
        nextValue: 1.5,
    }));
});
```

Replace the old `routes settings/setUiScale...` test with:

```ts
it('routes settings dangerous preview/apply/revert actions', () => {
    applyDispatch({ v: BRIDGE_VERSION, store: 'settings', action: 'previewDangerousUiScale', args: [1.75] });
    const id = useSettingsStore.getState().dangerousChange!.id;
    expect(useSettingsStore.getState().uiScale).toBe(1.75);

    applyDispatch({ v: BRIDGE_VERSION, store: 'settings', action: 'revertDangerousChange', args: [id] });
    expect(useSettingsStore.getState().uiScale).toBe(1.0);

    applyDispatch({ v: BRIDGE_VERSION, store: 'settings', action: 'previewDangerousUiScale', args: [2.0] });
    const applyId = useSettingsStore.getState().dangerousChange!.id;
    applyDispatch({ v: BRIDGE_VERSION, store: 'settings', action: 'applyDangerousChange', args: [applyId] });
    expect(useSettingsStore.getState().committedUiScale).toBe(2.0);
});
```

In `app/src/domain/bridge/client.test.ts`, update `SAMPLE.settings`:

```ts
settings: {
    uiScale: 2.0,
    committedUiScale: 1.0,
    dangerousChange: {
        id: 'scale-pending',
        kind: 'uiScale',
        previousValue: 1.0,
        nextValue: 2.0,
        expiresAt: 12345,
    },
},
```

Add assertions to the first client test:

```ts
expect(useSettingsStore.getState().committedUiScale).toBe(1.0);
expect(useSettingsStore.getState().dangerousChange?.id).toBe('scale-pending');
```

In `app/src/domain/settings.test.ts`, add a settings-window dispatch test:

```ts
it('dangerous actions dispatch instead of mutating local state', () => {
    const spy = vi.spyOn(dispatchMod, 'dispatch').mockResolvedValue();
    const store = createSettingsStore({ isSettingsWindow: true });

    store.getState().previewDangerousUiScale(1.75);
    store.getState().applyDangerousChange('pending-id');
    store.getState().revertDangerousChange('pending-id');

    expect(store.getState().uiScale).toBe(1.0);
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({
        v: BRIDGE_VERSION,
        store: 'settings',
        action: 'previewDangerousUiScale',
        args: [1.75],
    }));
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({
        v: BRIDGE_VERSION,
        store: 'settings',
        action: 'applyDangerousChange',
        args: ['pending-id'],
    }));
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({
        v: BRIDGE_VERSION,
        store: 'settings',
        action: 'revertDangerousChange',
        args: ['pending-id'],
    }));
    spy.mockRestore();
});
```

- [ ] **Step 2: Run bridge/settings tests and verify they fail**

Run:

```bash
cd app && npx vitest run src/domain/bridge/host.test.ts src/domain/bridge/client.test.ts src/domain/settings.test.ts
```

Expected: FAIL because protocol and bridge code do not yet include the new snapshot/dispatch shape.

- [ ] **Step 3: Update `protocol.ts`**

Modify `app/src/domain/bridge/protocol.ts`:

```ts
import type { BindingKeyEntry } from '../bindingKey';
import type { DangerousChange } from '../settings';
import type { ConnectionStatus, RemotePlayer } from '../network';

export const EVT_STATE_REQUEST = 'app:state:request';
export const EVT_STATE = 'app:state';
export const EVT_DISPATCH = 'app:dispatch';
export const BRIDGE_VERSION = 1 as const;

export interface BridgeSnapshot {
    v: typeof BRIDGE_VERSION;
    settings: {
        uiScale: number;
        committedUiScale: number;
        dangerousChange: DangerousChange | null;
    };
    pomodoro: {
        focusDurationSeconds: number;
        breakDurationSeconds: number;
        totalRounds: number;
    };
    network: {
        autoConnect: boolean;
        playerName: string;
        playerId: string | null;
        roomCode: string;
        status: ConnectionStatus;
        players: Record<string, RemotePlayer>;
        lastError: string | null;
    };
    bindingKey: {
        entries: BindingKeyEntry[];
        capturingId: string | null;
        syncedKeyId: string | null;
    };
}

export type DispatchPayload =
    | { v: typeof BRIDGE_VERSION; store: 'settings';   action: 'setUiScale' | 'previewDangerousUiScale'; args: [number] }
    | { v: typeof BRIDGE_VERSION; store: 'settings';   action: 'applyDangerousChange' | 'revertDangerousChange'; args: [string] }
    | { v: typeof BRIDGE_VERSION; store: 'pomodoro';   action: 'applySettings'; args: [number, number, number, boolean] }
    | { v: typeof BRIDGE_VERSION; store: 'network';    action: 'createRoom' | 'joinRoom'; args: [string] }
    | { v: typeof BRIDGE_VERSION; store: 'network';    action: 'leaveRoom'; args: [] }
    | { v: typeof BRIDGE_VERSION; store: 'network';    action: 'setAutoConnect'; args: [boolean] }
    | { v: typeof BRIDGE_VERSION; store: 'network';    action: 'setPlayerName'; args: [string] }
    | { v: typeof BRIDGE_VERSION; store: 'bindingKey'; action: 'beginCapture' | 'removeEntry'; args: [string] }
    | { v: typeof BRIDGE_VERSION; store: 'bindingKey'; action: 'setSynced'; args: [string | null] }
    | { v: typeof BRIDGE_VERSION; store: 'bindingKey'; action: 'addEntry'; args: [] };
```

- [ ] **Step 4: Update `host.ts`**

In `buildSnapshot`, replace the settings snapshot with:

```ts
settings: {
    uiScale: s.uiScale,
    committedUiScale: s.committedUiScale,
    dangerousChange: s.dangerousChange,
},
```

In `applyDispatch`, replace the settings case with:

```ts
case 'settings': {
    const s = useSettingsStore.getState();
    switch (payload.action) {
        case 'setUiScale': s.setUiScale(...payload.args); return;
        case 'previewDangerousUiScale': s.previewDangerousUiScale(...payload.args); return;
        case 'applyDangerousChange': s.applyDangerousChange(...payload.args); return;
        case 'revertDangerousChange': s.revertDangerousChange(...payload.args); return;
    }
    return;
}
```

- [ ] **Step 5: Update `client.ts`**

In `applySnapshotToMirrors`, replace the settings `setState` call with:

```ts
useSettingsStore.setState({
    uiScale: snap.settings.uiScale,
    committedUiScale: snap.settings.committedUiScale,
    dangerousChange: snap.settings.dangerousChange,
});
```

- [ ] **Step 6: Update `protocol.test.ts` sample payloads**

Where the test creates a `BridgeSnapshot`, use:

```ts
settings: { uiScale: 1.5, committedUiScale: 1.0, dangerousChange: null },
```

Where it lists valid dispatch payloads, include:

```ts
{ v: 1, store: 'settings', action: 'previewDangerousUiScale', args: [1.5] },
{ v: 1, store: 'settings', action: 'applyDangerousChange', args: ['pending-id'] },
{ v: 1, store: 'settings', action: 'revertDangerousChange', args: ['pending-id'] },
```

- [ ] **Step 7: Run bridge/settings tests and verify they pass**

Run:

```bash
cd app && npx vitest run src/domain/bridge/host.test.ts src/domain/bridge/client.test.ts src/domain/bridge/protocol.test.ts src/domain/settings.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit Task 3**

```bash
git add app/src/domain/bridge/protocol.ts app/src/domain/bridge/host.ts app/src/domain/bridge/client.ts app/src/domain/bridge/host.test.ts app/src/domain/bridge/client.test.ts app/src/domain/bridge/protocol.test.ts app/src/domain/settings.test.ts
git commit -m "feat: bridge dangerous settings previews"
```

---

### Task 4: Blocking Dangerous Change Dialog

**Files:**
- Create: `app/src/ui/DangerousChangeDialog.tsx`
- Modify: `app/src/ui/SettingsPanel.css`
- Modify: `app/src/ui/SettingsPanel.test.tsx`
- Modify: `app/src/SettingsApp.tsx`

- [ ] **Step 1: Write failing UI tests for the dialog**

In `app/src/ui/SettingsPanel.test.tsx`, add `afterEach` to the imports:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
```

Add this import to `app/src/ui/SettingsPanel.test.tsx`:

```ts
import { DangerousChangeDialog } from './DangerousChangeDialog';
```

Add this helper near the top-level test helpers:

```tsx
function renderSettingsPanelWithDangerDialog() {
    return render(
        <>
            <SettingsPanel />
            <DangerousChangeDialog />
        </>,
    );
}
```

Add these tests under `describe('GlobalTab parity with Pdj9C', ...)`:

```tsx
it('shows a blocking dangerous-change dialog when a scale preview is pending', () => {
    useSettingsStore.setState({
        activeTab: 'global',
        uiScale: 1.5,
        committedUiScale: 1.0,
        dangerousChange: {
            id: 'scale-preview',
            kind: 'uiScale',
            previousValue: 1.0,
            nextValue: 1.5,
            expiresAt: Date.now() + 5000,
        },
    });

    renderSettingsPanelWithDangerDialog();

    expect(screen.getByRole('dialog', { name: '应用界面缩放？' })).toBeTruthy();
    expect(screen.getByText(/剩余 5s 后自动还原/)).toBeTruthy();
    expect(screen.getByTestId('dangerous-change-mask')).toBeTruthy();
});

it('dialog apply and cancel route to the pending dangerous action', async () => {
    useSettingsStore.setState({
        activeTab: 'global',
        uiScale: 1.5,
        committedUiScale: 1.0,
        dangerousChange: {
            id: 'scale-preview',
            kind: 'uiScale',
            previousValue: 1.0,
            nextValue: 1.5,
            expiresAt: Date.now() + 5000,
        },
    });
    const applySpy = vi.spyOn(useSettingsStore.getState(), 'applyDangerousChange');
    const revertSpy = vi.spyOn(useSettingsStore.getState(), 'revertDangerousChange');

    renderSettingsPanelWithDangerDialog();

    await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: '应用' }));
    });
    expect(applySpy).toHaveBeenCalledWith('scale-preview');

    useSettingsStore.setState({
        dangerousChange: {
            id: 'scale-preview',
            kind: 'uiScale',
            previousValue: 1.0,
            nextValue: 1.5,
            expiresAt: Date.now() + 5000,
        },
    });

    await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: '取消' }));
    });
    expect(revertSpy).toHaveBeenCalledWith('scale-preview');
});

it('dialog countdown expiry reverts the pending dangerous change', async () => {
    vi.useFakeTimers();
    useSettingsStore.setState({
        activeTab: 'global',
        uiScale: 1.5,
        committedUiScale: 1.0,
        dangerousChange: {
            id: 'scale-preview',
            kind: 'uiScale',
            previousValue: 1.0,
            nextValue: 1.5,
            expiresAt: Date.now() + 5000,
        },
    });
    const revertSpy = vi.spyOn(useSettingsStore.getState(), 'revertDangerousChange');

    renderSettingsPanelWithDangerDialog();

    await act(async () => {
        vi.advanceTimersByTime(5000);
    });

    expect(revertSpy).toHaveBeenCalledWith('scale-preview');
    vi.useRealTimers();
});
```

Add this cleanup at file scope:

```ts
afterEach(() => {
    vi.useRealTimers();
});
```

- [ ] **Step 2: Run the SettingsPanel tests and verify they fail**

Run:

```bash
cd app && npx vitest run src/ui/SettingsPanel.test.tsx
```

Expected: FAIL because the dialog component is not rendered.

- [ ] **Step 3: Create `DangerousChangeDialog.tsx`**

Create `app/src/ui/DangerousChangeDialog.tsx`:

```tsx
import { useEffect, useMemo, useState } from 'react';
import { useSettingsStore, type DangerousChange } from '../domain/settings';

function secondsRemaining(change: DangerousChange, now: number): number {
    return Math.max(0, Math.ceil((change.expiresAt - now) / 1000));
}

export function DangerousChangeDialog() {
    const change = useSettingsStore((s) => s.dangerousChange);
    const applyDangerousChange = useSettingsStore((s) => s.applyDangerousChange);
    const revertDangerousChange = useSettingsStore((s) => s.revertDangerousChange);
    const [now, setNow] = useState(() => Date.now());

    useEffect(() => {
        if (!change) return;
        setNow(Date.now());
        const interval = window.setInterval(() => {
            setNow(Date.now());
        }, 250);
        return () => window.clearInterval(interval);
    }, [change?.id]);

    useEffect(() => {
        if (!change) return;
        if (now >= change.expiresAt) {
            revertDangerousChange(change.id);
        }
    }, [change, now, revertDangerousChange]);

    const copy = useMemo(() => {
        if (change?.kind === 'uiScale') {
            return {
                title: '应用界面缩放？',
                body: '界面缩放会立即影响所有窗口。如果当前比例导致界面难以操作，倒计时结束后会自动还原。',
            };
        }
        return {
            title: '应用危险设置？',
            body: '此设置会立即影响全局界面。倒计时结束后会自动还原。',
        };
    }, [change?.kind]);

    if (!change) return null;

    return (
        <div className="danger-modal-layer" aria-modal="true">
            <div className="danger-modal-mask" data-testid="dangerous-change-mask" />
            <div className="danger-dialog" role="dialog" aria-label={copy.title}>
                <div className="danger-dialog-header">
                    <div className="danger-dialog-title-wrap">
                        <h3 className="danger-dialog-title">{copy.title}</h3>
                    </div>
                </div>
                <div className="danger-dialog-countdown">
                    剩余 {secondsRemaining(change, now)}s 后自动还原
                </div>
                <p className="danger-dialog-body">{copy.body}</p>
                <div className="danger-dialog-actions">
                    <button className="btn btn-secondary btn-fit" onClick={() => revertDangerousChange(change.id)}>
                        取消
                    </button>
                    <button className="btn btn-primary btn-fit" onClick={() => applyDangerousChange(change.id)}>
                        应用
                    </button>
                </div>
            </div>
        </div>
    );
}
```

- [ ] **Step 4: Render the dialog from `SettingsApp.tsx`**

Replace `app/src/SettingsApp.tsx` with:

```tsx
import type { CSSProperties } from 'react';
import { SettingsPanel } from './ui/SettingsPanel';
import { DangerousChangeDialog } from './ui/DangerousChangeDialog';
import { useBridgeClient } from './domain/bridge/client';
import { useSettingsStore } from './domain/settings';
import './styles/global.css';

export default function SettingsApp() {
    useBridgeClient();
    const uiScale = useSettingsStore((s) => s.uiScale);

    return (
        <div className="settings-window-root" style={{ '--app-ui-scale': String(uiScale) } as CSSProperties}>
            <div className="settings-scale-content">
                <SettingsPanel />
            </div>
            <DangerousChangeDialog />
        </div>
    );
}
```

- [ ] **Step 5: Add CSS for the mask/dialog**

Append to `app/src/ui/SettingsPanel.css`:

```css
.danger-modal-layer {
    position: absolute;
    inset: 0;
    z-index: 100;
    display: flex;
    align-items: center;
    justify-content: center;
}

.danger-modal-mask {
    position: absolute;
    inset: 0;
    background: rgba(17, 24, 39, 0.28);
}

.danger-dialog {
    position: relative;
    width: min(var(--dialog-w), calc(100% - 32px));
    border-radius: var(--dialog-radius);
    background: #FFFFFF;
    padding: var(--dialog-padding);
    display: flex;
    flex-direction: column;
    gap: var(--dialog-gap);
    box-shadow: var(--dialog-shadow);
}

.danger-dialog-header {
    display: flex;
    justify-content: space-between;
    width: 100%;
}

.danger-dialog-title-wrap {
    display: flex;
    flex-direction: column;
    gap: 4px;
}

.danger-dialog-title {
    margin: 0;
    font-family: var(--font-cn);
    font-size: 18px;
    font-weight: 800;
    color: var(--text-primary);
}

.danger-dialog-countdown {
    width: 100%;
    text-align: center;
    color: var(--dialog-countdown-color);
    font-family: var(--font-cn);
    font-size: 13px;
    font-weight: 700;
}

.danger-dialog-body {
    margin: 0;
    width: 100%;
    color: var(--dialog-body-color);
    font-family: var(--font-cn);
    font-size: 14px;
    font-weight: 500;
    line-height: 1.5;
}

.danger-dialog-actions {
    display: flex;
    justify-content: flex-end;
    gap: 12px;
    width: 100%;
}
```

Add `position: relative;` to `.settings-window-root` in `app/src/styles/global.css` during Task 6. Until Task 6 lands, tests can still render the dialog next to `SettingsPanel`; the CSS layer becomes window-anchored once `settings-window-root` exists.

- [ ] **Step 6: Run SettingsPanel tests**

Run:

```bash
cd app && npx vitest run src/ui/SettingsPanel.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit Task 4**

```bash
git add app/src/ui/DangerousChangeDialog.tsx app/src/SettingsApp.tsx app/src/ui/SettingsPanel.css app/src/ui/SettingsPanel.test.tsx
git commit -m "feat: add dangerous settings confirmation dialog"
```

---

### Task 5: Drag-Follow Slider Preview

**Files:**
- Modify: `app/src/ui/SettingsPanel.tsx`
- Modify: `app/src/ui/SettingsPanel.css`
- Modify: `app/src/ui/SettingsPanel.test.tsx`

- [ ] **Step 1: Add failing slider drag test**

Add this test under `GlobalTab parity with Pdj9C`:

```tsx
it('scale slider previews continuously while dragging', async () => {
    useSettingsStore.setState({
        activeTab: 'global',
        uiScale: 1.0,
        committedUiScale: 1.0,
        dangerousChange: null,
    });
    const previewSpy = vi.spyOn(useSettingsStore.getState(), 'previewDangerousUiScale');

    render(<SettingsPanel />);
    const slider = screen.getByRole('slider');
    vi.spyOn(slider, 'getBoundingClientRect').mockReturnValue({
        x: 0,
        y: 0,
        left: 0,
        top: 0,
        right: 200,
        bottom: 24,
        width: 200,
        height: 24,
        toJSON: () => ({}),
    } as DOMRect);
    slider.setPointerCapture = vi.fn();
    slider.releasePointerCapture = vi.fn();

    await act(async () => {
        fireEvent.pointerDown(slider, { pointerId: 1, button: 0, clientX: 100 });
        fireEvent.pointerMove(slider, { pointerId: 1, clientX: 160 });
        fireEvent.pointerUp(slider, { pointerId: 1, clientX: 160 });
    });

    expect(previewSpy).toHaveBeenCalledWith(1.75);
    expect(previewSpy).toHaveBeenCalledWith(2.5);
    expect(slider.setPointerCapture).toHaveBeenCalledWith(1);
    expect(slider.releasePointerCapture).toHaveBeenCalledWith(1);
});
```

- [ ] **Step 2: Run SettingsPanel tests and verify failure**

Run:

```bash
cd app && npx vitest run src/ui/SettingsPanel.test.tsx
```

Expected: FAIL because `Slider` does not handle pointer capture/move yet and `GlobalTab` still calls `setUiScale`.

- [ ] **Step 3: Change `GlobalTab` to call dangerous preview**

In `GlobalTab`, change:

```tsx
onChange={(v) => settings.setUiScale(v / 100)}
```

to:

```tsx
onChange={(v) => settings.previewDangerousUiScale(v / 100)}
```

- [ ] **Step 4: Replace `Slider` with pointer-capture behavior**

Replace the current `Slider` function in `app/src/ui/SettingsPanel.tsx` with:

```tsx
function Slider({ value, min, max, onChange }: SliderProps) {
    const [draggingPointerId, setDraggingPointerId] = useState<number | null>(null);
    const ratio = Math.max(0, Math.min(1, (value - min) / (max - min)));

    const valueFromClientX = (element: HTMLDivElement, clientX: number): number => {
        const rect = element.getBoundingClientRect();
        const r = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
        return Math.round(min + r * (max - min));
    };

    const updateFromPointer = (e: React.PointerEvent<HTMLDivElement>) => {
        onChange(valueFromClientX(e.currentTarget, e.clientX));
    };

    const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
        if (e.button !== 0) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        setDraggingPointerId(e.pointerId);
        updateFromPointer(e);
    };

    const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
        if (draggingPointerId !== e.pointerId) return;
        updateFromPointer(e);
    };

    const stopDragging = (e: React.PointerEvent<HTMLDivElement>) => {
        if (draggingPointerId !== e.pointerId) return;
        e.currentTarget.releasePointerCapture(e.pointerId);
        setDraggingPointerId(null);
    };

    return (
        <div
            className={`slider ${draggingPointerId !== null ? 'dragging' : ''}`}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={stopDragging}
            onPointerCancel={stopDragging}
            role="slider"
            aria-valuenow={value}
            aria-valuemin={min}
            aria-valuemax={max}
        >
            <div className="slider-fill" style={{ width: `calc((100% - 2px) * ${ratio})` }} />
            <div className="slider-thumb" style={{ left: `calc(${ratio * 100}%)` }} />
        </div>
    );
}
```

- [ ] **Step 5: Add slider drag CSS**

Add to the slider CSS block:

```css
.slider.dragging {
    cursor: grabbing;
}
```

- [ ] **Step 6: Run SettingsPanel tests**

Run:

```bash
cd app && npx vitest run src/ui/SettingsPanel.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit Task 5**

```bash
git add app/src/ui/SettingsPanel.tsx app/src/ui/SettingsPanel.css app/src/ui/SettingsPanel.test.tsx
git commit -m "feat: make scale slider preview while dragging"
```

---

### Task 6: Apply Effective UI Scale to Window Content

**Files:**
- Modify: `app/src/App.tsx`
- Modify: `app/src/SettingsApp.tsx`
- Modify: `app/src/styles/global.css`
- Modify: `app/src/ui/SettingsPanel.css`
- Modify: `app/src/ui/SettingsPanel.test.tsx`
- Modify: `app/src/ui/PomodoroPanel.test.tsx`

- [ ] **Step 1: Add CSS structure tests**

In `app/src/ui/SettingsPanel.test.tsx`, add this test under `SettingsPanel geometry`:

```ts
it('settings modal layer can cover the unscaled window while content scales', () => {
    const globalCss = readFileSync(path.join(here, '../styles/global.css'), 'utf8');
    const settingsCss = readFileSync(path.join(here, 'SettingsPanel.css'), 'utf8');

    expect(globalCss).toMatch(/\.settings-window-root\s*\{[^}]*--app-ui-scale:/);
    expect(globalCss).toMatch(/\.settings-scale-content\s*\{[^}]*zoom:\s*var\(--app-ui-scale\)/);
    expect(settingsCss).toMatch(/\.danger-modal-layer\s*\{[^}]*position:\s*absolute;[^}]*inset:\s*0;/);
});
```

In `app/src/ui/PomodoroPanel.test.tsx`, add these imports at the top:

```ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
```

Then add:

```ts
it('main app content root consumes the app UI scale CSS variable', () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const css = readFileSync(path.join(here, '../styles/global.css'), 'utf8');

    expect(css).toMatch(/\.app-scale-root\s*\{[^}]*--app-ui-scale:\s*1/);
    expect(css).toMatch(/\.app-root\s*\{[^}]*zoom:\s*var\(--app-ui-scale\)/);
});
```

- [ ] **Step 2: Run UI tests and verify failure**

Run:

```bash
cd app && npx vitest run src/ui/SettingsPanel.test.tsx src/ui/PomodoroPanel.test.tsx
```

Expected: FAIL because the scale root CSS/classes are not complete yet.

- [ ] **Step 3: Update `App.tsx` to use scale root**

Keep the hydration from Task 2 and ensure the returned JSX is:

```tsx
const uiScale = useSettingsStore((s) => s.uiScale);

return (
    <div className="app-scale-root" style={{ '--app-ui-scale': String(uiScale) } as CSSProperties}>
        <div className="app-root">
            <PomodoroPanel />
            <RemoteRoster />
        </div>
    </div>
);
```

- [ ] **Step 4: Update `SettingsApp.tsx` to keep dialog outside scaled content**

Replace `app/src/SettingsApp.tsx` with:

```tsx
import type { CSSProperties } from 'react';
import { SettingsPanel } from './ui/SettingsPanel';
import { DangerousChangeDialog } from './ui/DangerousChangeDialog';
import { useBridgeClient } from './domain/bridge/client';
import { useSettingsStore } from './domain/settings';
import './styles/global.css';

export default function SettingsApp() {
    useBridgeClient();
    const uiScale = useSettingsStore((s) => s.uiScale);

    return (
        <div className="settings-window-root" style={{ '--app-ui-scale': String(uiScale) } as CSSProperties}>
            <div className="settings-scale-content">
                <SettingsPanel />
            </div>
            <DangerousChangeDialog />
        </div>
    );
}
```

- [ ] **Step 5: Update global CSS**

Modify `app/src/styles/global.css`:

```css
.app-scale-root,
.settings-window-root {
    --app-ui-scale: 1;
    position: relative;
    width: 100vw;
    height: 100vh;
    overflow: auto;
    background: transparent;
}

.app-root {
    width: 100vw;
    height: 100vh;
    display: flex;
    align-items: flex-start;
    justify-content: flex-start;
    padding: 8px;
    zoom: var(--app-ui-scale);
}

.settings-scale-content {
    width: 100%;
    min-height: 100%;
    zoom: var(--app-ui-scale);
}
```

Remove the old standalone `.app-root` rule so there is only one `.app-root` definition.

- [ ] **Step 6: Ensure Settings panel still has a positioning context**

Confirm `app/src/ui/SettingsPanel.css` keeps:

```css
.settings-panel {
    position: relative;
    width: 100%;
    height: 100%;
}
```

- [ ] **Step 7: Run UI tests**

Run:

```bash
cd app && npx vitest run src/ui/SettingsPanel.test.tsx src/ui/PomodoroPanel.test.tsx
```

Expected: PASS.

- [ ] **Step 8: Commit Task 6**

```bash
git add app/src/App.tsx app/src/SettingsApp.tsx app/src/styles/global.css app/src/ui/SettingsPanel.css app/src/ui/SettingsPanel.test.tsx app/src/ui/PomodoroPanel.test.tsx
git commit -m "feat: apply global UI scale to window content"
```

---

### Task 7: Close-While-Pending Revert

**Files:**
- Modify: `app/src/ui/SettingsPanel.tsx`
- Modify: `app/src/ui/SettingsPanel.test.tsx`

- [ ] **Step 1: Add failing close revert test**

In `app/src/ui/SettingsPanel.test.tsx`, add under `SettingsPanel close button`:

```tsx
it('closing settings reverts a pending dangerous change before hiding the window', async () => {
    useSettingsStore.setState({
        activeTab: 'global',
        uiScale: 1.5,
        committedUiScale: 1.0,
        dangerousChange: {
            id: 'scale-preview',
            kind: 'uiScale',
            previousValue: 1.0,
            nextValue: 1.5,
            expiresAt: Date.now() + 5000,
        },
    });
    const revertSpy = vi.spyOn(useSettingsStore.getState(), 'revertDangerousChange');

    render(<SettingsPanel />);
    const closeBtn = screen.getByRole('button', { name: '关闭' });

    await act(async () => {
        fireEvent.click(closeBtn);
    });

    expect(revertSpy).toHaveBeenCalledWith('scale-preview');
    expect(invokeMock).toHaveBeenCalledWith('close_settings_window');
});
```

- [ ] **Step 2: Run SettingsPanel tests and verify failure**

Run:

```bash
cd app && npx vitest run src/ui/SettingsPanel.test.tsx
```

Expected: FAIL because `onClose` only invokes `close_settings_window`.

- [ ] **Step 3: Update `SettingsPanel` close handler**

In `SettingsPanel`, read pending change and revert action:

```tsx
const dangerousChange = useSettingsStore((s) => s.dangerousChange);
const revertDangerousChange = useSettingsStore((s) => s.revertDangerousChange);
```

Replace `onClose` with:

```tsx
const onClose = () => {
    if (dangerousChange) {
        revertDangerousChange(dangerousChange.id);
    }
    void invoke('close_settings_window');
};
```

- [ ] **Step 4: Run SettingsPanel tests**

Run:

```bash
cd app && npx vitest run src/ui/SettingsPanel.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit Task 7**

```bash
git add app/src/ui/SettingsPanel.tsx app/src/ui/SettingsPanel.test.tsx
git commit -m "fix: revert dangerous preview when settings closes"
```

---

### Task 8: Full Verification

**Files:**
- Verify only; no planned edits.

- [ ] **Step 1: Run all frontend tests**

Run:

```bash
cd app && npm test
```

Expected: PASS for all Vitest suites.

- [ ] **Step 2: Run TypeScript build**

Run:

```bash
cd app && npm run build
```

Expected: PASS with `tsc` and `vite build` completing successfully.

- [ ] **Step 3: Run Rust tests if frontend build passes**

Run:

```bash
cd app/src-tauri && cargo test
```

Expected: PASS for Rust unit/integration tests. If an existing Tauri integration test opens a hidden window, record that as expected behavior rather than a failure.

- [ ] **Step 4: Manual dev check**

Run:

```bash
cd app && npm run tauri dev
```

Manual checks:

1. Open Settings.
2. Go to 全局.
3. Drag 界面缩放 slider and confirm the thumb follows the pointer before release.
4. Confirm main window and settings content scale immediately.
5. Confirm a mask/dialog blocks Settings UI.
6. Click 取消 and confirm scale returns to the old value.
7. Drag again, click 应用, quit and relaunch, then confirm the applied scale persists.
8. Drag again and wait 5 seconds; confirm scale reverts automatically.

- [ ] **Step 5: Final commit if manual fixes were needed**

If Task 8 required code fixes, commit them:

```bash
git add app/src
git commit -m "fix: stabilize dangerous settings scale flow"
```

If no fixes were needed, do not create an empty commit.

---

## Self-Review

Spec coverage:

- Continuous slider drag is covered by Task 5.
- Immediate preview across windows is covered by Tasks 3 and 6.
- One blocking modal with a mask is covered by Task 4.
- 5 second revert and cancel revert are covered by Tasks 1 and 4.
- Apply-only persistence is covered by Tasks 1 and 2.
- Future dangerous-setting reuse is covered by the generic `DangerousChange` shape and dialog copy switch, without adding a premature registry.
- Settings-window bridge behavior is covered by Task 3.
- Close-while-pending revert is covered by Task 7.

Placeholder scan:

- No `TBD`, `TODO`, or undefined task references are intentionally left in this plan.

Type consistency:

- Domain actions are consistently named `previewDangerousUiScale`, `applyDangerousChange`, `revertDangerousChange`, and `hydrateSettings`.
- Snapshot fields are consistently named `uiScale`, `committedUiScale`, and `dangerousChange`.
- Dispatch action names match the domain method names.
