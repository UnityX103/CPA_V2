# Autostart Setting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an off-by-default `开机自启动` setting that updates Pencil first, then controls OS login startup through the official Tauri autostart plugin on macOS and Windows.

**Architecture:** `AUI/PUI.pen` remains the visual source of truth. The main window owns `settings.autostartEnabled`, persists the confirmed value, and applies the OS registration through a tiny frontend domain wrapper around the Tauri autostart plugin. Settings and other mirror windows receive the value through the existing bridge.

**Tech Stack:** Pencil MCP, React 19, TypeScript, Zustand, Vitest, Tauri 2, Rust, `@tauri-apps/plugin-autostart`, `tauri-plugin-autostart`.

---

## File Structure

- Modify `AUI/PUI.pen`: add `gspAutostart` in `Pdj9C` between `gspActiveFileTitle` and `gspAutoUpdate`.
- Create `app/src/domain/autostart.ts`: frontend wrapper for plugin `enable`, `disable`, and `isEnabled`.
- Create `app/src/domain/autostart.test.ts`: wrapper behavior in plugin success and failure cases.
- Modify `app/src/domain/settings.ts`: add state, action, defaults, hydration, dispatch, persistence.
- Modify `app/src/domain/settings.test.ts`: store defaults, hydration, setter, settings-window dispatch.
- Modify `app/src/domain/settingsPersistence.ts`: load/save the new field while preserving old `v: 1` files.
- Modify `app/src/domain/settingsPersistence.test.ts`: old and new persisted data.
- Modify `app/src/domain/bridge/protocol.ts`: snapshot field and dispatch action.
- Modify `app/src/domain/bridge/client.ts`: mirror `autostartEnabled`.
- Modify `app/src/domain/bridge/client.test.ts`: snapshot mirror assertion.
- Modify `app/src/domain/bridge/host.ts`: snapshot, dispatch route, signature.
- Modify `app/src/domain/bridge/host.test.ts`: snapshot, dispatch, signature tests.
- Modify `app/src/ui/SettingsPanel.tsx`: render the global setting card.
- Modify `app/src/ui/SettingsPanel.test.tsx`: render, order, toggle tests.
- Modify `app/src/App.tsx`: reconcile persisted value with real OS plugin state at startup.
- Modify `app/src-tauri/src/lib.rs`: initialize the autostart plugin.
- Modify `app/src-tauri/Cargo.toml` and `app/Cargo.lock`: add Rust plugin dependency.
- Modify `app/package.json` and `app/package-lock.json`: add JavaScript plugin dependency.
- Modify `app/src-tauri/capabilities/default.json`: allow autostart commands.

### Task 1: Update Pencil Source

**Files:**
- Modify: `AUI/PUI.pen`

- [ ] **Step 1: Read the current global settings panel**

Run through Pencil MCP:

```json
{
  "filePath": "/Users/xpy/Desktop/NanZhai/CPA_V2/AUI/PUI.pen",
  "nodeIds": ["Pdj9C", "NGo9f"],
  "readDepth": 3,
  "resolveVariables": true
}
```

Expected: `Pdj9C` children include `gspScale`, `gspActiveFileTitle`, `gspAutoUpdate`, and `gspBindingKey`.

- [ ] **Step 2: Insert `gspAutostart` after `gspActiveFileTitle`**

Run through Pencil MCP `batch_design`:

```javascript
U("Pdj9C",{["place"+"holder"]:true})
gspAutostart=I("Pdj9C",{type:"frame",name:"gspAutostart",layout:"horizontal",alignItems:"center",justifyContent:"space_between",cornerRadius:16,fill:"#F6F7F8",padding:16,width:"fill_container"})
I(gspAutostart,{type:"text",name:"gsp-autostart-label",content:"开机自启动",fill:"#9CA3AF",fontFamily:"MaokenAssortedSans",fontSize:12,fontWeight:"600"})
I(gspAutostart,{type:"ref",name:"gsp-autostart-toggle",ref:"NGo9f",fill:"#D1D5DB",justifyContent:"start"})
M(gspAutostart,"Pdj9C",2)
U("Pdj9C",{["place"+"holder"]:false})
```

