# Auto Pin On Focus End Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a focus timer naturally ends and enters break, automatically enable the main-window pin by default, with a persisted global setting to disable the behavior.

**Architecture:** The settings store owns the new `autoPinOnFocusEnd` preference and persists it with other global settings. The Pomodoro store owns `isPinned`; `App.tsx` observes focus-end timer events and calls a new `setPinned(true)` action, letting the existing `PomodoroPanel` effect invoke the native `set_main_window_pinned` command.

**Tech Stack:** React, TypeScript, Zustand, Vitest, Testing Library, Tauri invoke bridge, Pencil MCP.

---

## File Structure

- Modify `AUI/PUI.pen`: add the visual global setting row in `Global Settings Panel` (`Pdj9C`).
- Modify `app/src/domain/settingsPersistence.ts`: add persisted optional `autoPinOnFocusEnd`, default old files to `true`, validate booleans.
- Modify `app/src/domain/settings.ts`: add settings state, setter, settings-window dispatch, and persistence writes.
- Modify `app/src/domain/bridge/protocol.ts`: include the field in snapshots and dispatch payloads.
- Modify `app/src/domain/bridge/host.ts`: clone the field and route dispatch.
- Modify `app/src/domain/pomodoro.ts`: add `setPinned(isPinned: boolean)`.
- Modify `app/src/App.tsx`: hydrate the new setting and subscribe to focus-end timer events to pin once.
- Modify `app/src/ui/SettingsPanel.tsx`: render the global toggle row.
- Modify tests alongside these files: `settingsPersistence.test.ts`, `settings.test.ts`, `bridge/host.test.ts`, `pomodoro.test.ts`, `App.test.tsx`, `SettingsPanel.test.tsx`.

---

### Task 1: Pencil Design Row

**Files:**
- Modify: `AUI/PUI.pen`

- [ ] **Step 1: Insert the global setting row in Pencil**

Use Pencil MCP with the active file `/Users/xpy/.codex/worktrees/442a/CPA_V2/AUI/PUI.pen`.

Run this `batch_design` snippet:

```javascript
U("Pdj9C",{placeholder:true})
gspAutoPinOnFocusEnd=I("Pdj9C",{type:"frame",name:"gspAutoPinOnFocusEnd",layout:"horizontal",alignItems:"center",justifyContent:"space_between",cornerRadius:16,fill:"#F6F7F8",padding:16,width:"fill_container"})
I(gspAutoPinOnFocusEnd,{type:"text",name:"gsp-auto-pin-focus-end-label",content:"专注结束后自动置顶",fill:"#9CA3AF",fontFamily:"MaokenAssortedSans",fontSize:12,fontWeight:"600"})
I(gspAutoPinOnFocusEnd,{type:"ref",name:"gsp-auto-pin-focus-end-toggle",ref:"NGo9f"})
M(gspAutoPinOnFocusEnd,"Pdj9C",2)
U("Pdj9C",{placeholder:false})
```

- [ ] **Step 2: Verify the Pencil structure**

Run `batch_get` for `Pdj9C` with `readDepth: 2`.

Expected: `Pdj9C.children[2].name` is `gspAutoPinOnFocusEnd`, and it contains text content `专注结束后自动置顶` plus a `ref` to `NGo9f`.

- [ ] **Step 3: Verify the visual**

Run `get_screenshot` for node `Pdj9C`.

Expected: the new row appears directly under `开机自启动`, uses the same light gray card style, and the toggle is visually on.

- [ ] **Step 4: Commit**

```bash
git add AUI/PUI.pen
git commit -m "design: add auto pin global setting"
```

Expected: commit succeeds with only `AUI/PUI.pen` staged.

---

### Task 2: Settings Persistence And Store

**Files:**
- Modify: `app/src/domain/settingsPersistence.test.ts`
- Modify: `app/src/domain/settingsPersistence.ts`
- Modify: `app/src/domain/settings.test.ts`
- Modify: `app/src/domain/settings.ts`

- [ ] **Step 1: Write failing persistence tests**

Add these tests to `app/src/domain/settingsPersistence.test.ts`:

```ts
it('loads persisted autoPinOnFocusEnd settings', async () => {
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
        showActiveAppWindowTitle: false,
        autostartEnabled: true,
        autoPinOnFocusEnd: false,
    });
});

it('defaults autoPinOnFocusEnd to true for older v1 settings', async () => {
    store.get.mockResolvedValue({ v: 1, uiScale: 1.75 });
    const { loadPersistedSettings } = await import('./settingsPersistence');

    await expect(loadPersistedSettings()).resolves.toEqual({
        uiScale: 1.75,
        showActiveAppWindowTitle: true,
        autostartEnabled: false,
        autoPinOnFocusEnd: true,
    });
});

it('ignores malformed autoPinOnFocusEnd settings', async () => {
    store.get.mockResolvedValue({
        v: 1,
        uiScale: 1.75,
        showActiveAppWindowTitle: true,
        autostartEnabled: false,
        autoPinOnFocusEnd: 'yes',
    });
    const { loadPersistedSettings } = await import('./settingsPersistence');

    await expect(loadPersistedSettings()).resolves.toBeNull();
});
```

Update the existing `loads persisted v1 settings`, `defaults showActiveAppWindowTitle to true for older v1 settings`, and `saves persisted v1 settings` expected objects so they include `autoPinOnFocusEnd`.

- [ ] **Step 2: Run persistence tests and verify they fail**

Run:

```bash
cd app && npx vitest run src/domain/settingsPersistence.test.ts
```

Expected: FAIL because `autoPinOnFocusEnd` is absent from the persisted type, load result, and save payload.

- [ ] **Step 3: Implement persistence support**

In `app/src/domain/settingsPersistence.ts`, update the interfaces and validator:

```ts
export interface PersistedSettings {
    uiScale: number;
    showActiveAppWindowTitle: boolean;
    autostartEnabled: boolean;
    autoPinOnFocusEnd: boolean;
}

interface PersistedSettingsV1 {
    v: 1;
    uiScale: number;
    showActiveAppWindowTitle?: boolean;
    autostartEnabled?: boolean;
    autoPinOnFocusEnd?: boolean;
}
```

Add this validation branch inside `isPersistedSettingsV1`:

```ts
        && (
            candidate.autoPinOnFocusEnd === undefined
            || typeof candidate.autoPinOnFocusEnd === 'boolean'
        );
```

Return the new default in `loadPersistedSettings`:

```ts
        return {
            uiScale: value.uiScale,
            showActiveAppWindowTitle: value.showActiveAppWindowTitle ?? true,
            autostartEnabled: value.autostartEnabled ?? false,
            autoPinOnFocusEnd: value.autoPinOnFocusEnd ?? true,
        };
```

Save the new field in `savePersistedSettings`:

```ts
        await store.set(STORE_KEY, {
            v: 1,
            uiScale: settings.uiScale,
            showActiveAppWindowTitle: settings.showActiveAppWindowTitle,
            autostartEnabled: settings.autostartEnabled,
            autoPinOnFocusEnd: settings.autoPinOnFocusEnd,
        } satisfies PersistedSettingsV1);
```

- [ ] **Step 4: Write failing settings store tests**

Add these tests to `app/src/domain/settings.test.ts`:

```ts
it('defaults autoPinOnFocusEnd to true', () => {
    expect(useSettingsStore.getState().autoPinOnFocusEnd).toBe(true);

    const settingsWindowStore = createSettingsStore({ isSettingsWindow: true });
    expect(settingsWindowStore.getState().autoPinOnFocusEnd).toBe(true);
});

it('hydrates autoPinOnFocusEnd from persisted settings', () => {
    useSettingsStore.getState().hydrateSettings({ uiScale: 1.25, autoPinOnFocusEnd: false });

    expect(useSettingsStore.getState().autoPinOnFocusEnd).toBe(false);
});

it('defaults missing persisted autoPinOnFocusEnd to true during hydration', () => {
    useSettingsStore.setState({ autoPinOnFocusEnd: false });

    useSettingsStore.getState().hydrateSettings({ uiScale: 1.25 });

    expect(useSettingsStore.getState().autoPinOnFocusEnd).toBe(true);
});

it('setAutoPinOnFocusEnd persists all global settings fields', () => {
    useSettingsStore.setState({
        committedUiScale: 1.5,
        showActiveAppWindowTitle: false,
        autostartEnabled: true,
        autoPinOnFocusEnd: true,
    });

    useSettingsStore.getState().setAutoPinOnFocusEnd(false);

    expect(useSettingsStore.getState().autoPinOnFocusEnd).toBe(false);
    expect(settingsMocks.savePersistedSettings).toHaveBeenCalledWith({
        uiScale: 1.5,
        showActiveAppWindowTitle: false,
        autostartEnabled: true,
        autoPinOnFocusEnd: false,
    });
});
```

