# Temporary Focus Windows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove obsolete global title/auto-pin settings, stop default pinning for check-in windows, and use short-lived focus actions for Pomodoro and check-in editor reminders.

**Architecture:** Manual pin remains owned by existing pin buttons and native always-on-top commands. New temporary focus behavior is implemented through a narrow allowlisted Tauri command plus small frontend helpers; Pomodoro end handling calls focus helpers without mutating `isPinned`. Settings cleanup removes obsolete fields from state, persistence, bridge snapshots, UI, and Pencil.

**Tech Stack:** React, TypeScript, Zustand, Vitest, Testing Library, Tauri 2, Rust, Pencil MCP.

---

## File Structure

- Modify `AUI/PUI.pen`: remove `gspAutoPinOnFocusEnd` from `Global Settings Panel`; verify no `显示打开的文件名` row exists.
- Modify `app/src/domain/settingsPersistence.ts`: remove `showActiveAppWindowTitle` and `autoPinOnFocusEnd` from persisted settings output while accepting old files.
- Modify `app/src/domain/settings.ts`: remove obsolete state fields and setters from main and settings-window stores.
- Modify `app/src/domain/bridge/protocol.ts`: remove obsolete settings fields and dispatch actions from snapshots.
- Modify `app/src/domain/bridge/host.ts`: stop cloning obsolete settings fields and dispatch actions.
- Modify `app/src/domain/bridge/client.ts`: stop applying obsolete settings fields to mirror stores.
- Modify `app/src/ui/SettingsPanel.tsx`: delete the two global settings cards.
- Modify `app/src/ui/InputCounterPanel.tsx`: always display active app name instead of active window title.
- Create `app/src/domain/focusWindow.ts`: frontend helper for temporary focus commands.
- Modify `app/src/ui/PomodoroEndActionLayer.tsx`: focus `main` for top-window fallback paths.
- Modify `app/src/App.tsx`: open/focus check-in editor on natural focus end and remove auto-pin mutation.
- Modify `app/src-tauri/src/lib.rs`: add allowlisted temporary focus command; change check-in window builders/openers to avoid always-on-top.
- Modify tests alongside source: `settingsPersistence.test.ts`, `settings.test.ts`, `bridge/{protocol,host,client}.test.ts`, `SettingsPanel.test.tsx`, `InputCounterPanel.test.tsx`, `PomodoroEndActionLayer.test.tsx`, `App.test.tsx`, `checkinPomodoroIntegration.test.tsx`, `checkinWindowConfig.test.ts`, and a new focused test for `focusWindow.ts`.

---

### Task 1: Pencil Cleanup

**Files:**
- Modify: `AUI/PUI.pen`

- [ ] **Step 1: Verify current Pencil nodes**

Use Pencil MCP `batch_get`:

```json
{
  "filePath": "/Users/xpy/Desktop/NanZhai/CPA_V2/AUI/PUI.pen",
  "nodeIds": ["Pdj9C"],
  "readDepth": 2,
  "resolveVariables": true
}
```

Expected: `Pdj9C` contains `gspAutoPinOnFocusEnd` with node id `yYYts`, and no child text content `显示打开的文件名`.

- [ ] **Step 2: Remove the auto-pin design row**

Run Pencil MCP `batch_design`:

```javascript
U("Pdj9C",{placeholder:true})
D("yYYts")
U("Pdj9C",{placeholder:false})
```

- [ ] **Step 3: Verify design cleanup**

Run Pencil MCP `batch_get` again for `Pdj9C` with `readDepth: 2`.

Expected: no child named `gspAutoPinOnFocusEnd`, no text `专注结束后自动置顶`, no text `显示打开的文件名`; remaining global rows still include `界面缩放`, `开机自启动`, `每日计划`, `自动下载并安装更新`, and `按键计数`.

- [ ] **Step 4: Commit**

```bash
git add AUI/PUI.pen
git commit -m "design: remove obsolete global settings"
```

Expected: commit succeeds with only `AUI/PUI.pen` staged.

---

### Task 2: Settings Persistence And Store Cleanup

**Files:**
- Modify: `app/src/domain/settingsPersistence.test.ts`
- Modify: `app/src/domain/settingsPersistence.ts`
- Modify: `app/src/domain/settings.test.ts`
- Modify: `app/src/domain/settings.ts`

- [ ] **Step 1: Update failing persistence tests**

In `app/src/domain/settingsPersistence.test.ts`, replace the old title/auto-pin tests with these cases:

```ts
it('loads persisted v1 settings and ignores obsolete fields', async () => {
    store.get.mockResolvedValue({
        v: 1,
        uiScale: 1.75,
        showActiveAppWindowTitle: false,
        autostartEnabled: true,
        autoPinOnFocusEnd: false,
    });
    const { loadPersistedSettings } = await import('./settingsPersistence');

    await expect(loadPersistedSettings()).resolves.toEqual({
        uiScale: 1.75,
        autostartEnabled: true,
    });
});

it('defaults missing autostartEnabled to false for older v1 settings', async () => {
    store.get.mockResolvedValue({ v: 1, uiScale: 1.75 });
    const { loadPersistedSettings } = await import('./settingsPersistence');

    await expect(loadPersistedSettings()).resolves.toEqual({
        uiScale: 1.75,
        autostartEnabled: false,
    });
});

it('saves persisted v1 settings without obsolete fields', async () => {
    const { savePersistedSettings } = await import('./settingsPersistence');

    await savePersistedSettings({
        uiScale: 2,
        autostartEnabled: true,
    });

    expect(store.set).toHaveBeenCalledWith('settings', {
        v: 1,
        uiScale: 2,
        autostartEnabled: true,
    });
    expect(store.save).toHaveBeenCalledTimes(1);
});
```

Remove tests named:

```ts
loads persisted autoPinOnFocusEnd settings
defaults showActiveAppWindowTitle to true for older v1 settings
defaults autoPinOnFocusEnd to true for older v1 settings
ignores malformed autoPinOnFocusEnd settings
```

- [ ] **Step 2: Run persistence tests and verify failure**

Run:

```bash
cd app && npx vitest run src/domain/settingsPersistence.test.ts
```

Expected: FAIL because `loadPersistedSettings()` and `savePersistedSettings()` still include obsolete fields.

- [ ] **Step 3: Implement persistence cleanup**

Change `app/src/domain/settingsPersistence.ts` to this shape:

```ts
import { load } from '@tauri-apps/plugin-store';

const STORE_PATH = 'settings.json';
const STORE_KEY = 'settings';

export interface PersistedSettings {
    uiScale: number;
    autostartEnabled: boolean;
}

interface PersistedSettingsV1 {
    v: 1;
    uiScale: number;
    showActiveAppWindowTitle?: boolean;
    autostartEnabled?: boolean;
    autoPinOnFocusEnd?: boolean;
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
        )
        && (
            candidate.autoPinOnFocusEnd === undefined
            || typeof candidate.autoPinOnFocusEnd === 'boolean'
        );
}

async function openStore() {
    return load(STORE_PATH, { defaults: {}, autoSave: false });
}

export async function loadPersistedSettings(): Promise<PersistedSettings | null> {
    try {
        const store = await openStore();
        const value = await store.get<unknown>(STORE_KEY);
        if (!isPersistedSettingsV1(value)) return null;
        return {
            uiScale: value.uiScale,
            autostartEnabled: value.autostartEnabled ?? false,
        };
    } catch (err) {
        console.warn('[settingsPersistence] load failed', err);
        return null;
    }
}

export async function savePersistedSettings(settings: PersistedSettings): Promise<void> {
    try {
        const store = await openStore();
        await store.set(STORE_KEY, {
            v: 1,
            uiScale: settings.uiScale,
            autostartEnabled: settings.autostartEnabled,
        } satisfies PersistedSettingsV1);
        await store.save();
    } catch (err) {
        console.warn('[settingsPersistence] save failed', err);
    }
}
```

- [ ] **Step 4: Update failing settings store tests**

In `app/src/domain/settings.test.ts`:

Remove all reset state properties and assertions for:

```ts
showActiveAppWindowTitle
autoPinOnFocusEnd
setShowActiveAppWindowTitle
setAutoPinOnFocusEnd
```

Add this test:

```ts
it('does not expose obsolete active-title or auto-pin settings', () => {
    const state = useSettingsStore.getState();

    expect('showActiveAppWindowTitle' in state).toBe(false);
    expect('setShowActiveAppWindowTitle' in state).toBe(false);
    expect('autoPinOnFocusEnd' in state).toBe(false);
    expect('setAutoPinOnFocusEnd' in state).toBe(false);
});
```

Update `setAutostartEnabled applies native setting and persists confirmed value` so the setup and assertion are:

```ts
useSettingsStore.setState({
    committedUiScale: 1.5,
    autostartEnabled: false,
});

await useSettingsStore.getState().setAutostartEnabled(true);

expect(settingsMocks.applyAutostartEnabled).toHaveBeenCalledWith(true, false);
expect(useSettingsStore.getState().autostartEnabled).toBe(true);
expect(settingsMocks.savePersistedSettings).toHaveBeenCalledWith({
    uiScale: 1.5,
    autostartEnabled: true,
});
```

- [ ] **Step 5: Run settings tests and verify failure**

Run:

```bash
cd app && npx vitest run src/domain/settings.test.ts
```

Expected: FAIL because the store still exposes obsolete fields and setters.

- [ ] **Step 6: Implement settings store cleanup**

In `app/src/domain/settings.ts`:

Remove these interface members:

```ts
showActiveAppWindowTitle: boolean;
autoPinOnFocusEnd: boolean;
setShowActiveAppWindowTitle: (enabled: boolean) => void;
setAutoPinOnFocusEnd: (enabled: boolean) => void;
showActiveAppWindowTitle?: boolean;
autoPinOnFocusEnd?: boolean;
```

Change `persistedSnapshot` to:

```ts
function persistedSnapshot(state: SettingsState): PersistedSettings {
    return {
        uiScale: state.committedUiScale,
        autostartEnabled: state.autostartEnabled,
    };
}
```

Remove obsolete defaults from both store creation branches:

```ts
showActiveAppWindowTitle: true,
autoPinOnFocusEnd: true,
```

Remove obsolete settings-window dispatch setters:

```ts
setShowActiveAppWindowTitle: ...
setAutoPinOnFocusEnd: ...
```

Remove obsolete main-window setters:

```ts
setShowActiveAppWindowTitle: ...
setAutoPinOnFocusEnd: ...
```

Change both `hydrateSettings` implementations to set only:

```ts
const uiScale = clampScale(snapshot.uiScale);
set({
    uiScale,
    committedUiScale: uiScale,
    autostartEnabled: snapshot.autostartEnabled ?? false,
    dangerousChange: null,
});
```

- [ ] **Step 7: Run task tests**

Run:

```bash
cd app && npx vitest run src/domain/settingsPersistence.test.ts src/domain/settings.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add app/src/domain/settingsPersistence.test.ts app/src/domain/settingsPersistence.ts app/src/domain/settings.test.ts app/src/domain/settings.ts
git commit -m "refactor: remove obsolete global settings state"
```

Expected: commit succeeds with only these four files staged.

---

### Task 3: Bridge And Startup Snapshot Cleanup

**Files:**
- Modify: `app/src/domain/bridge/protocol.test.ts`
- Modify: `app/src/domain/bridge/protocol.ts`
- Modify: `app/src/domain/bridge/host.test.ts`
- Modify: `app/src/domain/bridge/host.ts`
- Modify: `app/src/domain/bridge/client.test.ts`
- Modify: `app/src/domain/bridge/client.ts`
- Modify: `app/src/App.test.tsx`
- Modify: `app/src/App.tsx`

- [ ] **Step 1: Update bridge protocol tests**

In `app/src/domain/bridge/protocol.test.ts`, remove obsolete settings fields from the sample snapshot:

```ts
settings: {
    uiScale: 1.5,
    committedUiScale: 1.0,
    autostartEnabled: true,
    dangerousChange: null,
},
```

Remove these dispatch samples:

```ts
{ v: 1, store: 'settings', action: 'setShowActiveAppWindowTitle', args: [false] },
{ v: 1, store: 'settings', action: 'setAutoPinOnFocusEnd', args: [false] },
```

Change the sample count assertion from `25` to `23`.

- [ ] **Step 2: Update host/client tests**

In `app/src/domain/bridge/host.test.ts` and `app/src/domain/bridge/client.test.ts`, remove obsolete settings fields from all `setState` calls, sample snapshots, and expectations. Add this assertion in each file where a settings object is inspected:

```ts
expect('showActiveAppWindowTitle' in snap.settings).toBe(false);
expect('autoPinOnFocusEnd' in snap.settings).toBe(false);
```

For `applySnapshotToMirrors`, use:

```ts
expect('showActiveAppWindowTitle' in useSettingsStore.getState()).toBe(false);
expect('autoPinOnFocusEnd' in useSettingsStore.getState()).toBe(false);
```

- [ ] **Step 3: Update App startup tests**

In `app/src/App.test.tsx`, change persisted settings mocks to:

```ts
loadPersistedSettingsMock.mockResolvedValue({
    uiScale: 1.5,
    autostartEnabled: false,
});
```

Change settings store reset to:

```ts
useSettingsStore.setState({
    uiScale: 1,
    committedUiScale: 1,
    autostartEnabled: false,
    dangerousChange: null,
});
```

Remove expectations that mention `showActiveAppWindowTitle` or `autoPinOnFocusEnd`.

- [ ] **Step 4: Run bridge/startup tests and verify failure**

Run:

```bash
cd app && npx vitest run src/domain/bridge/protocol.test.ts src/domain/bridge/host.test.ts src/domain/bridge/client.test.ts src/App.test.tsx
```

Expected: FAIL because production bridge and startup code still include obsolete fields.

- [ ] **Step 5: Implement bridge protocol cleanup**

In `app/src/domain/bridge/protocol.ts`, change `BridgeSnapshot.settings` to:

```ts
settings: {
    uiScale: number;
    committedUiScale: number;
    autostartEnabled: boolean;
    dangerousChange: DangerousChange | null;
};
```

Remove these `DispatchPayload` union members:

```ts
| { v: typeof BRIDGE_VERSION; store: 'settings'; action: 'setShowActiveAppWindowTitle'; args: [boolean] }
| { v: typeof BRIDGE_VERSION; store: 'settings'; action: 'setAutoPinOnFocusEnd'; args: [boolean] }
```

- [ ] **Step 6: Implement host/client cleanup**

In `app/src/domain/bridge/host.ts`, remove from `buildSnapshot()`:

```ts
showActiveAppWindowTitle: s.showActiveAppWindowTitle,
autoPinOnFocusEnd: s.autoPinOnFocusEnd,
```

Remove from settings dispatch handling:

```ts
case 'setShowActiveAppWindowTitle': s.setShowActiveAppWindowTitle(...payload.args); return;
case 'setAutoPinOnFocusEnd': s.setAutoPinOnFocusEnd(...payload.args); return;
```

In `app/src/domain/bridge/client.ts`, remove from `applySnapshotToMirrors()`:

```ts
showActiveAppWindowTitle: snap.settings.showActiveAppWindowTitle,
autoPinOnFocusEnd: snap.settings.autoPinOnFocusEnd,
```

- [ ] **Step 7: Implement App startup cleanup**

In `app/src/App.tsx`, change `buildStartupSettingsSnapshot()` to read only:

```ts
const {
    uiScale,
    committedUiScale,
} = useSettingsStore.getState();
```

Build this snapshot:

```ts
const snapshot = {
    uiScale: scaleChanged
        ? committedUiScale
        : persistedScale,
    autostartEnabled: confirmedAutostartEnabled,
};
```

Change `getStartupSettingsState()` to return:

```ts
return {
    uiScale,
    committedUiScale,
    autostartEnabled,
};
```

In the hydration `setState`, remove obsolete assignments:

```ts
showActiveAppWindowTitle: snapshot.showActiveAppWindowTitle,
autoPinOnFocusEnd: snapshot.autoPinOnFocusEnd,
```

- [ ] **Step 8: Run task tests**

Run:

```bash
cd app && npx vitest run src/domain/bridge/protocol.test.ts src/domain/bridge/host.test.ts src/domain/bridge/client.test.ts src/App.test.tsx
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add app/src/domain/bridge/protocol.test.ts app/src/domain/bridge/protocol.ts app/src/domain/bridge/host.test.ts app/src/domain/bridge/host.ts app/src/domain/bridge/client.test.ts app/src/domain/bridge/client.ts app/src/App.test.tsx app/src/App.tsx
git commit -m "refactor: remove obsolete settings from bridge"
```

Expected: commit succeeds with only these files staged.

---

### Task 4: Settings UI And Input Counter Behavior

**Files:**
- Modify: `app/src/ui/SettingsPanel.test.tsx`
- Modify: `app/src/ui/SettingsPanel.tsx`
- Modify: `app/src/ui/InputCounterPanel.test.tsx`
- Modify: `app/src/ui/InputCounterPanel.tsx`

- [ ] **Step 1: Update SettingsPanel tests**

In `app/src/ui/SettingsPanel.test.tsx`, remove obsolete fields from `useSettingsStore.setState()` setup.

Add this test near other global-tab tests:

```ts
it('does not render obsolete global settings', () => {
    useSettingsStore.setState({ activeTab: 'global' });

    render(<SettingsPanel />);

    expect(screen.queryByText('显示打开的文件名')).toBeNull();
    expect(screen.queryByText('专注结束后自动置顶')).toBeNull();
});
```