Expected: the new card is visually off by default and sits between `显示打开的文件名` and `自动下载并安装更新`.

- [ ] **Step 3: Verify the design snapshot**

Run through Pencil MCP:

```json
{
  "filePath": "/Users/xpy/Desktop/NanZhai/CPA_V2/AUI/PUI.pen",
  "parentId": "Pdj9C",
  "patterns": [{ "name": "gspAutostart" }],
  "readDepth": 2
}
```

Expected: one `gspAutostart` node with label `开机自启动` and one `NGo9f` instance.

- [ ] **Step 4: Commit the Pencil change**

Run:

```bash
git status --short
git add AUI/PUI.pen
git commit -m "design: add autostart setting"
```

Expected: commit succeeds with only `AUI/PUI.pen` staged.

### Task 2: Add Plugin Dependency and Domain Wrapper

**Files:**
- Create: `app/src/domain/autostart.ts`
- Create: `app/src/domain/autostart.test.ts`
- Modify: `app/package.json`
- Modify: `app/package-lock.json`
- Modify: `app/src-tauri/Cargo.toml`
- Modify: `app/Cargo.lock`

- [ ] **Step 1: Install the official plugin packages**

Run:

```bash
cd app
npm install @tauri-apps/plugin-autostart
cd src-tauri
cargo add tauri-plugin-autostart
```

Expected: `package.json`, `package-lock.json`, `src-tauri/Cargo.toml`, and `Cargo.lock` include autostart plugin dependencies.

- [ ] **Step 2: Write the failing wrapper tests**

Create `app/src/domain/autostart.test.ts`:

```typescript
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyAutostartEnabled, readAutostartEnabled } from './autostart';

const plugin = vi.hoisted(() => ({
    enable: vi.fn(),
    disable: vi.fn(),
    isEnabled: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-autostart', () => plugin);

beforeEach(() => {
    plugin.enable.mockReset();
    plugin.disable.mockReset();
    plugin.isEnabled.mockReset();
});

describe('autostart domain helper', () => {
    it('reads the current plugin state', async () => {
        plugin.isEnabled.mockResolvedValue(true);

        await expect(readAutostartEnabled(false)).resolves.toBe(true);

        expect(plugin.isEnabled).toHaveBeenCalledTimes(1);
    });

    it('returns the fallback when reading fails', async () => {
        plugin.isEnabled.mockRejectedValue(new Error('plugin unavailable'));

        await expect(readAutostartEnabled(false)).resolves.toBe(false);
    });

    it('enables autostart and returns confirmed state', async () => {
        plugin.enable.mockResolvedValue(undefined);
        plugin.isEnabled.mockResolvedValue(true);

        await expect(applyAutostartEnabled(true, false)).resolves.toBe(true);

        expect(plugin.enable).toHaveBeenCalledTimes(1);
        expect(plugin.disable).not.toHaveBeenCalled();
    });

    it('disables autostart and returns confirmed state', async () => {
        plugin.disable.mockResolvedValue(undefined);
        plugin.isEnabled.mockResolvedValue(false);

        await expect(applyAutostartEnabled(false, true)).resolves.toBe(false);

        expect(plugin.disable).toHaveBeenCalledTimes(1);
        expect(plugin.enable).not.toHaveBeenCalled();
    });

    it('falls back to the previous confirmed state when applying fails and re-query fails', async () => {
        plugin.enable.mockRejectedValue(new Error('registration failed'));
        plugin.isEnabled.mockRejectedValue(new Error('query failed'));

        await expect(applyAutostartEnabled(true, false)).resolves.toBe(false);
    });
});
```