Add this settings-window test near the other dispatch tests:

```ts
it('setAutoPinOnFocusEnd dispatches instead of mutating local state', () => {
    const spy = vi.spyOn(dispatchMod, 'dispatch').mockResolvedValue();
    const store = createSettingsStore({ isSettingsWindow: true });

    store.getState().setAutoPinOnFocusEnd(false);

    expect(store.getState().autoPinOnFocusEnd).toBe(true);
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({
        v: BRIDGE_VERSION,
        store: 'settings',
        action: 'setAutoPinOnFocusEnd',
        args: [false],
    }));
    spy.mockRestore();
});
```

Update every existing expected `savePersistedSettings` object in `settings.test.ts` so it includes the current `autoPinOnFocusEnd` value.

- [ ] **Step 5: Run settings tests and verify they fail**

Run:

```bash
cd app && npx vitest run src/domain/settings.test.ts
```

Expected: FAIL because `autoPinOnFocusEnd` and `setAutoPinOnFocusEnd` are not defined.

- [ ] **Step 6: Implement settings store support**

In `app/src/domain/settings.ts`, update the persistence import:

```ts
import { savePersistedSettings, type PersistedSettings } from './settingsPersistence';
```

Then update types:

```ts
export interface SettingsState {
    activeTab: SettingsTab;
    uiScale: number;
    committedUiScale: number;
    showActiveAppWindowTitle: boolean;
    autostartEnabled: boolean;
    autoPinOnFocusEnd: boolean;
    dangerousChange: DangerousChange | null;
}

export interface PersistedSettingsSnapshot {
    uiScale: number;
    showActiveAppWindowTitle?: boolean;
    autostartEnabled?: boolean;
    autoPinOnFocusEnd?: boolean;
}

interface SettingsActions {
    setActiveTab: (tab: SettingsTab) => void;
    setUiScale: (scale: number) => void;
    setShowActiveAppWindowTitle: (enabled: boolean) => void;
    setAutostartEnabled: (enabled: boolean) => Promise<void> | void;
    setAutoPinOnFocusEnd: (enabled: boolean) => void;
    previewDangerousUiScale: (scale: number) => void;
    applyDangerousChange: (id: string) => void;
    revertDangerousChange: (id: string) => void;
    hydrateSettings: (snapshot: PersistedSettingsSnapshot) => void;
}
```

Add this helper near `createDangerousChangeId`:

```ts
function persistedSnapshot(state: SettingsState): PersistedSettings {
    return {
        uiScale: state.committedUiScale,
        showActiveAppWindowTitle: state.showActiveAppWindowTitle,
        autostartEnabled: state.autostartEnabled,
        autoPinOnFocusEnd: state.autoPinOnFocusEnd,
    };
}
```

Add `autoPinOnFocusEnd: true` to both initial store objects.

In settings-window mode, add:

```ts
            setAutoPinOnFocusEnd: (enabled) => {
                void dispatch({
                    v: BRIDGE_VERSION,
                    store: 'settings',
                    action: 'setAutoPinOnFocusEnd',
                    args: [enabled],
                });
            },
```

In main-window mode, add:

```ts
        setAutoPinOnFocusEnd: (enabled) => {
            set({ autoPinOnFocusEnd: enabled });
            void savePersistedSettings(persistedSnapshot(get()));
        },
```

Replace the current object-literal `savePersistedSettings` calls in settings actions with `savePersistedSettings(persistedSnapshot(get()))`, except for `setAutostartEnabled`, where the confirmed value must be in state before saving:

```ts
        setAutostartEnabled: async (enabled) => {
            const fallback = get().autostartEnabled;
            const confirmed = await applyAutostartEnabled(enabled, fallback);
            set({ autostartEnabled: confirmed });
            void savePersistedSettings(persistedSnapshot(get()));
        },
```

Update both `hydrateSettings` implementations to include:

```ts
autoPinOnFocusEnd: snapshot.autoPinOnFocusEnd ?? true,
```

- [ ] **Step 7: Run focused tests and commit**

Run:

```bash
cd app && npx vitest run src/domain/settingsPersistence.test.ts src/domain/settings.test.ts
```

Expected: PASS.

Commit:

```bash
git add app/src/domain/settingsPersistence.test.ts app/src/domain/settingsPersistence.ts app/src/domain/settings.test.ts app/src/domain/settings.ts
git commit -m "feat: persist auto pin setting"
```

---

### Task 3: Bridge Snapshot And Dispatch

**Files:**
- Modify: `app/src/domain/bridge/protocol.ts`
- Modify: `app/src/domain/bridge/host.ts`
- Modify: `app/src/domain/bridge/host.test.ts`

- [ ] **Step 1: Write failing bridge tests**

In `app/src/domain/bridge/host.test.ts`, update the `beforeEach` settings state with `autoPinOnFocusEnd: true`.

In `reads from every source store and stamps the version`, add:

```ts
useSettingsStore.setState({ autoPinOnFocusEnd: false });
expect(snap.settings.autoPinOnFocusEnd).toBe(false);
```

Add this test in `describe('applyDispatch')`:

```ts
it('routes auto-pin-on-focus-end setting to the authoritative settings store', () => {
    const original = useSettingsStore.getState().setAutoPinOnFocusEnd;
    const setAutoPinOnFocusEnd = vi.fn();
    useSettingsStore.setState({ setAutoPinOnFocusEnd });

    try {
        applyDispatch({
            v: BRIDGE_VERSION,
            store: 'settings',
            action: 'setAutoPinOnFocusEnd',
            args: [false],
        });

        expect(setAutoPinOnFocusEnd).toHaveBeenCalledWith(false);
    } finally {
        useSettingsStore.setState({ setAutoPinOnFocusEnd: original });
    }
});
```

- [ ] **Step 2: Run bridge tests and verify they fail**

Run:

```bash
cd app && npx vitest run src/domain/bridge/host.test.ts
```

Expected: FAIL because the bridge snapshot and dispatch union do not include `autoPinOnFocusEnd`.

- [ ] **Step 3: Implement bridge support**

In `app/src/domain/bridge/protocol.ts`, add the setting to `BridgeSnapshot.settings`:

```ts
        autoPinOnFocusEnd: boolean;
```

Add this dispatch union member:

```ts
    | { v: typeof BRIDGE_VERSION; store: 'settings';   action: 'setAutoPinOnFocusEnd'; args: [boolean] }
```

In `app/src/domain/bridge/host.ts`, include the field in `buildSnapshot`:

```ts
            autoPinOnFocusEnd: s.autoPinOnFocusEnd,
```

Route the dispatch in the settings switch:

```ts
                case 'setAutoPinOnFocusEnd': s.setAutoPinOnFocusEnd(...payload.args); return;
```

- [ ] **Step 4: Run bridge tests and commit**

Run:

```bash
cd app && npx vitest run src/domain/bridge/host.test.ts
```

Expected: PASS.

Commit:

```bash
git add app/src/domain/bridge/protocol.ts app/src/domain/bridge/host.ts app/src/domain/bridge/host.test.ts
git commit -m "feat: bridge auto pin setting"
```

---

### Task 4: Pomodoro Pin Action And App Integration

**Files:**
- Modify: `app/src/domain/pomodoro.ts`
- Modify: `app/src/domain/pomodoro.test.ts`
- Modify: `app/src/App.tsx`
- Modify: `app/src/App.test.tsx`

- [ ] **Step 1: Write failing Pomodoro action test**

Add this test to `app/src/domain/pomodoro.test.ts`:

```ts
it('setPinned sets an explicit pin state without toggling', () => {
    const store = freshStore();

    store.getState().setPinned(true);
    expect(store.getState().isPinned).toBe(true);

    store.getState().setPinned(true);
    expect(store.getState().isPinned).toBe(true);

    store.getState().setPinned(false);
    expect(store.getState().isPinned).toBe(false);
});
```

- [ ] **Step 2: Run Pomodoro test and verify it fails**

Run:

```bash
cd app && npx vitest run src/domain/pomodoro.test.ts --testNamePattern "setPinned"
```

