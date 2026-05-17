# Pomodoro Auto-Start Break Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Pomodoro setting that defaults break auto-start to off, updates the Pencil design first, and lets users opt into automatic break countdown after focus completion.

**Architecture:** The Pencil source of truth gets one new `pomoFooter` row before app code changes. The existing Pomodoro Zustand store remains the state owner; `applySettings` is extended to batch `autoStartBreak` with the other Pomodoro settings through the existing settings-window bridge. The timer phase transition already reads `state.autoStartBreak`, so behavior is mostly a default/value propagation change plus tests.

**Tech Stack:** Pencil MCP, React, TypeScript, Zustand, Vitest, Testing Library, native CSS.

**Spec:** `docs/superpowers/specs/2026-05-16-pomodoro-auto-start-break-design.md`

---

## File Structure

| File | Touch type | Responsibility |
|---|---|---|
| `AUI/PUI.pen` | modify through Pencil MCP only | Add the visible `自动开始休息` toggle row in the Pomodoro settings design. |
| `app/src/domain/pomodoro.test.ts` | modify | Lock default-off behavior, opt-in auto-start behavior, and accumulator regression. |
| `app/src/domain/pomodoro.ts` | modify | Change defaults to `false`; extend `applySettings` with `autoStartBreak`; preserve accumulator clearing. |
| `app/src/domain/bridge/protocol.ts` | modify | Add `autoStartBreak` to snapshots and Pomodoro dispatch args. |
| `app/src/domain/bridge/protocol.test.ts` | modify | Keep protocol type examples current. |
| `app/src/domain/bridge/host.ts` | modify | Include `autoStartBreak` in snapshots and snapshot change signature. |
| `app/src/domain/bridge/host.test.ts` | modify | Assert snapshot and dispatch carry `autoStartBreak`. |
| `app/src/domain/bridge/client.ts` | modify | Mirror `autoStartBreak` into the settings-window store. |
| `app/src/domain/bridge/client.test.ts` | modify | Assert settings mirror receives `autoStartBreak`. |
| `app/src/ui/SettingsPanel.tsx` | modify | Render the new toggle row and apply dirty state. |
| `app/src/ui/SettingsPanel.test.tsx` | modify | Assert the row exists, the obsolete `总轮次` row stays absent, and the toggle enables Apply. |

---

## Task 1: Update Pencil Source Of Truth

**Files:**
- Modify: `AUI/PUI.pen`

- [ ] **Step 1: Open the Pencil document**

Run through MCP:

```json
{
  "path": "/Users/xpy/.codex/worktrees/f882/CPA_V2/AUI/PUI.pen"
}
```

Expected: Pencil opens `/Users/xpy/.codex/worktrees/f882/CPA_V2/AUI/PUI.pen`.

- [ ] **Step 2: Read the relevant design nodes**

Run through MCP:

```json
{
  "filePath": "/Users/xpy/.codex/worktrees/f882/CPA_V2/AUI/PUI.pen",
  "nodeIds": ["gs1Tv", "JpJcn", "NGo9f"],
  "readDepth": 4,
  "resolveVariables": true
}
```

Expected:
- `gs1Tv` is `Pomodoro Settings Panel`.
- `JpJcn` is `pomoFooter`.
- `NGo9f` is `Toggle Switch`.
- `Jvg0I` remains the visible custom video row.

- [ ] **Step 3: Insert the new footer row**

Run through MCP `batch_design`:

```javascript
autoBreakRow=I("JpJcn",{type:"frame",name:"pomoAutoStartBreak",layout:"horizontal",alignItems:"center",justifyContent:"space_between",cornerRadius:16,fill:"#F6F7F8",padding:[14,16],width:"fill_container",placeholder:true})
autoBreakLeft=I(autoBreakRow,{type:"frame",name:"pomoAutoStartBreakLeft",layout:"horizontal",alignItems:"center",gap:10})
autoBreakLabel=I(autoBreakLeft,{type:"text",name:"pomoAutoStartBreakText",content:"自动开始休息",fill:"#1A1A1A",fontFamily:"MaokenAssortedSans",fontSize:14,fontWeight:"500"})
autoBreakToggle=I(autoBreakRow,{type:"ref",name:"pomoAutoStartBreakToggle",ref:"NGo9f",fill:"#E5E7EB",justifyContent:"start"})
M(autoBreakRow,"JpJcn",3)
U(autoBreakRow,{placeholder:false})
```

