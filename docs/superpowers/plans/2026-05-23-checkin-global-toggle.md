# Check-in Global Toggle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a persisted global `打卡系统` switch that controls normal check-in usage without deleting plans or records.

**Architecture:** The new `checkinEnabled` flag belongs to the existing settings domain and mirrors through the existing bridge. Check-in plan/record data remains in the check-in domain, while app flows consult settings before auto-opening check-in windows or applying Pomodoro completion to check-in records.

**Tech Stack:** React, TypeScript, Zustand, Vitest, Tauri bridge events, Pencil MCP.

---

## Files

- Modify: `AUI/PUI.pen` through Pencil MCP only, updating `Pdj9C/gspDailyPlan` label to `打卡系统`.
- Modify: `app/src/domain/settings.ts` to add `checkinEnabled`, `setCheckinEnabled`, hydration, persistence, and mirror dispatch.
- Modify: `app/src/domain/settingsPersistence.ts` to load/save `checkinEnabled`.
- Modify: `app/src/domain/userPreferences.ts` to include `settings.checkinEnabled` in local/cloud archive snapshots.
- Modify: `app/src/domain/cloudAccountData.test.ts` and `app/src/domain/userPreferencesPersistence.test.ts` through expectations driven by `userPreferences.ts`.
- Modify: `app/src/domain/bridge/protocol.ts`, `client.ts`, and `host.ts` so snapshots and dispatch include `checkinEnabled`.
- Modify: `app/src/domain/checkinWindow.ts` so startup auto-open respects `checkinEnabled`.
- Modify: `app/src/App.tsx` so focus-end check-in integration respects `checkinEnabled`.
- Modify: `app/src/ui/SettingsPanel.tsx` to render the `打卡系统` toggle in the global tab.
- Modify tests beside each changed module.

## Task 1: Pencil Source

**Files:**
- Modify: `AUI/PUI.pen`

- [ ] **Step 1: Read the existing global settings row**

Use Pencil MCP:

```json
{"filePath":"/Users/xpy/.codex/worktrees/b94c/CPA_V2/AUI/PUI.pen","nodeIds":["Pdj9C"],"readDepth":3}
```

Expected: `Pdj9C` contains `gspDailyPlan` with label text currently reading `每日计划`.

- [ ] **Step 2: Rename the row label**

Run a Pencil MCP `batch_design` update:

```js
U("JPdqO",{content:"打卡系统",name:"gsp-checkin-enabled-label"})
U("JZWq5",{name:"gspCheckinEnabled"})
U("BuKhS",{name:"gsp-checkin-enabled-toggle"})
```

Expected: the global settings panel still has the row between `gspAutostart` and `gspAutoUpdate`, with the label changed to `打卡系统`.

- [ ] **Step 3: Verify the Pencil change**

Use Pencil MCP `batch_get` for `Pdj9C` with `readDepth:3`.

Expected: `gspCheckinEnabled` appears and the visible label is `打卡系统`.

## Task 2: Settings Domain and Persistence

**Files:**
- Modify: `app/src/domain/settings.ts`
- Modify: `app/src/domain/settings.test.ts`
- Modify: `app/src/domain/settingsPersistence.ts`
- Modify: `app/src/domain/settingsPersistence.test.ts`

- [ ] **Step 1: Write failing settings tests**

Add tests in `app/src/domain/settings.test.ts`:

```ts
it('defaults checkinEnabled to true', () => {
    expect(useSettingsStore.getState().checkinEnabled).toBe(true);

    const settingsWindowStore = createSettingsStore({ isSettingsWindow: true });
    expect(settingsWindowStore.getState().checkinEnabled).toBe(true);
});

it('hydrates checkinEnabled from persisted settings', () => {
    useSettingsStore.getState().hydrateSettings({
        uiScale: 1.25,
        autostartEnabled: false,
        checkinEnabled: false,
    });

    expect(useSettingsStore.getState().checkinEnabled).toBe(false);
});

it('defaults missing persisted checkinEnabled to true during hydration', () => {
    useSettingsStore.setState({ checkinEnabled: false });

    useSettingsStore.getState().hydrateSettings({ uiScale: 1.25 });

    expect(useSettingsStore.getState().checkinEnabled).toBe(true);
});

it('setCheckinEnabled updates state and persists confirmed value', () => {
    useSettingsStore.setState({
        committedUiScale: 1.5,
        autostartEnabled: true,
        checkinEnabled: true,
    });

    useSettingsStore.getState().setCheckinEnabled(false);

    expect(useSettingsStore.getState().checkinEnabled).toBe(false);
    expect(settingsMocks.savePersistedSettings).toHaveBeenCalledWith({
        uiScale: 1.5,
        autostartEnabled: true,
        checkinEnabled: false,
    });
});

it('setCheckinEnabled dispatches instead of mutating local state', () => {
    const spy = vi.spyOn(dispatchMod, 'dispatch').mockResolvedValue();
    const store = createSettingsStore({ isSettingsWindow: true });

    store.getState().setCheckinEnabled(false);

    expect(store.getState().checkinEnabled).toBe(true);
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({
        v: BRIDGE_VERSION,
        store: 'settings',
        action: 'setCheckinEnabled',
        args: [false],
    }));
    spy.mockRestore();
});
```

- [ ] **Step 2: Write failing persistence tests**

Update `app/src/domain/settingsPersistence.test.ts`:

```ts
it('loads persisted v1 settings including checkinEnabled', async () => {
    store.get.mockResolvedValue({
        v: 1,
        uiScale: 1.75,
        autostartEnabled: true,
        checkinEnabled: false,
    });
    const { loadPersistedSettings } = await import('./settingsPersistence');

    await expect(loadPersistedSettings()).resolves.toEqual({
        uiScale: 1.75,
        autostartEnabled: true,
        checkinEnabled: false,
    });
});

it('defaults missing checkinEnabled to true for older v1 settings', async () => {
    store.get.mockResolvedValue({ v: 1, uiScale: 1.75 });
    const { loadPersistedSettings } = await import('./settingsPersistence');

    await expect(loadPersistedSettings()).resolves.toEqual({
        uiScale: 1.75,
        autostartEnabled: false,
        checkinEnabled: true,
    });
});
```

Update the existing save expectation to include `checkinEnabled`.

- [ ] **Step 3: Run tests and confirm failure**

Run:

```bash
cd app && npx vitest run src/domain/settings.test.ts src/domain/settingsPersistence.test.ts
```

Expected: failures mention missing `checkinEnabled` and missing `setCheckinEnabled`.

- [ ] **Step 4: Implement settings and persistence**

In `settings.ts`, add:

```ts
checkinEnabled: boolean;
```

to `SettingsState`, add it to `PersistedSettingsSnapshot`, and add:

```ts
setCheckinEnabled: (enabled: boolean) => void;
```

to actions. Include `checkinEnabled` in `persistedSnapshot`, all initial states, and `hydrateSettings` with `snapshot.checkinEnabled ?? true`.

In settings-window mode:

```ts
setCheckinEnabled: (enabled) => {
    void dispatch({
        v: BRIDGE_VERSION,
        store: 'settings',
        action: 'setCheckinEnabled',
        args: [enabled],
    });
},
```

In main-window mode:

```ts
setCheckinEnabled: (checkinEnabled) => {
    set({ checkinEnabled });
    void savePersistedSettings(persistedSnapshot(get()));
},
```

In `settingsPersistence.ts`, add `checkinEnabled: boolean` to `PersistedSettings`, `checkinEnabled?: boolean` to `PersistedSettingsV1`, validate it as boolean when present, default missing values to `true`, and save it in the store payload.

- [ ] **Step 5: Run focused tests**

Run:

```bash
cd app && npx vitest run src/domain/settings.test.ts src/domain/settingsPersistence.test.ts
```

Expected: both files pass.

## Task 3: User Preferences and Cloud Snapshot

**Files:**
- Modify: `app/src/domain/userPreferences.ts`
- Modify: `app/src/domain/userPreferencesPersistence.test.ts`
- Modify: `app/src/domain/cloudAccountData.test.ts`
- Modify: `app/src/App.test.tsx`

- [ ] **Step 1: Write failing preference tests**

Update user-preference expectations so settings snapshots include:

```ts
settings: {
    uiScale: 1.25,
    autostartEnabled: true,
    checkinEnabled: false,
}
```