Expected: FAIL because `setPinned` is not defined.

- [ ] **Step 3: Implement `setPinned`**

In `app/src/domain/pomodoro.ts`, add to `PomodoroActions`:

```ts
    setPinned: (isPinned: boolean) => void;
```

Add `setPinned: () => {},` to the settings-window store.

Add this action to the main store next to `togglePin`:

```ts
            setPinned: (isPinned) => set((s) => (
                s.isPinned === isPinned ? s : { isPinned }
            )),
```

- [ ] **Step 4: Write failing App integration tests**

In `app/src/App.test.tsx`, import the Pomodoro store:

```ts
import { usePomodoroStore } from './domain/pomodoro';
```

In `beforeEach`, reset Pomodoro state:

```ts
    usePomodoroStore.setState({
        currentPhase: 'focus',
        isRunning: false,
        isPinned: false,
        lastEndEvent: null,
    });
```

Also add `autoPinOnFocusEnd: true` to the `useSettingsStore.setState` reset.

Add these tests:

```ts
it('auto-pins the main window after a natural focus completion', async () => {
    render(<App />);

    await act(async () => {
        usePomodoroStore.setState({
            lastEndEvent: { id: 1, fromPhase: 'focus', toPhase: 'break', triggeredBy: 'timer' },
        });
    });

    expect(usePomodoroStore.getState().isPinned).toBe(true);
});

it('does not auto-pin when the global setting is disabled', async () => {
    useSettingsStore.setState({ autoPinOnFocusEnd: false });
    render(<App />);

    await act(async () => {
        usePomodoroStore.setState({
            lastEndEvent: { id: 1, fromPhase: 'focus', toPhase: 'break', triggeredBy: 'timer' },
        });
    });

    expect(usePomodoroStore.getState().isPinned).toBe(false);
});

it('does not auto-pin when focus is skipped manually', async () => {
    render(<App />);

    await act(async () => {
        usePomodoroStore.setState({
            lastEndEvent: { id: 1, fromPhase: 'focus', toPhase: 'break', triggeredBy: 'skip' },
        });
    });

    expect(usePomodoroStore.getState().isPinned).toBe(false);
});

it('does not rewrite pin state when it is already active', async () => {
    const originalSetPinned = usePomodoroStore.getState().setPinned;
    const setPinned = vi.fn(originalSetPinned);
    usePomodoroStore.setState({ isPinned: true, setPinned });

    try {
        render(<App />);

        await act(async () => {
            usePomodoroStore.setState({
                lastEndEvent: { id: 1, fromPhase: 'focus', toPhase: 'break', triggeredBy: 'timer' },
            });
        });

        expect(setPinned).not.toHaveBeenCalled();
    } finally {
        usePomodoroStore.setState({ setPinned: originalSetPinned });
    }
});
```

- [ ] **Step 5: Run App tests and verify they fail**

Run:

```bash
cd app && npx vitest run src/App.test.tsx --testNamePattern "auto-pin|pin state|skipped"
```

Expected: FAIL because `App.tsx` only updates check-in state on Pomodoro end events.

- [ ] **Step 6: Implement App auto-pin subscription**

In `app/src/App.tsx`, add `autoPinOnFocusEnd` to startup snapshots.

Update `buildStartupSettingsSnapshot`:

```ts
    const {
        uiScale,
        committedUiScale,
        showActiveAppWindowTitle,
        autoPinOnFocusEnd,
    } = useSettingsStore.getState();
    const autoPinChanged = autoPinOnFocusEnd !== initialSettings.autoPinOnFocusEnd;
```

Add to `snapshot`:

```ts
        autoPinOnFocusEnd: autoPinChanged
            ? autoPinOnFocusEnd
            : settings?.autoPinOnFocusEnd ?? autoPinOnFocusEnd,
```

Update `getStartupSettingsState` to include:

```ts
        autoPinOnFocusEnd,
```

Update hydration `useSettingsStore.setState` to include:

```ts
                    autoPinOnFocusEnd: snapshot.autoPinOnFocusEnd,
```

Update the `savePersistedSettings(snapshot)` path so `snapshot` includes the new field.

Replace the existing Pomodoro end subscription with this combined logic:

```ts
    useEffect(() => {
        return usePomodoroStore.subscribe((state, previous) => {
            const event = state.lastEndEvent;
            if (!event || event === previous.lastEndEvent) return;
            if (event.fromPhase !== 'focus') return;

            useCheckinStore.getState().applyPomodoroFocusCompletion(todayLocalDate(), event.id);

            if (
                event.toPhase === 'break' &&
                event.triggeredBy === 'timer' &&
                useSettingsStore.getState().autoPinOnFocusEnd &&
                !state.isPinned
            ) {
                usePomodoroStore.getState().setPinned(true);
            }
        });
    }, []);
```

- [ ] **Step 7: Run focused tests and commit**

Run:

```bash
cd app && npx vitest run src/domain/pomodoro.test.ts src/App.test.tsx
```

Expected: PASS.

Commit:

```bash
git add app/src/domain/pomodoro.ts app/src/domain/pomodoro.test.ts app/src/App.tsx app/src/App.test.tsx
git commit -m "feat: auto pin after focus ends"
```

---

### Task 5: Settings UI

**Files:**
- Modify: `app/src/ui/SettingsPanel.tsx`
- Modify: `app/src/ui/SettingsPanel.test.tsx`

- [ ] **Step 1: Write failing UI tests**

In `app/src/ui/SettingsPanel.test.tsx`, update the global `useSettingsStore.setState` reset with `autoPinOnFocusEnd: true`.

Add these tests in the global settings describe block:

```ts
it('shows auto pin on focus end between autostart and automatic updates', () => {
    useSettingsStore.setState({ activeTab: 'global' });
    render(<SettingsPanel />);

    const autostart = screen.getByText('开机自启动');
    const autoPin = screen.getByText('专注结束后自动置顶');
    const autoUpdate = screen.getByText('自动下载并安装更新');

    expect(autostart.compareDocumentPosition(autoPin) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(autoPin.compareDocumentPosition(autoUpdate) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

it('routes auto pin on focus end toggles to the settings store action', () => {
    const setAutoPinOnFocusEnd = vi.fn();
    useSettingsStore.setState({
        activeTab: 'global',
        autoPinOnFocusEnd: true,
        setAutoPinOnFocusEnd,
    });
    render(<SettingsPanel />);

    fireEvent.click(screen.getByRole('button', { name: '专注结束后自动置顶' }));

    expect(setAutoPinOnFocusEnd).toHaveBeenCalledWith(false);
});
```

- [ ] **Step 2: Run UI tests and verify they fail**

Run:

```bash
cd app && npx vitest run src/ui/SettingsPanel.test.tsx --testNamePattern "auto pin|专注结束后自动置顶"
```

Expected: FAIL because the global settings row is not rendered.

- [ ] **Step 3: Implement the global settings row**

In `app/src/ui/SettingsPanel.tsx`, add this card after the `开机自启动` card and before `<AppUpdateSettingsRow />`:

```tsx
                <div className="card">
                    <div className="card-row">
                        <span className="card-label">专注结束后自动置顶</span>
                        <Toggle
                            checked={settings.autoPinOnFocusEnd}
                            onChange={settings.setAutoPinOnFocusEnd}
                            ariaLabel="专注结束后自动置顶"
                        />
                    </div>
                </div>
```

- [ ] **Step 4: Run UI tests and commit**

Run:

```bash
cd app && npx vitest run src/ui/SettingsPanel.test.tsx
```

Expected: PASS.

Commit:

```bash
git add app/src/ui/SettingsPanel.tsx app/src/ui/SettingsPanel.test.tsx
git commit -m "feat: add auto pin global toggle"
```

---

### Task 6: Full Verification

**Files:**
- Verify all changed files from Tasks 1-5.

- [ ] **Step 1: Run all frontend tests**

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

Expected: PASS with Vite build output and no TypeScript errors.

- [ ] **Step 3: Inspect final status**

Run:

```bash
git status --short
```

Expected: no uncommitted files.

- [ ] **Step 4: Final manual acceptance**

Run the app:

```bash
cd app && npm run tauri dev
```

Expected:

1. Open settings, switch to `全局`, and see `专注结束后自动置顶` enabled.
2. Start a short focus timer in a dev build or via test state.
3. Let it naturally enter break.
4. The main window pin icon becomes active and the window is topmost.
5. Disable the global setting and repeat; the pin icon remains unchanged.