Expected: the row is ordered after `pomoEndAction` (`I6SsL5`) and the disabled/collapsed `pomoVideoPath` (`WSnlp`), which makes it appear before `pomoVideoCustom` (`Jvg0I`) in the visible layout. The toggle root is gray and left-aligned, so it reads as off.

- [ ] **Step 4: Verify Pencil layout**

Run through MCP:

```json
{
  "filePath": "/Users/xpy/.codex/worktrees/f882/CPA_V2/AUI/PUI.pen",
  "parentId": "gs1Tv",
  "maxDepth": 3
}
```

Expected:
- `pomoAutoStartBreak` appears under `JpJcn`.
- `pomoAutoStartBreak` is before `Jvg0I`.
- No `problems` field appears for `pomoAutoStartBreak`, its label, or its toggle.

- [ ] **Step 5: Screenshot the updated panel**

Run through MCP:

```json
{
  "filePath": "/Users/xpy/.codex/worktrees/f882/CPA_V2/AUI/PUI.pen",
  "nodeId": "gs1Tv"
}
```

Expected: screenshot shows one new normal gray row labeled `自动开始休息` with an off toggle.

- [ ] **Step 6: Commit the Pencil design change**

```bash
git status --short
git add AUI/PUI.pen
git commit -m "design: add pomodoro auto-start break toggle"
```

Expected: commit succeeds and only `AUI/PUI.pen` is staged.

---

## Task 2: Lock Pomodoro State Behavior With Tests

**Files:**
- Modify: `app/src/domain/pomodoro.test.ts`

- [ ] **Step 1: Update the test reset default**

Change the `reset()` helper to default `autoStartBreak` to `false`:

```ts
function reset() {
    usePomodoroStore.setState({
        focusDurationSeconds: 25 * 60,
        breakDurationSeconds: 5 * 60,
        totalRounds: 4,
        currentRound: 1,
        remainingSeconds: 25 * 60,
        currentPhase: 'focus',
        isRunning: false,
        isPinned: false,
        autoStartBreak: false,
        consecutiveCompletedFocus: 0,
    });
}
```

- [ ] **Step 2: Replace the first accumulator test setup with explicit opt-in**

In `autoStartBreak=true 时 phase 切换不吃掉新阶段第一秒`, update the setup call:

```ts
const store = usePomodoroStore.getState();
store.applySettings(1, 60, 4, true, true);
store.start();
```

Expected pre-implementation failure: TypeScript reports `Expected 4 arguments, but got 5`, or the runtime test fails because `applySettings` does not accept the new value yet.

- [ ] **Step 3: Add default-off and opt-in behavior tests**

Insert these tests inside `describe('PomodoroTimerSystem.tick', ...)` after the accumulator test:

```ts
it('autoStartBreak=false by default pauses at the start of break', () => {
    const store = usePomodoroStore.getState();
    store.applySettings(1, 60, 4, true, false);
    store.start();

    usePomodoroStore.getState().tick(1);

    expect(usePomodoroStore.getState().currentPhase).toBe('break');
    expect(usePomodoroStore.getState().remainingSeconds).toBe(60);
    expect(usePomodoroStore.getState().isRunning).toBe(false);
});

it('autoStartBreak=true starts break immediately after focus completes', () => {
    const store = usePomodoroStore.getState();
    store.applySettings(1, 60, 4, true, true);
    store.start();

    usePomodoroStore.getState().tick(1);

    expect(usePomodoroStore.getState().currentPhase).toBe('break');
    expect(usePomodoroStore.getState().remainingSeconds).toBe(60);
    expect(usePomodoroStore.getState().isRunning).toBe(true);
});
```

- [ ] **Step 4: Update settings-window dispatch test expectation**

In `createPomodoroStore — settings-window mode`, replace the apply call and expectation:

```ts
store.getState().applySettings(900, 180, 5, true, false);
expect(store.getState().focusDurationSeconds).toBe(before);
expect(spy).toHaveBeenCalledWith(expect.objectContaining({
    v: BRIDGE_VERSION, store: 'pomodoro', action: 'applySettings', args: [900, 180, 5, true, false],
}));
```