Add a normalization assertion:

```ts
expect(normalized?.settings.checkinEnabled).toBe(false);
```

where the malformed snapshot test already checks `settings.uiScale`.

Update cloud account expectations to include `checkinEnabled`.

- [ ] **Step 2: Run tests and confirm failure**

Run:

```bash
cd app && npx vitest run src/domain/userPreferencesPersistence.test.ts src/domain/cloudAccountData.test.ts src/App.test.tsx
```

Expected: failures mention missing `checkinEnabled` in settings snapshots.

- [ ] **Step 3: Implement preference snapshot support**

In `UserPreferencesSnapshot.settings`, add:

```ts
checkinEnabled: boolean;
```

In `defaultUserPreferencesSnapshot()`, use:

```ts
checkinEnabled: true,
```

In `buildUserPreferencesSnapshot`, include `settings.checkinEnabled`. In `normalizeSettings`, default missing or malformed values to `fallback.checkinEnabled`:

```ts
checkinEnabled: typeof value.checkinEnabled === 'boolean'
    ? value.checkinEnabled
    : fallback.checkinEnabled,
```

Existing `hydrateSettings(snapshot.settings)` will apply the field after Task 2.

- [ ] **Step 4: Update startup test fixtures**

Add `checkinEnabled: true` or `false` to all settings snapshots in `app/src/App.test.tsx` so tests express the expected default explicitly.

- [ ] **Step 5: Run focused tests**

Run:

```bash
cd app && npx vitest run src/domain/userPreferencesPersistence.test.ts src/domain/cloudAccountData.test.ts src/App.test.tsx
```

Expected: all three files pass.

## Task 4: Bridge and Settings UI

**Files:**
- Modify: `app/src/domain/bridge/protocol.ts`
- Modify: `app/src/domain/bridge/client.ts`
- Modify: `app/src/domain/bridge/host.ts`
- Modify: `app/src/domain/bridge/protocol.test.ts`
- Modify: `app/src/domain/bridge/client.test.ts`
- Modify: `app/src/domain/bridge/host.test.ts`
- Modify: `app/src/ui/SettingsPanel.tsx`
- Modify: `app/src/ui/SettingsPanel.test.tsx`

- [ ] **Step 1: Write failing bridge tests**

Add `checkinEnabled` to sample bridge settings objects and assert:

```ts
expect(snap.settings.checkinEnabled).toBe(false);
```

Add a dispatch payload fixture:

```ts
{ v: 1, store: 'settings', action: 'setCheckinEnabled', args: [false] }
```

Add a host routing test:

```ts
it('routes checkin enabled setting to the authoritative settings store', () => {
    useSettingsStore.setState({ checkinEnabled: true });

    applyDispatch({
        v: BRIDGE_VERSION,
        store: 'settings',
        action: 'setCheckinEnabled',
        args: [false],
    });

    expect(useSettingsStore.getState().checkinEnabled).toBe(false);
});
```

Update `settingsSig` tests so changing `checkinEnabled` changes the signature.

- [ ] **Step 2: Write failing UI test**

In `SettingsPanel.test.tsx`, add:

```ts
it('renders the check-in system toggle in global settings', async () => {
    useSettingsStore.setState({
        activeTab: 'global',
        checkinEnabled: true,
    });
    const setCheckinEnabled = vi.fn((enabled: boolean) => {
        useSettingsStore.setState({ checkinEnabled: enabled });
    });
    useSettingsStore.setState({ setCheckinEnabled });

    render(<SettingsPanel />);
    const toggle = screen.getByRole('switch', { name: '打卡系统' });

    expect(toggle).toBeChecked();
    await act(async () => {
        fireEvent.click(toggle);
    });
    expect(setCheckinEnabled).toHaveBeenCalledWith(false);
});
```

- [ ] **Step 3: Run tests and confirm failure**

Run:

```bash
cd app && npx vitest run src/domain/bridge/protocol.test.ts src/domain/bridge/client.test.ts src/domain/bridge/host.test.ts src/ui/SettingsPanel.test.tsx
```

Expected: failures mention missing snapshot field, dispatch action, signature field, and UI toggle.

- [ ] **Step 4: Implement bridge support**