- [ ] **Step 3: Run the new test and verify it fails**

Run:

```bash
cd app
npx vitest run src/domain/autostart.test.ts
```

Expected: FAIL because `app/src/domain/autostart.ts` does not exist.

- [ ] **Step 4: Create the autostart wrapper**

Create `app/src/domain/autostart.ts`:

```typescript
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
```

- [ ] **Step 5: Run wrapper tests**

Run:

```bash
cd app
npx vitest run src/domain/autostart.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit the wrapper and dependencies**

Run:

```bash
git add app/package.json app/package-lock.json app/src-tauri/Cargo.toml app/Cargo.lock app/src/domain/autostart.ts app/src/domain/autostart.test.ts
git commit -m "feat: add autostart domain wrapper"
```

Expected: commit succeeds.

### Task 3: Extend Settings State and Persistence

**Files:**
- Modify: `app/src/domain/settings.ts`
- Modify: `app/src/domain/settings.test.ts`
- Modify: `app/src/domain/settingsPersistence.ts`
- Modify: `app/src/domain/settingsPersistence.test.ts`

- [ ] **Step 1: Update persistence tests first**

Modify `app/src/domain/settingsPersistence.test.ts` so the first two tests expect `autostartEnabled`, and add one save assertion:

```typescript
it('loads persisted v1 settings', async () => {
    store.get.mockResolvedValue({
        v: 1,
        uiScale: 1.75,
        showActiveAppWindowTitle: false,
        autostartEnabled: true,
    });
    const { loadPersistedSettings } = await import('./settingsPersistence');

    await expect(loadPersistedSettings()).resolves.toEqual({
        uiScale: 1.75,
        showActiveAppWindowTitle: false,
        autostartEnabled: true,
    });
});

it('defaults optional fields for older v1 settings', async () => {
    store.get.mockResolvedValue({ v: 1, uiScale: 1.75 });
    const { loadPersistedSettings } = await import('./settingsPersistence');

    await expect(loadPersistedSettings()).resolves.toEqual({
        uiScale: 1.75,
        showActiveAppWindowTitle: true,
        autostartEnabled: false,
    });
});