- [ ] **Step 5: Run the focused Pomodoro tests and verify failure**

```bash
cd app && npx vitest run src/domain/pomodoro.test.ts
```

Expected before implementation: FAIL because `applySettings` still has four arguments and/or defaults still use `autoStartBreak: true`.

---

## Task 3: Implement Pomodoro Store State Changes

**Files:**
- Modify: `app/src/domain/pomodoro.ts`

- [ ] **Step 1: Extend the action signature**

Change the `PomodoroActions` signature:

```ts
applySettings: (
    focusSeconds: number,
    breakSeconds: number,
    totalRounds: number,
    resetProgress: boolean,
    autoStartBreak: boolean,
) => void;
```

- [ ] **Step 2: Change both default store values to false**

In the settings-window store object and the main-window store object, set:

```ts
autoStartBreak: false,
```

- [ ] **Step 3: Extend settings-window dispatch**

Replace the settings-window `applySettings` action with:

```ts
applySettings: (focusSeconds, breakSeconds, totalRounds, resetProgress, autoStartBreak) => {
    void dispatch({
        v: BRIDGE_VERSION,
        store: 'pomodoro',
        action: 'applySettings',
        args: [focusSeconds, breakSeconds, totalRounds, resetProgress, autoStartBreak],
    });
},
```

- [ ] **Step 4: Extend main-window applySettings**

Replace the main-window `applySettings` action with:

```ts
applySettings: (focusSeconds, breakSeconds, totalRounds, resetProgress, autoStartBreak) => {
    set({
        focusDurationSeconds: focusSeconds,
        breakDurationSeconds: breakSeconds,
        totalRounds,
        autoStartBreak,
    });
    if (resetProgress) {
        accumulator = 0;
        set({
            isRunning: false,
            currentRound: 1,
            currentPhase: 'focus',
            remainingSeconds: focusSeconds,
        });
    }
},
```

Do not change `advancePhase` except to leave this existing behavior intact:

```ts
isRunning: state.autoStartBreak,
```

- [ ] **Step 5: Run Pomodoro tests and verify pass**

