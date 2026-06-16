# Settings Plan Panel And Pet Removal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sync the new Pencil settings design by adding a persisted `计划面板` visibility toggle and removing the old Settings pet tab.

**Architecture:** `planPanelEnabled` belongs to the settings domain and mirrors through the same persistence, user-preference, and bridge paths as `checkinEnabled`. Settings UI maps Pencil `vnYnS` to three tabs and Pencil `HnSHL` to the global row order, while the check-in window controller treats `checkinEnabled && planPanelEnabled` as the Today panel open guard.

**Tech Stack:** React, TypeScript, Zustand, Vitest, Testing Library, Tauri invoke mocks.

---

## File Structure

- Modify `app/src/domain/settings.ts` for the new settings field/action and pet-tab type removal.
- Modify `app/src/domain/settingsPersistence.ts` for load/save validation.
- Modify `app/src/domain/userPreferences.ts` for local/cloud archive snapshots.
- Modify `app/src/domain/bridge/protocol.ts`, `app/src/domain/bridge/client.ts`, and `app/src/domain/bridge/host.ts` for mirrored windows.
- Modify `app/src/domain/checkinWindow.ts` for Today panel visibility.
- Modify `app/src/ui/SettingsPanel.tsx` for the three-tab sidebar and `计划面板` row.
- Modify focused tests in `app/src/domain/*.test.ts`, `app/src/domain/bridge/*.test.ts`, `app/src/ui/SettingsPanel.test.tsx`, and `app/src/App.test.tsx` only where existing fixtures require the new setting.

### Task 1: Settings Domain And Persistence Tests

**Files:**
- Modify: `app/src/domain/settings.test.ts`
- Modify: `app/src/domain/settingsPersistence.test.ts`

- [ ] **Step 1: Write failing settings-store tests**

Add assertions beside the existing `checkinEnabled` tests:

```ts
it('defaults planPanelEnabled to true', () => {
    expect(useSettingsStore.getState().planPanelEnabled).toBe(true);
    expect(settingsWindowStore.getState().planPanelEnabled).toBe(true);
});

it('hydrates planPanelEnabled from persisted settings', () => {
    useSettingsStore.getState().hydrateSettings({
        uiScale: 1,
        autostartEnabled: false,
        checkinEnabled: true,
        planPanelEnabled: false,
    });

    expect(useSettingsStore.getState().planPanelEnabled).toBe(false);
});

it('defaults missing persisted planPanelEnabled to true during hydration', () => {
    useSettingsStore.setState({ planPanelEnabled: false });

    useSettingsStore.getState().hydrateSettings({ uiScale: 1, autostartEnabled: false, checkinEnabled: true });

    expect(useSettingsStore.getState().planPanelEnabled).toBe(true);
});

it('persists planPanelEnabled changes', () => {
    useSettingsStore.getState().setPlanPanelEnabled(false);

    expect(savePersistedSettings).toHaveBeenCalledWith(expect.objectContaining({
        planPanelEnabled: false,
    }));
});
```

- [ ] **Step 2: Write failing persistence tests**

Add cases to `settingsPersistence.test.ts`:

```ts
it('loads persisted planPanelEnabled', async () => {
    storeData.settings = {
        v: 1,
        uiScale: 1.25,
        autostartEnabled: true,
        checkinEnabled: true,
        planPanelEnabled: false,
    };

    await expect(loadPersistedSettings()).resolves.toEqual({
        uiScale: 1.25,
        autostartEnabled: true,
        checkinEnabled: true,
        planPanelEnabled: false,
    });
});

it('defaults missing planPanelEnabled for older v1 settings', async () => {
    storeData.settings = { v: 1, uiScale: 1 };

    await expect(loadPersistedSettings()).resolves.toMatchObject({
        planPanelEnabled: true,
    });
});
```

- [ ] **Step 3: Run red tests**

Run:

```bash
cd app && npx vitest run src/domain/settings.test.ts src/domain/settingsPersistence.test.ts
```

Expected: FAIL because `planPanelEnabled` and `setPlanPanelEnabled` do not exist.