Remove tests that click or assert the deleted toggles.

- [ ] **Step 2: Update InputCounterPanel tests**

In `app/src/ui/InputCounterPanel.test.tsx`, remove the `useSettingsStore` import and setup for `showActiveAppWindowTitle`.

Replace `uses the app name instead of the window title when title display is disabled` with:

```ts
it('always uses the app name instead of the window title', () => {
    useBindingKeyStore.setState({
        entries: [
            { id: 'space', label: 'Space', keyCode: 49, pressCount: 47, enabled: true },
        ],
    });
    useActiveAppStore.setState({
        current: {
            name: 'Excel',
            bundle_id: 'com.microsoft.Excel',
            window_title: 'Budget.xlsx',
            icon_data_url: null,
        },
    });

    render(<InputCounterPanel />);

    expect(screen.getByText('Excel')).toBeInTheDocument();
    expect(screen.queryByText('Budget.xlsx')).toBeNull();
});
```

In `falls back from window title to app name and then a placeholder label`, rename the test to:

```ts
it('falls back from app name to a placeholder label', () => {
```

Keep the `Finder` and `未聚焦应用` assertions.

- [ ] **Step 3: Run UI tests and verify failure**

Run:

```bash
cd app && npx vitest run src/ui/SettingsPanel.test.tsx src/ui/InputCounterPanel.test.tsx
```

Expected: FAIL because production UI still renders deleted setting cards and still reads the title-display setting.

- [ ] **Step 4: Implement SettingsPanel cleanup**

In `app/src/ui/SettingsPanel.tsx`, delete the full card blocks whose labels are:

```tsx
<span className="card-label">显示打开的文件名</span>
<span className="card-label">专注结束后自动置顶</span>
```

Also remove references to:

```tsx
settings.showActiveAppWindowTitle
settings.setShowActiveAppWindowTitle
settings.autoPinOnFocusEnd
settings.setAutoPinOnFocusEnd
```

- [ ] **Step 5: Implement InputCounterPanel cleanup**

In `app/src/ui/InputCounterPanel.tsx`, remove:

```ts
import { useSettingsStore } from '../domain/settings';
const showActiveAppWindowTitle = useSettingsStore((s) => s.showActiveAppWindowTitle);
```

Change app label calculation to:

```ts
const appLabel = activeApp?.name?.trim() || '未聚焦应用';
```

- [ ] **Step 6: Run task tests**

Run:

```bash
cd app && npx vitest run src/ui/SettingsPanel.test.tsx src/ui/InputCounterPanel.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add app/src/ui/SettingsPanel.test.tsx app/src/ui/SettingsPanel.tsx app/src/ui/InputCounterPanel.test.tsx app/src/ui/InputCounterPanel.tsx
git commit -m "refactor: remove obsolete global settings UI"
```

Expected: commit succeeds with only these files staged.

---

### Task 5: Temporary Focus Helper And Pomodoro End Layer

**Files:**
- Create: `app/src/domain/focusWindow.ts`
- Create: `app/src/domain/focusWindow.test.ts`
- Modify: `app/src/ui/PomodoroEndActionLayer.test.tsx`
- Modify: `app/src/ui/PomodoroEndActionLayer.tsx`

- [ ] **Step 1: Write focus helper tests**

Create `app/src/domain/focusWindow.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { focusAppWindow } from './focusWindow';

const { invokeMock } = vi.hoisted(() => ({
    invokeMock: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));

beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValue(undefined);
});

describe('focusAppWindow', () => {
    it('focuses an allowlisted app window through Tauri', async () => {
        await focusAppWindow('main');

        expect(invokeMock).toHaveBeenCalledWith('focus_app_window', {
            label: 'main',
        });
    });

    it('supports the check-in editor window', async () => {
        await focusAppWindow('checkin-editor');

        expect(invokeMock).toHaveBeenCalledWith('focus_app_window', {
            label: 'checkin-editor',
        });
    });
});
```

- [ ] **Step 2: Run helper test and verify failure**

Run:

```bash
cd app && npx vitest run src/domain/focusWindow.test.ts
```

Expected: FAIL because `app/src/domain/focusWindow.ts` does not exist.

- [ ] **Step 3: Implement focus helper**

Create `app/src/domain/focusWindow.ts`:

```ts
import { invoke } from '@tauri-apps/api/core';

export type FocusableAppWindowLabel = 'main' | 'checkin-editor';

export async function focusAppWindow(label: FocusableAppWindowLabel): Promise<void> {
    await invoke('focus_app_window', { label });
}
```

- [ ] **Step 4: Update PomodoroEndActionLayer tests**

In `app/src/ui/PomodoroEndActionLayer.test.tsx`, extend the hoisted mocks:

```ts
const { focusAppWindowMock, openPomodoroVideoWindowMock, resolvePomodoroEndActionMock } = vi.hoisted(() => ({
    focusAppWindowMock: vi.fn(),
    openPomodoroVideoWindowMock: vi.fn(),
    resolvePomodoroEndActionMock: vi.fn(),
}));
```

Add mock:

```ts
vi.mock('../domain/focusWindow', () => ({
    focusAppWindow: focusAppWindowMock,
}));
```

Reset in `beforeEach()`:

```ts
focusAppWindowMock.mockReset();
focusAppWindowMock.mockResolvedValue(undefined);
```

Add assertions:

```ts
expect(focusAppWindowMock).toHaveBeenCalledWith('main');
```

to tests:

```ts
shows the focus-ended top popup when resolver returns topWindow
falls back to the top popup when the video player window cannot open
shows only a top popup when a break ends even if video is configured
shows only the completion popup when the final break ends
```

Add negative assertion to `opens a dedicated video player window when resolver returns video`:

```ts
expect(focusAppWindowMock).not.toHaveBeenCalled();
```

- [ ] **Step 5: Run Pomodoro layer tests and verify failure**

Run:

```bash
cd app && npx vitest run src/ui/PomodoroEndActionLayer.test.tsx
```

Expected: FAIL because `PomodoroEndActionLayer` does not call `focusAppWindow('main')`.

- [ ] **Step 6: Implement Pomodoro focus calls**

In `app/src/ui/PomodoroEndActionLayer.tsx`, import:

```ts
import { focusAppWindow } from '../domain/focusWindow';
```

Inside `showTopPopup`, after `setPopup(title);`, add:

```ts
void focusAppWindow('main').catch((error) => {
    console.warn('[pomodoro-end] focus main window failed', error);
});
```

Keep the existing timeout logic unchanged.

- [ ] **Step 7: Run task tests**

Run:

```bash
cd app && npx vitest run src/domain/focusWindow.test.ts src/ui/PomodoroEndActionLayer.test.tsx
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add app/src/domain/focusWindow.ts app/src/domain/focusWindow.test.ts app/src/ui/PomodoroEndActionLayer.test.tsx app/src/ui/PomodoroEndActionLayer.tsx
git commit -m "feat: focus main window for pomodoro end prompts"
```

Expected: commit succeeds with only these files staged.

---

### Task 6: Check-In Editor Focus On Natural Focus End

**Files:**
- Modify: `app/src/checkinPomodoroIntegration.test.tsx`
- Modify: `app/src/App.test.tsx`
- Modify: `app/src/App.tsx`

- [ ] **Step 1: Update integration test mocks**

In `app/src/checkinPomodoroIntegration.test.tsx`, add `openCheckinEditorWindowMock` to the hoisted object:

```ts
openCheckinEditorWindowMock: vi.fn(),
```

Change the `./domain/checkinWindow` mock to:

```ts
vi.mock('./domain/checkinWindow', () => ({
    openCheckinEditorWindow: openCheckinEditorWindowMock,
    useCheckinWindowController,
}));
```

Reset in `beforeEach()`:

```ts
openCheckinEditorWindowMock.mockReset();
openCheckinEditorWindowMock.mockResolvedValue(undefined);
```

- [ ] **Step 2: Add natural-end and skip tests**

Add to `app/src/checkinPomodoroIntegration.test.tsx`:

```ts
it('opens the check-in editor when a focus timer naturally ends', () => {
    render(<App />);

    act(() => {
        usePomodoroStore.setState({
            lastEndEvent: { id: 11, fromPhase: 'focus', toPhase: 'break', triggeredBy: 'timer' },
        });
    });

    expect(openCheckinEditorWindowMock).toHaveBeenCalledTimes(1);
});

it('does not open the check-in editor when focus is skipped manually', () => {
    render(<App />);

    act(() => {
        usePomodoroStore.setState({
            lastEndEvent: { id: 12, fromPhase: 'focus', toPhase: 'break', triggeredBy: 'skip' },
        });
    });

    expect(openCheckinEditorWindowMock).not.toHaveBeenCalled();
});

it('does not auto-pin the main window when focus naturally ends', () => {
    const setPinnedSpy = vi.spyOn(usePomodoroStore.getState(), 'setPinned');
    render(<App />);

    act(() => {
        usePomodoroStore.setState({
            lastEndEvent: { id: 13, fromPhase: 'focus', toPhase: 'break', triggeredBy: 'timer' },
        });
    });

    expect(setPinnedSpy).not.toHaveBeenCalled();
    expect(usePomodoroStore.getState().isPinned).toBe(false);
    setPinnedSpy.mockRestore();
});
```