In `BridgeSnapshot.settings`, add `checkinEnabled: boolean`.

In `DispatchPayload`, add:

```ts
| { v: typeof BRIDGE_VERSION; store: 'settings'; action: 'setCheckinEnabled'; args: [boolean] }
```

In `client.ts`, hydrate mirrored settings with `checkinEnabled`.

In `host.ts`, add `checkinEnabled` to `buildSnapshot`, route `setCheckinEnabled`, and include it in `settingsSig`.

- [ ] **Step 5: Implement UI toggle**

In `GlobalTab`, insert this card after `开机自启动` and before `<AppUpdateSettingsRow />`:

```tsx
<div className="card">
    <div className="card-row">
        <span className="card-label">打卡系统</span>
        <Toggle
            checked={settings.checkinEnabled}
            onChange={settings.setCheckinEnabled}
            ariaLabel="打卡系统"
        />
    </div>
</div>
```

- [ ] **Step 6: Run focused tests**

Run:

```bash
cd app && npx vitest run src/domain/bridge/protocol.test.ts src/domain/bridge/client.test.ts src/domain/bridge/host.test.ts src/ui/SettingsPanel.test.tsx
```

Expected: all four files pass.

## Task 5: Check-in Flow Gating

**Files:**
- Modify: `app/src/domain/checkinWindow.ts`
- Modify: `app/src/App.tsx`
- Modify: `app/src/checkinPomodoroIntegration.test.tsx`
- Modify: `app/src/domain/checkinWindow.test.ts`

- [ ] **Step 1: Write failing gating tests**

In `checkinWindow.test.ts`, assert that `useCheckinWindowController` does not invoke `open_today_checkin_window` when `useSettingsStore.getState().checkinEnabled` is false.

In `checkinPomodoroIntegration.test.tsx`, add:

```ts
it('does not write check-in records or open check-in panel when check-in is disabled', async () => {
    useSettingsStore.setState({ checkinEnabled: false });
    render(<App />);
    await waitForStartupHydration();

    act(() => {
        usePomodoroStore.getState().applyFocusEndForTest(101);
    });

    expect(useCheckinStore.getState().dailyRecords).toEqual({});
    expect(openTodayCheckinWindowMock).not.toHaveBeenCalled();
});
```

Use the existing test helpers in that file for the focus-end trigger name and startup wait; keep the assertion shape above.

- [ ] **Step 2: Run tests and confirm failure**

Run:

```bash
cd app && npx vitest run src/domain/checkinWindow.test.ts src/checkinPomodoroIntegration.test.tsx
```

Expected: disabled check-in still opens or writes until implementation is added.

- [ ] **Step 3: Implement startup and Pomodoro gating**

In `checkinWindow.ts`, import `useSettingsStore` and subscribe to `checkinEnabled` in the controller:

```ts
export function useCheckinWindowController(): void {
    const checkinEnabled = useSettingsStore((s) => s.checkinEnabled);
    useEffect(() => {
        if (!checkinEnabled) return;
        void invoke('open_today_checkin_window').catch((error) => {
            useCheckinStore.getState().setLastError(String(error));
        });
    }, [checkinEnabled]);
}
```

In `App.tsx`, check `useSettingsStore.getState().checkinEnabled` before calling check-in completion or `openTodayCheckinWindow()` in the focus-end effect.

- [ ] **Step 4: Run focused tests**

Run:

```bash
cd app && npx vitest run src/domain/checkinWindow.test.ts src/checkinPomodoroIntegration.test.tsx
```

Expected: both pass.

## Task 6: Final Verification

**Files:**
- All modified files

- [ ] **Step 1: Run full frontend tests**

Run:

```bash
cd app && npm test
```

Expected: all Vitest suites pass.

- [ ] **Step 2: Run production build**

Run:

```bash
cd app && npm run build
```

Expected: TypeScript and Vite build pass.

- [ ] **Step 3: Check git status and diff**

Run:

```bash
git status --short
git diff --stat
```

Expected: only intended Pencil, app source/test, spec, and plan files are modified.

- [ ] **Step 4: Smoke launch**

Run:

```bash
./start.sh
```

Expected: the app starts. Open Settings, switch to `全局`, and confirm `打卡系统` appears between `开机自启动` and update settings.