- [ ] **Step 4: Implement settings state and persistence**

In `settings.ts`, remove `pet` from `SettingsTab`, add `planPanelEnabled` to state/snapshot/actions, and persist it:

```ts
export type SettingsTab = 'pomodoro' | 'online' | 'global';

export interface SettingsState {
    activeTab: SettingsTab;
    uiScale: number;
    committedUiScale: number;
    autostartEnabled: boolean;
    checkinEnabled: boolean;
    planPanelEnabled: boolean;
    dangerousChange: DangerousChange | null;
}

setPlanPanelEnabled: (planPanelEnabled) => {
    set({ planPanelEnabled });
    void savePersistedSettings(persistedSnapshot(get()));
},
```

Mirror-window action:

```ts
setPlanPanelEnabled: (enabled) => {
    void dispatch({
        v: BRIDGE_VERSION,
        store: 'settings',
        action: 'setPlanPanelEnabled',
        args: [enabled],
    } as Parameters<typeof dispatch>[0]);
},
```

In `settingsPersistence.ts`, include:

```ts
planPanelEnabled: boolean;
planPanelEnabled?: boolean;
candidate.planPanelEnabled === undefined || typeof candidate.planPanelEnabled === 'boolean'
planPanelEnabled: value.planPanelEnabled ?? true
planPanelEnabled: settings.planPanelEnabled
```

- [ ] **Step 5: Run green tests**

Run:

```bash
cd app && npx vitest run src/domain/settings.test.ts src/domain/settingsPersistence.test.ts
```

Expected: PASS.

### Task 2: User Preferences And Bridge

**Files:**
- Modify: `app/src/domain/userPreferences.ts`
- Modify: `app/src/domain/userPreferencesPersistence.test.ts`
- Modify: `app/src/domain/cloudAccountData.test.ts`
- Modify: `app/src/domain/bridge/protocol.ts`
- Modify: `app/src/domain/bridge/client.ts`
- Modify: `app/src/domain/bridge/host.ts`
- Modify: `app/src/domain/bridge/protocol.test.ts`
- Modify: `app/src/domain/bridge/client.test.ts`
- Modify: `app/src/domain/bridge/host.test.ts`

- [ ] **Step 1: Write failing snapshot and bridge expectations**

Add `planPanelEnabled` to settings fixtures and assert it is preserved:

```ts
expect(snapshot.settings).toEqual({
    uiScale: 1.25,
    autostartEnabled: true,
    checkinEnabled: false,
    planPanelEnabled: false,
});
```

Bridge client expectation:

```ts
expect(useSettingsStore.getState().planPanelEnabled).toBe(false);
```

Host signature expectation:

```ts
const before = settingsSig({ ...useSettingsStore.getState(), planPanelEnabled: true });
const after = settingsSig({ ...useSettingsStore.getState(), planPanelEnabled: false });
expect(after).not.toBe(before);
```

- [ ] **Step 2: Run red tests**

Run:

```bash
cd app && npx vitest run src/domain/userPreferencesPersistence.test.ts src/domain/cloudAccountData.test.ts src/domain/bridge/protocol.test.ts src/domain/bridge/client.test.ts src/domain/bridge/host.test.ts
```

Expected: FAIL with missing `planPanelEnabled` in snapshots/fixtures.

- [ ] **Step 3: Implement snapshot and bridge plumbing**

In `userPreferences.ts`, add:

```ts
settings: {
    uiScale: number;
    autostartEnabled: boolean;
    checkinEnabled: boolean;
    planPanelEnabled: boolean;
};
```

Default/build/normalize:

```ts
planPanelEnabled: true,
planPanelEnabled: settings.planPanelEnabled,
planPanelEnabled: typeof value.planPanelEnabled === 'boolean'
    ? value.planPanelEnabled
    : fallback.planPanelEnabled,
```

In `protocol.ts`, add `planPanelEnabled` to `BridgeSnapshot.settings` and include `setPlanPanelEnabled` in the boolean settings dispatch union:

```ts
| { v: typeof BRIDGE_VERSION; store: 'settings'; action: 'setAutostartEnabled' | 'setCheckinEnabled' | 'setPlanPanelEnabled'; args: [boolean] }
```

In `client.ts`, `host.ts`, and `settingsSig`, pass the field through:

```ts
planPanelEnabled: snap.settings.planPanelEnabled,
planPanelEnabled: s.planPanelEnabled,
s.planPanelEnabled,
```

- [ ] **Step 4: Run green tests**

Run:

```bash
cd app && npx vitest run src/domain/userPreferencesPersistence.test.ts src/domain/cloudAccountData.test.ts src/domain/bridge/protocol.test.ts src/domain/bridge/client.test.ts src/domain/bridge/host.test.ts
```

Expected: PASS.

### Task 3: Settings Panel UI

**Files:**
- Modify: `app/src/ui/SettingsPanel.tsx`
- Modify: `app/src/ui/SettingsPanel.test.tsx`
- Modify: `app/src/DevAlignApp.tsx`

- [ ] **Step 1: Write failing UI tests**

Update the global order test to include `计划面板`:

```ts
const checkin = screen.getByText('打卡系统');
const planPanel = screen.getByText('计划面板');
const autoUpdate = screen.getByText('自动下载并安装更新');

expect(checkin.compareDocumentPosition(planPanel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
expect(planPanel.compareDocumentPosition(autoUpdate) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
```

Add a toggle route test:

```ts
it('routes plan panel toggles to the settings store action', () => {
    const setPlanPanelEnabled = vi.fn((enabled: boolean) => {
        useSettingsStore.setState({ planPanelEnabled: enabled });
    });
    useSettingsStore.setState({ setPlanPanelEnabled, planPanelEnabled: true });
    render(<SettingsPanel />);

    const toggle = screen.getByRole('button', { name: '计划面板' });

    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(toggle);
    expect(setPlanPanelEnabled).toHaveBeenCalledWith(false);
});
```

Replace the old PetTab parity test with:

```ts
it('does not render the removed pet settings tab', () => {
    render(<SettingsPanel />);

    expect(screen.queryByRole('button', { name: '宠物' })).toBeNull();
    expect(screen.queryByText('桌宠形态')).toBeNull();
});
```

- [ ] **Step 2: Run red test**

Run:

```bash
cd app && npx vitest run src/ui/SettingsPanel.test.tsx
```

Expected: FAIL because the row does not exist and the old pet UI still renders.

- [ ] **Step 3: Implement UI mapping**

Remove the pet tab/render branch/PetTab function:

```ts
const TABS: Array<{ id: SettingsTab; label: string }> = [
    { id: 'pomodoro', label: '番茄钟' },
    { id: 'online', label: '联机' },
    { id: 'global', label: '全局' },
];
```

Insert the new row after `打卡系统`:

```tsx
<div className="card">
    <div className="card-row">
        <span className="card-label">计划面板</span>
        <Toggle
            checked={settings.planPanelEnabled}
            onChange={settings.setPlanPanelEnabled}
            ariaLabel="计划面板"
        />
    </div>
</div>
```

Update `DevAlignApp.tsx` tab options to remove `{ id: 'pet', label: '宠物' }`.

- [ ] **Step 4: Run green test**

Run:

```bash
cd app && npx vitest run src/ui/SettingsPanel.test.tsx
```

Expected: PASS.

### Task 4: Check-In Window Visibility

**Files:**
- Modify: `app/src/domain/checkinWindow.ts`
- Modify: `app/src/domain/checkinWindow.test.tsx`

- [ ] **Step 1: Write failing visibility tests**

Add cases:

```ts
it('does not open the today checkin window when the plan panel is disabled', async () => {
    useSettingsStore.setState({ checkinEnabled: true, planPanelEnabled: false });

    await openTodayCheckinWindow();

    expect(invoke).not.toHaveBeenCalledWith('open_today_checkin_window');
});

it('closes only the today checkin window when plan panel visibility is disabled', async () => {
    useSettingsStore.setState({ checkinEnabled: true, planPanelEnabled: true });
    const { rerender } = render(<Harness enabled />);

    useSettingsStore.setState({ planPanelEnabled: false });
    rerender(<Harness enabled />);

    expect(invoke).toHaveBeenCalledWith('close_today_checkin_window');
    expect(invoke).not.toHaveBeenCalledWith('close_checkin_editor_window');
});
```

- [ ] **Step 2: Run red test**

Run:

```bash
cd app && npx vitest run src/domain/checkinWindow.test.tsx
```

Expected: FAIL because `planPanelEnabled` is not checked.

- [ ] **Step 3: Implement visibility guards**

Use both settings in the controller:

```ts
const checkinEnabled = useSettingsStore((s) => s.checkinEnabled);
const planPanelEnabled = useSettingsStore((s) => s.planPanelEnabled);

if (!checkinEnabled) {
    void closeCheckinWindows();
    return;
}
if (!planPanelEnabled) {
    void closeTodayCheckinWindow();
    return;
}
```

Add a helper:

```ts
export async function closeTodayCheckinWindow(): Promise<void> {
    try {
        await invoke('close_today_checkin_window');
    } catch (error) {
        useCheckinStore.getState().setLastError(String(error));
    }
}
```

Guard explicit opening:

```ts
const settings = useSettingsStore.getState();
if (!settings.checkinEnabled || !settings.planPanelEnabled) return;
```

- [ ] **Step 4: Run green test**

Run:

```bash
cd app && npx vitest run src/domain/checkinWindow.test.tsx
```

Expected: PASS.

### Task 5: Fixture Sweep And Verification

**Files:**
- Modify: `app/src/App.test.tsx`
- Modify: any test fixture that now requires `planPanelEnabled`

- [ ] **Step 1: Update TypeScript fixtures**

Where a full settings snapshot is constructed, include:

```ts
settings: {
    uiScale: 1,
    autostartEnabled: false,
    checkinEnabled: true,
    planPanelEnabled: true,
}
```

- [ ] **Step 2: Run focused suite**

Run:

```bash
cd app && npx vitest run src/domain/settings.test.ts src/domain/settingsPersistence.test.ts src/domain/userPreferencesPersistence.test.ts src/domain/cloudAccountData.test.ts src/domain/bridge/protocol.test.ts src/domain/bridge/client.test.ts src/domain/bridge/host.test.ts src/domain/checkinWindow.test.tsx src/ui/SettingsPanel.test.tsx src/App.test.tsx
```

Expected: PASS.

- [ ] **Step 3: Run build**

Run:

```bash
cd app && npm run build
```

Expected: TypeScript and Vite build succeed.

- [ ] **Step 4: Commit scoped implementation**

Run:

```bash
git status --short
git add app/src/domain/settings.ts app/src/domain/settings.test.ts app/src/domain/settingsPersistence.ts app/src/domain/settingsPersistence.test.ts app/src/domain/userPreferences.ts app/src/domain/userPreferencesPersistence.test.ts app/src/domain/cloudAccountData.test.ts app/src/domain/bridge/protocol.ts app/src/domain/bridge/protocol.test.ts app/src/domain/bridge/client.ts app/src/domain/bridge/client.test.ts app/src/domain/bridge/host.ts app/src/domain/bridge/host.test.ts app/src/domain/checkinWindow.ts app/src/domain/checkinWindow.test.tsx app/src/ui/SettingsPanel.tsx app/src/ui/SettingsPanel.test.tsx app/src/DevAlignApp.tsx app/src/App.test.tsx
git commit -m "feat: add plan panel visibility setting"
```

Expected: commit contains only scoped implementation and tests.

## Plan Self-Review

- Spec coverage: every requirement in the supplemental spec maps to Tasks 1-5.
- Placeholder scan: no unresolved placeholders.
- Type consistency: the field name is consistently `planPanelEnabled`, and the removed settings tab union is consistently `SettingsTab = 'pomodoro' | 'online' | 'global'`.