```bash
cd app && npx vitest run src/domain/pomodoro.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Pomodoro store and tests**

```bash
git status --short
git add app/src/domain/pomodoro.ts app/src/domain/pomodoro.test.ts
git commit -m "feat: default break auto-start off"
```

Expected: commit succeeds with only the two Pomodoro files staged.

---

## Task 4: Update Bridge Protocol And Mirror Tests

**Files:**
- Modify: `app/src/domain/bridge/protocol.ts`
- Modify: `app/src/domain/bridge/protocol.test.ts`
- Modify: `app/src/domain/bridge/host.ts`
- Modify: `app/src/domain/bridge/host.test.ts`
- Modify: `app/src/domain/bridge/client.ts`
- Modify: `app/src/domain/bridge/client.test.ts`

- [ ] **Step 1: Write failing protocol type examples**

In `protocol.test.ts`, change the Pomodoro snapshot sample:

```ts
pomodoro: { focusDurationSeconds: 1500, breakDurationSeconds: 300, totalRounds: 4, autoStartBreak: false },
```

Change the Pomodoro dispatch sample:

```ts
{ v: 1, store: 'pomodoro',   action: 'applySettings',  args: [1500, 300, 4, true, false] },
```

Run:

```bash
cd app && npx vitest run src/domain/bridge/protocol.test.ts
```

Expected before protocol implementation: FAIL or TypeScript compile failure because `BridgeSnapshot.pomodoro` and `DispatchPayload` do not yet include `autoStartBreak`.

- [ ] **Step 2: Update bridge protocol types**

In `protocol.ts`, change `BridgeSnapshot.pomodoro`:

```ts
pomodoro: {
    focusDurationSeconds: number;
    breakDurationSeconds: number;
    totalRounds: number;
    autoStartBreak: boolean;
};
```

Change the Pomodoro dispatch payload:

```ts
| { v: typeof BRIDGE_VERSION; store: 'pomodoro';   action: 'applySettings'; args: [number, number, number, boolean, boolean] }
```

- [ ] **Step 3: Update host snapshot and change signature**

In `host.ts`, add `autoStartBreak` to `buildSnapshot()`:

```ts
pomodoro: {
    focusDurationSeconds: p.focusDurationSeconds,
    breakDurationSeconds: p.breakDurationSeconds,
    totalRounds: p.totalRounds,
    autoStartBreak: p.autoStartBreak,
},
```

Replace `pomoSig` with:

```ts
function pomoSig(s: {
    focusDurationSeconds: number;
    breakDurationSeconds: number;
    totalRounds: number;
    autoStartBreak: boolean;
}): string {
    return `${s.focusDurationSeconds}|${s.breakDurationSeconds}|${s.totalRounds}|${s.autoStartBreak}`;
}
```

`applyDispatch` already spreads `payload.args`; no further routing code is needed after the type update.

- [ ] **Step 4: Update host tests**

In `host.test.ts`, add this assertion to `buildSnapshot reads from every source store...`:

```ts
usePomodoroStore.setState({ autoStartBreak: false });
const snap = buildSnapshot();
expect(snap.pomodoro.autoStartBreak).toBe(false);
```

Add this test under `describe('applyDispatch', ...)`:

```ts
it('routes pomodoro/applySettings including autoStartBreak', () => {
    applyDispatch({ v: BRIDGE_VERSION, store: 'pomodoro', action: 'applySettings', args: [900, 180, 5, true, true] });
    expect(usePomodoroStore.getState().focusDurationSeconds).toBe(900);
    expect(usePomodoroStore.getState().breakDurationSeconds).toBe(180);
    expect(usePomodoroStore.getState().totalRounds).toBe(5);
    expect(usePomodoroStore.getState().autoStartBreak).toBe(true);
});
```

- [ ] **Step 5: Update client mirror implementation**

In `client.ts`, add `autoStartBreak` to the Pomodoro mirror set:

```ts
usePomodoroStore.setState({
    focusDurationSeconds: snap.pomodoro.focusDurationSeconds,
    breakDurationSeconds: snap.pomodoro.breakDurationSeconds,
    totalRounds: snap.pomodoro.totalRounds,
    autoStartBreak: snap.pomodoro.autoStartBreak,
});
```

- [ ] **Step 6: Update client mirror tests**

In `client.test.ts`, update `SAMPLE.pomodoro`:

```ts
pomodoro: { focusDurationSeconds: 600, breakDurationSeconds: 120, totalRounds: 6, autoStartBreak: true },
```

Add this assertion to `writes every snapshot section...`:

```ts
expect(usePomodoroStore.getState().autoStartBreak).toBe(true);
```

- [ ] **Step 7: Run bridge tests**

```bash
cd app && npx vitest run src/domain/bridge/protocol.test.ts src/domain/bridge/host.test.ts src/domain/bridge/client.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit bridge changes**

```bash
git status --short
git add app/src/domain/bridge/protocol.ts app/src/domain/bridge/protocol.test.ts app/src/domain/bridge/host.ts app/src/domain/bridge/host.test.ts app/src/domain/bridge/client.ts app/src/domain/bridge/client.test.ts
git commit -m "feat: bridge pomodoro auto-start break setting"
```

Expected: commit succeeds with only bridge files staged.

---

## Task 5: Render The Settings Toggle In The App

**Files:**
- Modify: `app/src/ui/SettingsPanel.tsx`
- Modify: `app/src/ui/SettingsPanel.test.tsx`

- [ ] **Step 1: Write failing settings-panel tests**

In `SettingsPanel.test.tsx`, replace the obsolete-row test with:

```ts
it('renders 自动开始休息 and does not render the obsolete 总轮次 row', () => {
    render(<SettingsPanel />);
    expect(screen.getByText('自动开始休息')).toBeTruthy();
    expect(screen.queryByText('总轮次')).toBeNull();
});
```

Add this test below it:

```ts
it('enables Apply when only 自动开始休息 changes', () => {
    render(<SettingsPanel />);
    const apply = screen.getByRole('button', { name: '应用' });
    expect(apply).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: '自动开始休息' }));

    expect(apply).not.toBeDisabled();
});
```

Run:

```bash
cd app && npx vitest run src/ui/SettingsPanel.test.tsx
```