it('saves persisted v1 settings', async () => {
    const { savePersistedSettings } = await import('./settingsPersistence');

    await savePersistedSettings({
        uiScale: 2,
        showActiveAppWindowTitle: false,
        autostartEnabled: true,
    });

    expect(store.set).toHaveBeenCalledWith('settings', {
        v: 1,
        uiScale: 2,
        showActiveAppWindowTitle: false,
        autostartEnabled: true,
    });
    expect(store.save).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Run persistence tests and verify failure**

Run:

```bash
cd app
npx vitest run src/domain/settingsPersistence.test.ts
```

Expected: FAIL because persistence does not include `autostartEnabled`.

- [ ] **Step 3: Extend persistence implementation**

Modify `app/src/domain/settingsPersistence.ts`:

```typescript
export interface PersistedSettings {
    uiScale: number;
    showActiveAppWindowTitle: boolean;
    autostartEnabled: boolean;
}

interface PersistedSettingsV1 {
    v: 1;
    uiScale: number;
    showActiveAppWindowTitle?: boolean;
    autostartEnabled?: boolean;
}

function isPersistedSettingsV1(value: unknown): value is PersistedSettingsV1 {
    if (!value || typeof value !== 'object') return false;
    const candidate = value as Partial<PersistedSettingsV1>;
    return candidate.v === 1
        && typeof candidate.uiScale === 'number'
        && Number.isFinite(candidate.uiScale)
        && (
            candidate.showActiveAppWindowTitle === undefined
            || typeof candidate.showActiveAppWindowTitle === 'boolean'
        )
        && (
            candidate.autostartEnabled === undefined
            || typeof candidate.autostartEnabled === 'boolean'
        );
}
```

Update `loadPersistedSettings` return:

```typescript
return {
    uiScale: value.uiScale,
    showActiveAppWindowTitle: value.showActiveAppWindowTitle ?? true,
    autostartEnabled: value.autostartEnabled ?? false,
};
```

Update `savePersistedSettings` payload:

```typescript
await store.set(STORE_KEY, {
    v: 1,
    uiScale: settings.uiScale,
    showActiveAppWindowTitle: settings.showActiveAppWindowTitle,
    autostartEnabled: settings.autostartEnabled,
} satisfies PersistedSettingsV1);
```

- [ ] **Step 4: Update settings store tests**

Add mocks near the top of `app/src/domain/settings.test.ts`:

```typescript
const savePersistedSettingsMock = vi.hoisted(() => vi.fn());
const applyAutostartEnabledMock = vi.hoisted(() => vi.fn());

vi.mock('./settingsPersistence', () => ({
    savePersistedSettings: savePersistedSettingsMock,
}));

vi.mock('./autostart', () => ({
    applyAutostartEnabled: applyAutostartEnabledMock,
}));
```

Update `beforeEach`:

```typescript
savePersistedSettingsMock.mockReset();
savePersistedSettingsMock.mockResolvedValue(undefined);
applyAutostartEnabledMock.mockReset();
applyAutostartEnabledMock.mockImplementation(async (enabled: boolean) => enabled);
useSettingsStore.setState({
    activeTab: 'pomodoro',
    uiScale: 1.0,
    committedUiScale: 1.0,
    showActiveAppWindowTitle: true,
    autostartEnabled: false,
    dangerousChange: null,
});
```

Add main-store tests:

```typescript
it('defaults autostartEnabled to false', () => {
    expect(createSettingsStore({ isSettingsWindow: false }).getState().autostartEnabled).toBe(false);
});

it('hydrates autostartEnabled from persisted settings', () => {
    useSettingsStore.getState().hydrateSettings({
        uiScale: 1.25,
        showActiveAppWindowTitle: false,
        autostartEnabled: true,
    });

    expect(useSettingsStore.getState().autostartEnabled).toBe(true);
});

it('defaults missing autostartEnabled to false during hydration', () => {
    useSettingsStore.getState().hydrateSettings({ uiScale: 1.25 });

    expect(useSettingsStore.getState().autostartEnabled).toBe(false);
});

it('applies autostart through the plugin helper and persists confirmed state', async () => {
    applyAutostartEnabledMock.mockResolvedValue(true);

    await useSettingsStore.getState().setAutostartEnabled(true);

    expect(applyAutostartEnabledMock).toHaveBeenCalledWith(true, false);
    expect(useSettingsStore.getState().autostartEnabled).toBe(true);
    expect(savePersistedSettingsMock).toHaveBeenCalledWith({
        uiScale: 1.0,
        showActiveAppWindowTitle: true,
        autostartEnabled: true,
    });
});
```

Add settings-window test:

```typescript
it('setAutostartEnabled dispatches instead of mutating local state', () => {
    const spy = vi.spyOn(dispatchMod, 'dispatch').mockResolvedValue();
    const store = createSettingsStore({ isSettingsWindow: true });

    void store.getState().setAutostartEnabled(true);

    expect(store.getState().autostartEnabled).toBe(false);
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({
        v: BRIDGE_VERSION,
        store: 'settings',
        action: 'setAutostartEnabled',
        args: [true],
    }));
    spy.mockRestore();
});
```

- [ ] **Step 5: Run settings tests and verify failure**

Run:

```bash
cd app
npx vitest run src/domain/settings.test.ts src/domain/settingsPersistence.test.ts
```

Expected: FAIL because the store does not expose `autostartEnabled`.

- [ ] **Step 6: Extend settings store implementation**

Modify `app/src/domain/settings.ts` imports:

```typescript
import { applyAutostartEnabled } from './autostart';
```

Update types:

```typescript
export interface SettingsState {
    activeTab: SettingsTab;
    uiScale: number;
    committedUiScale: number;
    showActiveAppWindowTitle: boolean;
    autostartEnabled: boolean;
    dangerousChange: DangerousChange | null;
}

export interface PersistedSettingsSnapshot {
    uiScale: number;
    showActiveAppWindowTitle?: boolean;
    autostartEnabled?: boolean;
}

interface SettingsActions {
    setActiveTab: (tab: SettingsTab) => void;
    setUiScale: (scale: number) => void;
    setShowActiveAppWindowTitle: (enabled: boolean) => void;
    setAutostartEnabled: (enabled: boolean) => Promise<void> | void;
    previewDangerousUiScale: (scale: number) => void;
    applyDangerousChange: (id: string) => void;
    revertDangerousChange: (id: string) => void;
    hydrateSettings: (snapshot: PersistedSettingsSnapshot) => void;
}
```

Add `autostartEnabled: false` to both store initial states.

In settings-window mode:

```typescript
setAutostartEnabled: (enabled) => {
    void dispatch({
        v: BRIDGE_VERSION,
        store: 'settings',
        action: 'setAutostartEnabled',
        args: [enabled],
    });
},
```

In main-window mode:

```typescript
setAutostartEnabled: async (enabled) => {
    const fallback = get().autostartEnabled;
    const autostartEnabled = await applyAutostartEnabled(enabled, fallback);
    set({ autostartEnabled });
    const state = get();
    void savePersistedSettings({
        uiScale: state.committedUiScale,
        showActiveAppWindowTitle: state.showActiveAppWindowTitle,
        autostartEnabled,
    });
},
```

Update every `savePersistedSettings` call to include `autostartEnabled: get().autostartEnabled`.

Update both `hydrateSettings` implementations:

```typescript
autostartEnabled: snapshot.autostartEnabled ?? false,
```

- [ ] **Step 7: Run settings tests**

Run:

```bash
cd app
npx vitest run src/domain/settings.test.ts src/domain/settingsPersistence.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit settings state and persistence**

Run:

```bash
git add app/src/domain/settings.ts app/src/domain/settings.test.ts app/src/domain/settingsPersistence.ts app/src/domain/settingsPersistence.test.ts
git commit -m "feat: persist autostart setting"
```

Expected: commit succeeds.

### Task 4: Wire Bridge and Settings UI

**Files:**
- Modify: `app/src/domain/bridge/protocol.ts`
- Modify: `app/src/domain/bridge/protocol.test.ts`
- Modify: `app/src/domain/bridge/client.ts`
- Modify: `app/src/domain/bridge/client.test.ts`
- Modify: `app/src/domain/bridge/host.ts`
- Modify: `app/src/domain/bridge/host.test.ts`
- Modify: `app/src/ui/SettingsPanel.tsx`
- Modify: `app/src/ui/SettingsPanel.test.tsx`

- [ ] **Step 1: Write bridge and UI test updates**

In `app/src/domain/bridge/protocol.test.ts`, add `autostartEnabled: true` to sample snapshots and add this dispatch payload to the valid payload list:

```typescript
{ v: 1, store: 'settings', action: 'setAutostartEnabled', args: [true] },
```

In `app/src/domain/bridge/client.test.ts`, add `autostartEnabled: true` in `makeSample().settings` and assert:

```typescript
expect(useSettingsStore.getState().autostartEnabled).toBe(true);
```

In `app/src/domain/bridge/host.test.ts`, add `autostartEnabled` to settings setup objects and add:

```typescript
it('routes autostart setting to the authoritative settings store', async () => {
    const setAutostartEnabled = vi.fn(async () => {});
    useSettingsStore.setState({ setAutostartEnabled });

    applyDispatch({
        v: BRIDGE_VERSION,
        store: 'settings',
        action: 'setAutostartEnabled',
        args: [true],
    });

    expect(setAutostartEnabled).toHaveBeenCalledWith(true);
});
```

In the `settingsSig` test, add:

```typescript
const enabledAutostartSettings: SettingsState = {
    ...pomodoroTabSettings,
    autostartEnabled: true,
};

expect(settingsSig(pomodoroTabSettings)).not.toBe(settingsSig(enabledAutostartSettings));
```

In `app/src/ui/SettingsPanel.test.tsx`, update global tab tests:

```typescript
expect(screen.getByText('开机自启动')).toBeTruthy();
```

Update the order test:

```typescript
const activeTitle = screen.getByText('显示打开的文件名');
const autostart = screen.getByText('开机自启动');
const autoUpdate = screen.getByText('自动下载并安装更新');
const bindingKey = screen.getByText('按键计数');

expect(activeTitle.compareDocumentPosition(autostart) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
expect(autostart.compareDocumentPosition(autoUpdate) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
expect(autoUpdate.compareDocumentPosition(bindingKey) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
```

Add:

```typescript
it('toggles autostart from the global tab', async () => {
    const setAutostartEnabled = vi.fn(async (enabled: boolean) => {
        useSettingsStore.setState({ autostartEnabled: enabled });
    });
    useSettingsStore.setState({ setAutostartEnabled });

    render(<SettingsPanel />);
    const toggle = screen.getByRole('button', { name: '开机自启动' });

    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    await act(async () => {
        fireEvent.click(toggle);
    });

    expect(setAutostartEnabled).toHaveBeenCalledWith(true);
});
```

- [ ] **Step 2: Run focused tests and verify failure**

Run:

```bash
cd app
npx vitest run src/domain/bridge/protocol.test.ts src/domain/bridge/client.test.ts src/domain/bridge/host.test.ts src/ui/SettingsPanel.test.tsx
```

Expected: FAIL because bridge types and UI do not include `autostartEnabled`.

- [ ] **Step 3: Extend bridge protocol**

Modify `app/src/domain/bridge/protocol.ts` settings snapshot:

```typescript
settings: {
    uiScale: number;
    committedUiScale: number;
    showActiveAppWindowTitle: boolean;
    autostartEnabled: boolean;
    dangerousChange: DangerousChange | null;
};
```

Add dispatch action:

```typescript
| { v: typeof BRIDGE_VERSION; store: 'settings';   action: 'setAutostartEnabled'; args: [boolean] }
```

- [ ] **Step 4: Extend bridge host and client**

Modify `app/src/domain/bridge/client.ts`:

```typescript
useSettingsStore.setState({
    uiScale: snap.settings.uiScale,
    committedUiScale: snap.settings.committedUiScale,
    showActiveAppWindowTitle: snap.settings.showActiveAppWindowTitle,
    autostartEnabled: snap.settings.autostartEnabled,
    dangerousChange: snap.settings.dangerousChange,
});
```

Modify `app/src/domain/bridge/host.ts` snapshot:

```typescript
settings: {
    uiScale: s.uiScale,
    committedUiScale: s.committedUiScale,
    showActiveAppWindowTitle: s.showActiveAppWindowTitle,
    autostartEnabled: s.autostartEnabled,
    dangerousChange: s.dangerousChange,
},
```

Modify settings dispatch routing:

```typescript
case 'setAutostartEnabled': void s.setAutostartEnabled(...payload.args); return;
```

Modify `settingsSig` parameter and returned array:

```typescript
export function settingsSig(s: {
    uiScale: number;
    committedUiScale: number;
    showActiveAppWindowTitle: boolean;
    autostartEnabled: boolean;
    dangerousChange: unknown;
}): string {
    return JSON.stringify([
        s.uiScale,
        s.committedUiScale,
        s.showActiveAppWindowTitle,
        s.autostartEnabled,
        s.dangerousChange,
    ]);
}
```

- [ ] **Step 5: Render the UI card**

Modify `app/src/ui/SettingsPanel.tsx` inside `GlobalTab`, after the `显示打开的文件名` card and before `<AppUpdateSettingsRow />`:

```tsx
<div className="card">
    <div className="card-row">
        <span className="card-label">开机自启动</span>
        <Toggle
            checked={settings.autostartEnabled}
            onChange={(enabled) => { void settings.setAutostartEnabled(enabled); }}
            ariaLabel="开机自启动"
        />
    </div>
</div>
```

- [ ] **Step 6: Run focused bridge and UI tests**

Run:

```bash
cd app
npx vitest run src/domain/bridge/protocol.test.ts src/domain/bridge/client.test.ts src/domain/bridge/host.test.ts src/ui/SettingsPanel.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit bridge and UI**

Run:

```bash
git add app/src/domain/bridge/protocol.ts app/src/domain/bridge/protocol.test.ts app/src/domain/bridge/client.ts app/src/domain/bridge/client.test.ts app/src/domain/bridge/host.ts app/src/domain/bridge/host.test.ts app/src/ui/SettingsPanel.tsx app/src/ui/SettingsPanel.test.tsx
git commit -m "feat: expose autostart in settings UI"
```

Expected: commit succeeds.

### Task 5: Reconcile Startup State and Enable Native Plugin

**Files:**
- Modify: `app/src/App.tsx`
- Modify: `app/src/App.test.tsx`
- Modify: `app/src-tauri/src/lib.rs`
- Modify: `app/src-tauri/capabilities/default.json`

- [ ] **Step 1: Add startup hydration tests**

In `app/src/App.test.tsx`, mock `readAutostartEnabled`:

```typescript
const readAutostartEnabledMock = vi.hoisted(() => vi.fn());

vi.mock('./domain/autostart', () => ({
    readAutostartEnabled: readAutostartEnabledMock,
}));
```

Add to `beforeEach`:

```typescript
readAutostartEnabledMock.mockReset();
readAutostartEnabledMock.mockImplementation(async (fallback: boolean) => fallback);
```

Add tests:

```typescript
it('hydrates autostart from the confirmed plugin state', async () => {
    loadPersistedSettingsMock.mockResolvedValue({
        uiScale: 1,
        showActiveAppWindowTitle: true,
        autostartEnabled: false,
    });
    readAutostartEnabledMock.mockResolvedValue(true);

    render(<App />);

    await waitFor(() => {
        expect(useSettingsStore.getState().autostartEnabled).toBe(true);
    });
});

it('keeps autostart off by default when no persisted settings exist', async () => {
    loadPersistedSettingsMock.mockResolvedValue(null);
    readAutostartEnabledMock.mockResolvedValue(false);

    render(<App />);

    await waitFor(() => {
        expect(useSettingsStore.getState().autostartEnabled).toBe(false);
    });
});
```

- [ ] **Step 2: Run App tests and verify failure**

Run:

```bash
cd app
npx vitest run src/App.test.tsx
```

Expected: FAIL because `App.tsx` has not queried the autostart plugin state.

- [ ] **Step 3: Update app startup hydration**

Modify imports in `app/src/App.tsx`:

```typescript
import { readAutostartEnabled } from './domain/autostart';
import { loadPersistedSettings, savePersistedSettings } from './domain/settingsPersistence';
```

Replace the settings load body with:

```typescript
loadPersistedSettings()
    .then(async (settings) => {
        if (cancelled) return;
        const persisted = settings ?? {
            uiScale: 1.0,
            showActiveAppWindowTitle: true,
            autostartEnabled: false,
        };
        const confirmedAutostartEnabled = await readAutostartEnabled(persisted.autostartEnabled);
        if (cancelled) return;
        const snapshot = {
            ...persisted,
            autostartEnabled: confirmedAutostartEnabled,
        };
        useSettingsStore.getState().hydrateSettings(snapshot);
        if (confirmedAutostartEnabled !== persisted.autostartEnabled) {
            void savePersistedSettings(snapshot);
        }
        setSettingsHydrated(true);
    })
```

Keep the existing `.catch` branch that logs and sets `settingsHydrated`.

- [ ] **Step 4: Initialize the Rust plugin**

Modify `app/src-tauri/src/lib.rs` builder setup. Add the plugin before `.manage(...)`:

```rust
.plugin(tauri_plugin_autostart::init(
    tauri_plugin_autostart::MacosLauncher::LaunchAgent,
    None,
))
```

The block should sit with the other plugins:

```rust
.plugin(tauri_plugin_process::init())
.plugin(tauri_plugin_store::Builder::new().build())
.plugin(tauri_plugin_updater::Builder::new().build())
.plugin(tauri_plugin_autostart::init(
    tauri_plugin_autostart::MacosLauncher::LaunchAgent,
    None,
))
```

- [ ] **Step 5: Add minimal capability permissions**

Modify `app/src-tauri/capabilities/default.json` permissions:

```json
"autostart:allow-enable",
"autostart:allow-disable",
"autostart:allow-is-enabled"
```

Keep the existing CSP and existing window permissions unchanged.

- [ ] **Step 6: Run startup and Rust checks**

Run:

```bash
cd app
npx vitest run src/App.test.tsx
npm run build
cd src-tauri
cargo check
```

Expected: all pass on macOS. `cargo check` verifies the plugin initialization compiles for the current target.

- [ ] **Step 7: Commit startup integration**

Run:

```bash
git add app/src/App.tsx app/src/App.test.tsx app/src-tauri/src/lib.rs app/src-tauri/capabilities/default.json
git commit -m "feat: wire autostart plugin"
```

Expected: commit succeeds.

### Task 6: Full Verification

**Files:**
- Read: working tree

- [ ] **Step 1: Run focused test set**

Run:

```bash
cd app
npx vitest run src/domain/autostart.test.ts src/domain/settings.test.ts src/domain/settingsPersistence.test.ts src/domain/bridge/protocol.test.ts src/domain/bridge/host.test.ts src/domain/bridge/client.test.ts src/ui/SettingsPanel.test.tsx src/App.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run full frontend tests**

Run:

```bash
cd app
npm test
```

Expected: PASS.

- [ ] **Step 3: Run frontend build**

Run:

```bash
cd app
npm run build
```

Expected: PASS.

- [ ] **Step 4: Run Rust check**

Run:

```bash
cd app/src-tauri
cargo check
```

Expected: PASS.

- [ ] **Step 5: Inspect final diff**

Run:

```bash
git status --short
git diff --check
git log --oneline -6
```

Expected: clean working tree, no whitespace errors, recent commits include design, Pencil, wrapper, settings, UI, and plugin integration.

- [ ] **Step 6: Manual smoke test**

Run:

```bash
./start.sh
```

Expected:

- The app starts.
- Settings opens from the main panel gear.
- The `全局` tab shows `开机自启动` between `显示打开的文件名` and `自动下载并安装更新`.
- The switch is off by default.
- Toggling on persists after closing and reopening Settings.
- Toggling off persists after closing and reopening Settings.

- [ ] **Step 7: Final implementation commit if needed**

If verification edits were required, run:

```bash
git add AUI/PUI.pen app
git commit -m "fix: stabilize autostart setting"
```

Expected: no commit is created when Step 5 already showed a clean tree.

## Self-Review

- Spec coverage: Pencil, default off, settings state, persistence, bridge, UI, macOS plugin initialization, Windows plugin support, tests, and manual verification are covered.
- Scope: one local desktop setting; no server or remote sync changes.
- Type consistency: field name is `autostartEnabled` everywhere; action name is `setAutostartEnabled`; helper names are `readAutostartEnabled` and `applyAutostartEnabled`.
