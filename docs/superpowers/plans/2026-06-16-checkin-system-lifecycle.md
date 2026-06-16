# Check-in System Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the global `打卡系统` switch fully start and stop the check-in subsystem, unloading all check-in UI while disabled and reinitializing UI on enable without deleting user data.

**Architecture:** Keep `settings.checkinEnabled` as the lifecycle source of truth. Native check-in mirror windows are created hidden; React mirror apps render their panel components only when bridge-ready and enabled. The main app controller opens/closes the windows on lifecycle changes, while Pomodoro focus-end raises the today panel only when enabled.

**Tech Stack:** React 19, TypeScript, Zustand stores, Tauri 2 commands, Vitest/jsdom.

---

## Files

- Modify: `app/src-tauri/src/lib.rs` for hidden native setup and raise command behavior.
- Modify: `app/src/App.tsx` for startup open and Pomodoro raise behavior.
- Modify: `app/src/domain/checkinWindow.ts` for helper functions and lifecycle controller.
- Modify: `app/src/TodayCheckinApp.tsx` to unmount the today panel when disabled.
- Modify: `app/src/CheckinEditorApp.tsx` to unmount the editor panel when disabled.
- Modify tests beside changed modules:
  - `app/src/checkinWindowConfig.test.ts`
  - `app/src/domain/checkinWindow.test.tsx`
  - `app/src/checkinPomodoroIntegration.test.tsx`
  - `app/src/TodayCheckinApp.test.tsx`
  - `app/src/CheckinEditorApp.test.tsx`
  - `app/src/App.test.tsx`

## Task 1: Native Window Setup

**Files:**
- Modify: `app/src-tauri/src/lib.rs`
- Modify: `app/src/checkinWindowConfig.test.ts`

- [ ] **Step 1: Write failing config expectations**

In `app/src/checkinWindowConfig.test.ts`, in the check-in window configuration test, assert:

```ts
const todayBuilder = rustFunction(source, 'build_today_checkin_window');
expect(todayBuilder?.body).toMatch(/\.visible\(false\)/);
const todayRaise = rustFunction(source, 'raise_today_checkin_window');
expect(todayRaise?.body).toMatch(/focus_existing_window\(app,\s*"today-checkin"\)/);
```

- [ ] **Step 2: Run red test**

Run:

```bash
cd app && npx vitest run src/checkinWindowConfig.test.ts --testNamePattern "does not pin"
```

Expected: failure because `build_today_checkin_window` currently uses `.visible(true)`.

- [ ] **Step 3: Implement native hidden setup**

In `app/src-tauri/src/lib.rs`, keep the function named `build_today_checkin_window`, but change the builder to:

```rust
.skip_taskbar(true)
.visible(false)
.always_on_top(false)
```

Keep:

```rust
async fn raise_today_checkin_window(app: tauri::AppHandle) -> Result<(), String> {
    focus_existing_window(app, "today-checkin")
}
```

- [ ] **Step 4: Run green test**

Run:

```bash
cd app && npx vitest run src/checkinWindowConfig.test.ts
```

Expected: all tests in the file pass.

## Task 2: Mirror App Unmount Gates

**Files:**
- Modify: `app/src/TodayCheckinApp.tsx`
- Modify: `app/src/CheckinEditorApp.tsx`
- Modify: `app/src/TodayCheckinApp.test.tsx`
- Modify: `app/src/CheckinEditorApp.test.tsx`

- [ ] **Step 1: Write failing today-panel test**

In `app/src/TodayCheckinApp.test.tsx`, add a test where `useBridgeClient()` returns `true` and `useSettingsStore` has `checkinEnabled=false`:

```ts
it('unmounts the today check-in panel when the check-in system is disabled', () => {
    bridgeReady = true;
    useSettingsStore.setState({ checkinEnabled: false, planPanelEnabled: true });

    render(<TodayCheckinApp />);

    expect(screen.queryByTestId('today-checkin-panel')).toBeNull();
});
```

- [ ] **Step 2: Write failing editor-panel test**

In `app/src/CheckinEditorApp.test.tsx`, add:

```ts
it('unmounts the editor panel when the check-in system is disabled', () => {
    bridgeReady = true;
    useSettingsStore.setState({ checkinEnabled: false });

    render(<CheckinEditorApp />);

    expect(screen.queryByTestId('checkin-plan-editor-panel')).toBeNull();
});
```

- [ ] **Step 3: Run red tests**

Run:

```bash
cd app && npx vitest run src/TodayCheckinApp.test.tsx src/CheckinEditorApp.test.tsx
```

Expected: the new tests fail because the panels render whenever the bridge is ready.

- [ ] **Step 4: Implement unmount gates**

In `TodayCheckinApp.tsx`:

```tsx
const checkinEnabled = useSettingsStore((s) => s.checkinEnabled);
const planPanelEnabled = useSettingsStore((s) => s.planPanelEnabled);
const shouldRenderPanel = bridgeReady && checkinEnabled && planPanelEnabled;

return (
    <div className="today-checkin-window-root" style={{ '--app-ui-scale': String(uiScale) } as CSSProperties}>
        {shouldRenderPanel ? <TodayCheckinPanel /> : null}
    </div>
);
```

In `CheckinEditorApp.tsx`:

```tsx
const checkinEnabled = useSettingsStore((s) => s.checkinEnabled);
const shouldRenderPanel = bridgeReady && checkinEnabled;
```

Render `CheckinPlanEditorPanel` only when `shouldRenderPanel`.

- [ ] **Step 5: Run green tests**

Run:

```bash
cd app && npx vitest run src/TodayCheckinApp.test.tsx src/CheckinEditorApp.test.tsx
```

Expected: both test files pass.

## Task 3: Main Lifecycle Controller