Expected before implementation: FAIL because the row and accessible toggle do not exist.

- [ ] **Step 2: Add local state and dirty handling in PomodoroTab**

In `SettingsPanel.tsx`, update `PomodoroTab()` state:

```ts
const [focusMin, setFocusMin] = useState(Math.round(pomo.focusDurationSeconds / 60));
const [breakMin, setBreakMin] = useState(Math.round(pomo.breakDurationSeconds / 60));
const [autoStartBreak, setAutoStartBreak] = useState(pomo.autoStartBreak);
```

Update the sync effect:

```ts
useEffect(() => {
    setFocusMin(Math.round(pomo.focusDurationSeconds / 60));
    setBreakMin(Math.round(pomo.breakDurationSeconds / 60));
    setAutoStartBreak(pomo.autoStartBreak);
}, [pomo.focusDurationSeconds, pomo.breakDurationSeconds, pomo.autoStartBreak]);
```

Update dirty calculation:

```ts
const dirty =
    focusMin * 60 !== pomo.focusDurationSeconds ||
    breakMin * 60 !== pomo.breakDurationSeconds ||
    autoStartBreak !== pomo.autoStartBreak;
```

Update apply:

```ts
const apply = () => {
    pomo.applySettings(focusMin * 60, breakMin * 60, pomo.totalRounds, true, autoStartBreak);
};
```

- [ ] **Step 3: Render the new row**

Insert this row after `pomoEndAction` and before `pomoVideoCustom`:

```tsx
{/* pomoAutoStartBreak: 自动开始休息 → Toggle */}
<div className="card pomo-row">
    <span className="pomo-row-label">自动开始休息</span>
    <Toggle
        checked={autoStartBreak}
        onChange={setAutoStartBreak}
        ariaLabel="自动开始休息"
    />
</div>
```

- [ ] **Step 4: Make Toggle accessible by label**

Change the `Toggle` function signature and button:

```tsx
function Toggle({
    checked,
    onChange,
    ariaLabel,
}: {
    checked: boolean;
    onChange: (v: boolean) => void;
    ariaLabel?: string;
}) {
    return (
        <button
            type="button"
            className={`toggle ${checked ? 'on' : ''}`}
            onClick={() => onChange(!checked)}
            aria-pressed={checked}
            aria-label={ariaLabel}
        >
            <span className="toggle-knob" />
        </button>
    );
}
```

Existing callers can omit `ariaLabel`.

- [ ] **Step 5: Run settings panel tests**

```bash
cd app && npx vitest run src/ui/SettingsPanel.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit settings UI changes**

```bash
git status --short
git add app/src/ui/SettingsPanel.tsx app/src/ui/SettingsPanel.test.tsx
git commit -m "feat: expose pomodoro auto-start break setting"
```

Expected: commit succeeds with only the settings panel files staged.

---

## Task 6: Full Verification

**Files:**
- Read/check only unless verification exposes a defect.

- [ ] **Step 1: Run all app tests**

```bash
cd app && npm test
```

Expected: PASS.

- [ ] **Step 2: Run frontend type/build check**

```bash
cd app && npm run build
```

Expected: PASS.

- [ ] **Step 3: Check final working tree**

```bash
git status --short
```

Expected: clean working tree after the task commits.

- [ ] **Step 4: Optional live visual check**

Run the frontend alignment app:

```bash
cd app && npm run dev
```

Open `http://localhost:1420/?window=devalign`, switch to the settings target, and verify the Pomodoro tab shows `自动开始休息` between `计时结束提示` and `自定义视频文件`. Stop the dev server after checking.

Expected: the new row appears in the live settings panel with an off toggle by default.

---

## Self-Review

- Spec coverage: Task 1 covers Pencil-first design; Tasks 2-3 cover default-off and opt-in state behavior; Task 4 covers bridge snapshot/dispatch; Task 5 covers settings UI and dirty Apply state; Task 6 covers verification.
- Placeholder scan: no `TBD`, `TODO`, `implement later`, or ambiguous test instructions are present.
- Type consistency: every `applySettings` reference in this plan uses `(focusSeconds, breakSeconds, totalRounds, resetProgress, autoStartBreak)`, and every `BridgeSnapshot.pomodoro` sample includes `autoStartBreak`.