- [ ] **Step 3: Update App test settings setup**

In `app/src/App.test.tsx`, remove any leftover `autoPinOnFocusEnd` setup or expectations.

- [ ] **Step 4: Run integration tests and verify failure**

Run:

```bash
cd app && npx vitest run src/checkinPomodoroIntegration.test.tsx src/App.test.tsx
```

Expected: FAIL because `App.tsx` still uses `autoPinOnFocusEnd` and does not open the editor.

- [ ] **Step 5: Implement App integration**

In `app/src/App.tsx`, update imports:

```ts
import { openCheckinEditorWindow, useCheckinWindowController } from './domain/checkinWindow';
```

In the Pomodoro subscription effect, replace the auto-pin block:

```ts
if (
    event.toPhase === 'break'
    && event.triggeredBy === 'timer'
    && useSettingsStore.getState().autoPinOnFocusEnd
    && !state.isPinned
) {
    usePomodoroStore.getState().setPinned(true);
}
```

with:

```ts
if (event.toPhase === 'break' && event.triggeredBy === 'timer') {
    void openCheckinEditorWindow().catch((error) => {
        console.warn('[checkin] open editor on focus end failed', error);
    });
}
```

Keep `applyPomodoroFocusCompletion(todayLocalDate(), event.id);` before this block.

- [ ] **Step 6: Run task tests**

Run:

```bash
cd app && npx vitest run src/checkinPomodoroIntegration.test.tsx src/App.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add app/src/checkinPomodoroIntegration.test.tsx app/src/App.test.tsx app/src/App.tsx
git commit -m "feat: focus check-in editor on focus completion"
```

Expected: commit succeeds with only these files staged.

---

### Task 7: Tauri Window Focus And Check-In Pin Policy

**Files:**
- Modify: `app/src/checkinWindowConfig.test.ts`
- Modify: `app/src-tauri/src/lib.rs`

- [ ] **Step 1: Update Rust source text tests**

In `app/src/checkinWindowConfig.test.ts`, add assertions to the Tauri window configuration test:

```ts
expect(source).toMatch(/fn focus_app_window/);
expect(source).toMatch(/match label\\.as_str\\(\\)[\\s\\S]*"main"[\\s\\S]*"checkin-editor"/);
expect(source).toMatch(/tauri::generate_handler!\\[[\\s\\S]*focus_app_window/);
```

Add a new test:

```ts
it('does not pin check-in windows by default or when opening them', () => {
    const source = readFileSync(libRsPath, 'utf8');
    const todayBuilder = rustFunction(source, 'build_today_checkin_window_hidden');
    const editorBuilder = rustFunction(source, 'build_checkin_editor_window_hidden');
    const todayOpen = rustFunction(source, 'open_today_checkin_window');
    const editorOpen = rustFunction(source, 'open_checkin_editor_window');

    expect(todayBuilder?.body).toMatch(/\\.always_on_top\\(false\\)/);
    expect(editorBuilder?.body).toMatch(/\\.always_on_top\\(false\\)/);
    expect(todayBuilder?.body).not.toMatch(/set_always_on_top_native/);
    expect(editorBuilder?.body).not.toMatch(/set_always_on_top_native/);
    expect(todayOpen?.body).not.toMatch(/set_focus\\(/);
    expect(todayOpen?.body).not.toMatch(/set_always_on_top_native/);
    expect(editorOpen?.body).toMatch(/focus_existing_window\\(app,\\s*"checkin-editor"\\)/);
    expect(editorOpen?.body).not.toMatch(/set_always_on_top_native/);
});
```

If `rustFunction` is scoped inside another test file only, copy the same helper functions from `app/src/windowPinConfig.test.ts` into `app/src/checkinWindowConfig.test.ts`.

- [ ] **Step 2: Run config tests and verify failure**

Run:

```bash
cd app && npx vitest run src/checkinWindowConfig.test.ts
```