**Files:**
- Modify: `app/src/domain/checkinWindow.ts`
- Modify: `app/src/domain/checkinWindow.test.tsx`
- Modify: `app/src/App.tsx`
- Modify: `app/src/App.test.tsx`
- Modify: `app/src/checkinPomodoroIntegration.test.tsx`

- [ ] **Step 1: Write lifecycle controller tests**

In `app/src/domain/checkinWindow.test.tsx`, ensure:

```ts
it('closes both check-in windows when check-in is disabled after being enabled', async () => {
    render(<CheckinWindowControllerHost />);
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('open_today_checkin_window'));
    invokeMock.mockClear();

    useSettingsStore.setState({ checkinEnabled: false });

    await waitFor(() => {
        expect(invokeMock).toHaveBeenCalledWith('close_today_checkin_window');
        expect(invokeMock).toHaveBeenCalledWith('close_checkin_editor_window');
    });
});

it('reopens today check-in when check-in is re-enabled and plan panel is enabled', async () => {
    useSettingsStore.setState({ checkinEnabled: false, planPanelEnabled: true });
    render(<CheckinWindowControllerHost />);
    invokeMock.mockClear();

    useSettingsStore.setState({ checkinEnabled: true });

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('open_today_checkin_window'));
});
```

- [ ] **Step 2: Write App startup test**

In `app/src/App.test.tsx`, ensure a unified preferences snapshot with `checkinEnabled=true` and missing `planPanelEnabled` defaults to opening `today-checkin` after startup:

```ts
await waitFor(() => {
    expect(invokeMock).toHaveBeenCalledWith('open_today_checkin_window');
});
```

- [ ] **Step 3: Write Pomodoro raise test**

In `app/src/checkinPomodoroIntegration.test.tsx`, assert natural focus timer end calls `raiseTodayCheckinWindow` and not `openTodayCheckinWindow`:

```ts
expect(raiseTodayCheckinWindowMock).toHaveBeenCalledTimes(1);
expect(openTodayCheckinWindowMock).not.toHaveBeenCalled();
```

- [ ] **Step 4: Run red tests**

Run:

```bash
cd app && npx vitest run src/domain/checkinWindow.test.tsx src/App.test.tsx src/checkinPomodoroIntegration.test.tsx
```

Expected: any missing lifecycle behavior fails.

- [ ] **Step 5: Implement lifecycle behavior**

Keep `useCheckinWindowController` as:

```ts
if (!enabled) return;
if (!checkinEnabled) {
    void closeCheckinWindows();
    return;
}
if (!planPanelEnabled) {
    void closeTodayCheckinWindow();
    return;
}
void invoke('open_today_checkin_window').catch((error) => {
    useCheckinStore.getState().setLastError(String(error));
});
```

Keep helpers:

```ts
export async function openTodayCheckinWindow(): Promise<void> {
    const settings = useSettingsStore.getState();
    if (!settings.checkinEnabled || !settings.planPanelEnabled) return;
    await invoke('open_today_checkin_window');
}

export async function raiseTodayCheckinWindow(): Promise<void> {
    const settings = useSettingsStore.getState();
    if (!settings.checkinEnabled || !settings.planPanelEnabled) return;
    await invoke('raise_today_checkin_window');
}
```

In `App.tsx`, after local hydration:

```ts
setLocalHydrated(true);
void openTodayCheckinWindow().catch((error) => {
    console.warn('[checkin] open persistent panel on startup failed', error);
});
```

In the Pomodoro focus-end effect:

```ts
if (event.toPhase === 'break' && event.triggeredBy === 'timer') {
    void raiseTodayCheckinWindow().catch((error) => {
        console.warn('[checkin] raise panel on focus end failed', error);
    });
}
```

- [ ] **Step 6: Run green focused tests**

Run:

```bash
cd app && npx vitest run src/domain/checkinWindow.test.tsx src/App.test.tsx src/checkinPomodoroIntegration.test.tsx
```

Expected: all selected tests pass.

## Task 4: Verification and Commit

**Files:**
- Verify all changed files.

- [ ] **Step 1: Run focused lifecycle tests**

Run:

```bash
cd app && npx vitest run src/checkinWindowConfig.test.ts src/domain/checkinWindow.test.tsx src/checkinPomodoroIntegration.test.tsx src/TodayCheckinApp.test.tsx src/CheckinEditorApp.test.tsx src/App.test.tsx
```

Expected: all selected tests pass.

- [ ] **Step 2: Run full test suite**

Run:

```bash
cd app && npm test
```

Expected: all Vitest files pass.

- [ ] **Step 3: Run production build**

Run:

```bash
cd app && npm run build
```

Expected: `tsc && vite build` exits 0.

- [ ] **Step 4: Check whitespace**

Run:

```bash
git diff --check
```

Expected: no output.

- [ ] **Step 5: Commit implementation**

Run:

```bash
git add app/src-tauri/src/lib.rs app/src/App.tsx app/src/App.test.tsx app/src/domain/checkinWindow.ts app/src/domain/checkinWindow.test.tsx app/src/checkinPomodoroIntegration.test.tsx app/src/checkinWindowConfig.test.ts app/src/TodayCheckinApp.tsx app/src/TodayCheckinApp.test.tsx app/src/CheckinEditorApp.tsx app/src/CheckinEditorApp.test.tsx
git commit -m "fix: unload checkin ui when disabled"
```

Expected: commit contains only lifecycle implementation and tests.

## Self-Review

- Spec coverage: native hidden startup, UI unmount gates, close on disable, reopen on enable, Pomodoro raise behavior, and verification are covered.
- Placeholder scan: no TBD/TODO placeholder steps remain.
- Type consistency: helper names match existing files and new `raiseTodayCheckinWindow` / `raise_today_checkin_window` names.