Expected: FAIL because check-in windows are still always-on-top and `focus_app_window` does not exist.

- [ ] **Step 3: Implement Rust helper functions**

In `app/src-tauri/src/lib.rs`, replace `show_existing_window` with two helpers:

```rust
fn show_existing_window(app: tauri::AppHandle, label: &str) -> Result<(), String> {
    let w = app.get_webview_window(label).ok_or_else(|| {
        format!("{label} window not built — setup() probably failed; check stderr")
    })?;
    w.show().map_err(|e| e.to_string())?;
    Ok(())
}

fn focus_existing_window(app: tauri::AppHandle, label: &str) -> Result<(), String> {
    let w = app.get_webview_window(label).ok_or_else(|| {
        format!("{label} window not built — setup() probably failed; check stderr")
    })?;
    w.show().map_err(|e| e.to_string())?;
    w.set_focus().map_err(|e| e.to_string())?;
    Ok(())
}
```

Add command:

```rust
#[tauri::command]
async fn focus_app_window(app: tauri::AppHandle, label: String) -> Result<(), String> {
    match label.as_str() {
        "main" | "checkin-editor" => focus_existing_window(app, label.as_str()),
        _ => Err(format!("{label} window cannot be focused by this command")),
    }
}
```

Register `focus_app_window` inside `tauri::generate_handler![...]`.

- [ ] **Step 4: Implement check-in window pin policy**

In `build_today_checkin_window_hidden`, change:

```rust
.always_on_top(true)
```

to:

```rust
.always_on_top(false)
```

Delete:

```rust
let _ = window_helpers::set_always_on_top_native(&w, true);
```

Make the same two edits in `build_checkin_editor_window_hidden`.

Change open commands:

```rust
#[tauri::command]
async fn open_today_checkin_window(app: tauri::AppHandle) -> Result<(), String> {
    show_existing_window(app, "today-checkin")
}

#[tauri::command]
async fn open_checkin_editor_window(app: tauri::AppHandle) -> Result<(), String> {
    focus_existing_window(app, "checkin-editor")
}
```

- [ ] **Step 5: Run task tests and cargo check**

Run:

```bash
cd app && npx vitest run src/checkinWindowConfig.test.ts
cd app/src-tauri && cargo check
```

Expected: both PASS.

- [ ] **Step 6: Commit**

```bash
git add app/src/checkinWindowConfig.test.ts app/src-tauri/src/lib.rs
git commit -m "feat: add temporary focus window command"
```

Expected: commit succeeds with only these files staged.

---

### Task 8: Final Verification

**Files:**
- No source edits expected.

- [ ] **Step 1: Run repository tests**

Run:

```bash
cd app && npm test
```

Expected: PASS.

- [ ] **Step 2: Run frontend build**

Run:

```bash
cd app && npm run build
```

Expected: PASS with `tsc && vite build`.

- [ ] **Step 3: Run Rust check**

Run:

```bash
cd app/src-tauri && cargo check
```

Expected: PASS.

- [ ] **Step 4: Search for obsolete fields**

Run:

```bash
rg -n "showActiveAppWindowTitle|setShowActiveAppWindowTitle|autoPinOnFocusEnd|setAutoPinOnFocusEnd|显示打开的文件名|专注结束后自动置顶" app/src app/src-tauri docs/superpowers/plans/2026-05-21-temporary-focus-windows.md
```

Expected: only this plan file may contain the obsolete strings. `app/src` and `app/src-tauri` should have no matches.

- [ ] **Step 5: Commit final verification note if files changed**

If no files changed, do not commit. If test snapshots or generated metadata changed, inspect them first, then commit only intentional files:

```bash
git status --short
git add <intentional-files>
git commit -m "test: update temporary focus verification artifacts"
```

Expected: working tree is clean or contains only intentional committed changes.

---

## Self-Review

- Spec coverage: Tasks cover Pencil deletion, settings persistence/state/bridge/UI cleanup, input counter app-name behavior, main-window temporary focus, check-in editor focus on natural focus completion, today-checkin non-pin behavior, Tauri allowlisted focus command, and final verification.
- Placeholder scan: No TBD, TODO, "implement later", or undefined helper names. Every new function named in later tasks is created before use.
- Type consistency: `focusAppWindow(label: 'main' | 'checkin-editor')` calls `focus_app_window`; Rust allowlist accepts the same labels. Deleted settings fields are consistently removed from store, persistence, bridge, UI, and tests.
