# Settings Panel Drag & Pixel-Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align Settings panel drag scope with PomodoroPanel (full-screen via OS window drag), and bring tab content into pixel-perfect parity with Pencil node `vnYnS` and its sub-panels (`gs1Tv`, `8Le5R`, `v2ZgA`, `Pdj9C`).

**Architecture:** Two independent phases. Phase 1 swaps the JS pointer drag for `getCurrentWindow().startDragging()` and prunes the now-dead `panelPosition` state surface. Phase 2 rewrites each tab's JSX so its child tree is a 1:1 structural mirror of the corresponding Pencil sub-panel, dropping store-bound fields that don't appear in the design and adding the missing cards.

**Tech Stack:** Tauri 2, React 18, TypeScript, Zustand, vitest (jsdom), CSS variables in `tokens.css`.

**Spec:** `docs/superpowers/specs/2026-05-15-settings-panel-drag-and-pixel-parity-design.md`

**Repo note:** CPA_V2 has no top-level `.git` (per CLAUDE.md). **Skip all `git add` / `git commit` steps.** Treat the per-task test runs as the completion gate.

---

## File Structure

Phase 1 (drag scope):

- Modify `app/src/domain/settings.ts` — prune `PanelPosition`, `panelPosition`, `setPanelPosition`, `resetPanelPosition`, `clampPanelPosition`, `SETTINGS_PANEL_WIDTH`, `SETTINGS_PANEL_HEIGHT`.
- Modify `app/src/domain/settings.test.ts` — drop tests for deleted APIs; keep tests for `setUiScale`, `setActiveTab`, `setTargetMonitor`, `open`, `close`.
- Modify `app/src/ui/SettingsPanel.tsx` — replace JS pointer drag with native `startDragging()`; remove dead imports and effects.
- Modify `app/src/ui/SettingsPanel.css` — switch to centered fixed position; add `-webkit-app-region` regions; drop `is-dragging` rules + `max-height: 90vh`.
- Create `app/src/ui/SettingsPanel.test.tsx` — drag invocation + geometry assertion.

Phase 2 (pixel parity):

- Modify `app/src/ui/SettingsPanel.tsx` — rewrite `PomodoroTab` and `OnlineTab`; verify `GlobalTab`, `PetTab`.
- Modify `app/src/ui/SettingsPanel.css` — add classes for new rows (`pomo-row`, `online-history`, `online-busy-overlay`); icon-font wrapper styles for `pomoVideoCustom`.
- Modify `app/src/ui/SettingsPanel.test.tsx` — add a structural assertion per tab (cards present, labels present).

---

## Phase 1 — Window-scope drag

### Task 1.1: Failing test — drag header invokes `startDragging`

**Files:**
- Create: `app/src/ui/SettingsPanel.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { useSettingsStore } from '../domain/settings';
import { SettingsPanel } from './SettingsPanel';

const startDragging = vi.fn();

vi.mock('@tauri-apps/api/window', () => ({
    getCurrentWindow: () => ({
        startDragging: () => {
            startDragging();
            return Promise.resolve();
        },
    }),
}));

beforeEach(() => {
    startDragging.mockReset();
    useSettingsStore.setState({ isOpen: true, activeTab: 'pomodoro' });
    cleanup();
});

describe('SettingsPanel drag', () => {
    it('header pointer down triggers native window drag', () => {
        render(<SettingsPanel />);
        const head = screen.getByRole('dialog', { name: '设置' }).querySelector('.settings-head')!;
        fireEvent.pointerDown(head, { button: 0 });
        expect(startDragging).toHaveBeenCalledTimes(1);
    });

    it('clicking the close button does NOT trigger drag', () => {
        render(<SettingsPanel />);
        const closeBtn = screen.getByRole('button', { name: '关闭' });
        fireEvent.pointerDown(closeBtn, { button: 0 });
        expect(startDragging).not.toHaveBeenCalled();
    });
});
```

- [ ] **Step 2: Verify the test setup runs (it will fail because SettingsPanel still uses JS pointer drag, not startDragging)**

Run: `cd app && npx vitest run src/ui/SettingsPanel.test.tsx`
Expected: 2 tests fail — `startDragging` was not invoked (the current implementation does not call it).

If vitest reports `@testing-library/react` is not installed, install it:

```bash
cd app && npm install -D @testing-library/react @testing-library/jest-dom
```

Then re-run the command. Expected: the test files compile and the assertions fail.

---

### Task 1.2: Failing test — panel renders at strict `460 × 394`

**Files:**
- Modify: `app/src/ui/SettingsPanel.test.tsx`

- [ ] **Step 1: Append the geometry assertion**

Add this `describe` block at the bottom of `app/src/ui/SettingsPanel.test.tsx`:

```tsx
describe('SettingsPanel geometry', () => {
    it('renders the vnYnS-mandated 460 × 394 shell', () => {
        render(<SettingsPanel />);
        const panel = screen.getByRole('dialog', { name: '设置' }) as HTMLElement;
        const style = getComputedStyle(panel);
        expect(style.width).toBe('460px');
        expect(style.height).toBe('394px');
    });
});
```

- [ ] **Step 2: Run and confirm the geometry test passes**

Run: `cd app && npx vitest run src/ui/SettingsPanel.test.tsx -t "geometry"`
Expected: PASS — the current CSS already locks `.settings-panel` at `460 × 394`. This test exists to **guard** the parity after we touch CSS in later tasks.

If the geometry test FAILS at this point, the CSS has drifted from spec — stop and inspect `.settings-panel`. The expected fix is to keep `width: 460px; height: 394px` literal.

---

### Task 1.3: Switch `SettingsPanel.tsx` to native window drag

**Files:**
- Modify: `app/src/ui/SettingsPanel.tsx`

- [ ] **Step 1: Replace imports at the top of the file**

In `app/src/ui/SettingsPanel.tsx`, change lines 1-14 to:

```tsx
import { useState, useEffect } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import {
    useSettingsStore,
    type SettingsTab,
    MIN_SCALE,
    MAX_SCALE,
} from '../domain/settings';
import { usePomodoroStore } from '../domain/pomodoro';
import { useNetworkStore } from '../domain/network';
import { useBindingKeyStore } from '../domain/bindingKey';
import './SettingsPanel.css';
```

Removed: `useRef`, `useCallback`, `SETTINGS_PANEL_WIDTH`, `SETTINGS_PANEL_HEIGHT`, `clampPanelPosition`. (`useState` and `useEffect` remain — `useState` is used by tab forms; `useEffect` is used elsewhere in this file.)

- [ ] **Step 2: Replace the `SettingsPanel` function body**

In `app/src/ui/SettingsPanel.tsx`, replace the entire `export function SettingsPanel()` block (currently lines 23-123) with:

```tsx
export function SettingsPanel() {
    const isOpen = useSettingsStore((s) => s.isOpen);
    const activeTab = useSettingsStore((s) => s.activeTab);
    const close = useSettingsStore((s) => s.close);
    const setActiveTab = useSettingsStore((s) => s.setActiveTab);

    const onHeaderPointerDown = async (e: React.PointerEvent<HTMLDivElement>) => {
        if (e.button !== 0) return;
        const target = e.target as HTMLElement;
        if (target.closest('button')) return;
        try {
            await getCurrentWindow().startDragging();
        } catch {
            /* drag may fail in non-Tauri/test env; swallow */
        }
    };

    if (!isOpen) return null;

    return (
        <div
            className="settings-panel"
            role="dialog"
            aria-label="设置"
        >
            <div className="settings-head" onPointerDown={onHeaderPointerDown}>
                <h2 className="settings-title">设置</h2>
                <div className="settings-head-spacer" />
                <button className="settings-close" onClick={close} aria-label="关闭">
                    <CloseIcon />
                </button>
            </div>
            <div className="settings-body">
                <nav className="settings-nav">
                    {TABS.map((t) => (
                        <button
                            key={t.id}
                            className={`settings-tab ${activeTab === t.id ? 'active' : ''}`}
                            onClick={() => setActiveTab(t.id)}
                        >
                            {t.label}
                        </button>
                    ))}
                </nav>
                <div className="settings-content">
                    {activeTab === 'pomodoro' && <PomodoroTab />}
                    {activeTab === 'online' && <OnlineTab />}
                    {activeTab === 'pet' && <PetTab />}
                    {activeTab === 'global' && <GlobalTab />}
                </div>
            </div>
        </div>
    );
}
```

The diff removes: `panelRef`, `dragOffset` state, `computedPos`, the `useCallback` pointer-down handler, the `pointermove`/`pointerup` effect, the `resize` effect, the `panelPosition`/`setPanelPosition` reads, and the inline `style={{ left, top }}`.

- [ ] **Step 3: Run the drag tests and confirm they pass**

Run: `cd app && npx vitest run src/ui/SettingsPanel.test.tsx -t "drag"`
Expected: both drag tests PASS.

- [ ] **Step 4: Run the geometry test and confirm it still passes**

Run: `cd app && npx vitest run src/ui/SettingsPanel.test.tsx -t "geometry"`
Expected: PASS.

---

### Task 1.4: Prune `settings.ts` panel-position surface

**Files:**
- Modify: `app/src/domain/settings.ts`

- [ ] **Step 1: Rewrite the entire file**

Replace the full contents of `app/src/domain/settings.ts` with:

```ts
import { create } from 'zustand';

export type SettingsTab = 'pomodoro' | 'online' | 'pet' | 'global';

export interface SettingsState {
    isOpen: boolean;
    activeTab: SettingsTab;
    uiScale: number;
    targetMonitorIndex: number;
}

interface SettingsActions {
    open: (tab?: SettingsTab) => void;
    close: () => void;
    setActiveTab: (tab: SettingsTab) => void;
    setUiScale: (scale: number) => void;
    setTargetMonitor: (index: number) => void;
}

export const MIN_SCALE = 0.5;
export const MAX_SCALE = 3.0;

export const useSettingsStore = create<SettingsState & SettingsActions>((set) => ({
    isOpen: false,
    activeTab: 'pomodoro',
    uiScale: 1.0,
    targetMonitorIndex: 0,

    open: (tab) => set((s) => ({ isOpen: true, activeTab: tab ?? s.activeTab })),
    close: () => set({ isOpen: false }),
    setActiveTab: (tab) => set({ activeTab: tab }),
    setUiScale: (scale) => set({ uiScale: Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale)) }),
    setTargetMonitor: (index) => set({ targetMonitorIndex: Math.max(0, index) }),
}));
```

Removed: `PanelPosition`, `panelPosition`, `clampPanelPosition`, `setPanelPosition`, `resetPanelPosition`, `SETTINGS_PANEL_WIDTH`, `SETTINGS_PANEL_HEIGHT`.

- [ ] **Step 2: Sanity check — TS compiles**

Run: `cd app && npx tsc --noEmit`
Expected: compile succeeds. If any file other than `settings.test.ts` references the removed exports, that's a real bug. Fix call sites by removing the dead reference (no consumer of `clampPanelPosition` exists outside `SettingsPanel.tsx`, which we already cleaned).

If `SettingsPanel.test.tsx` complains about unused imports, leave it — Task 1.5 also touches tests.

---

### Task 1.5: Prune `settings.test.ts`

**Files:**
- Modify: `app/src/domain/settings.test.ts`

- [ ] **Step 1: Rewrite the entire file**

Replace `app/src/domain/settings.test.ts` with:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useSettingsStore, MIN_SCALE, MAX_SCALE } from './settings';

beforeEach(() => {
    useSettingsStore.setState({
        isOpen: false,
        activeTab: 'pomodoro',
        uiScale: 1.0,
        targetMonitorIndex: 0,
    });
});

describe('useSettingsStore', () => {
    it('open(tab) marks panel open and switches to the requested tab', () => {
        useSettingsStore.getState().open('global');
        const s = useSettingsStore.getState();
        expect(s.isOpen).toBe(true);
        expect(s.activeTab).toBe('global');
    });

    it('open() without arg keeps current activeTab', () => {
        useSettingsStore.setState({ activeTab: 'online' });
        useSettingsStore.getState().open();
        expect(useSettingsStore.getState().activeTab).toBe('online');
    });

    it('close() only flips isOpen', () => {
        useSettingsStore.getState().open();
        useSettingsStore.getState().close();
        expect(useSettingsStore.getState().isOpen).toBe(false);
    });

    it('setUiScale clamps below MIN_SCALE', () => {
        useSettingsStore.getState().setUiScale(0.1);
        expect(useSettingsStore.getState().uiScale).toBe(MIN_SCALE);
    });

    it('setUiScale clamps above MAX_SCALE', () => {
        useSettingsStore.getState().setUiScale(99);
        expect(useSettingsStore.getState().uiScale).toBe(MAX_SCALE);
    });

    it('setTargetMonitor never goes below 0', () => {
        useSettingsStore.getState().setTargetMonitor(-3);
        expect(useSettingsStore.getState().targetMonitorIndex).toBe(0);
    });
});
```

- [ ] **Step 2: Run the suite**

Run: `cd app && npx vitest run src/domain/settings.test.ts`
Expected: all 6 tests PASS.

---

### Task 1.6: CSS — centered fixed shell, drag regions

**Files:**
- Modify: `app/src/ui/SettingsPanel.css`

- [ ] **Step 1: Replace the `.settings-panel` rule (currently lines 17-32)**

In `app/src/ui/SettingsPanel.css`, replace the `.settings-panel` block with:

```css
.settings-panel {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: 460px;
    height: 394px;
    background: var(--settings-bg);
    border: 1px solid var(--settings-stroke);
    border-radius: var(--settings-radius);
    padding: var(--settings-padding);
    display: flex;
    flex-direction: column;
    gap: var(--settings-gap);
    box-shadow: var(--shadow-dialog);
    box-sizing: border-box;
    z-index: 100;
}
```

Changes vs current: dropped `max-height: 90vh`; replaced `left`/`top` (consumed from inline style) with literal `50%` + `transform: translate(-50%, -50%)`.

- [ ] **Step 2: Delete the two `is-dragging` rules**

Delete these two lines (currently 34-35):

```css
.settings-panel.is-dragging { user-select: none; cursor: grabbing; }
.settings-panel.is-dragging * { pointer-events: none; }
```

- [ ] **Step 3: Make the header draggable on Tauri**

Update `.settings-head` (currently lines 39-44) and `.settings-close` (currently line 60-71) to include drag regions:

```css
.settings-head {
    display: flex;
    align-items: center;
    gap: 0;
    cursor: grab;
    -webkit-app-region: drag;
}

.settings-head:active { cursor: grabbing; }
```

For `.settings-close`, add `-webkit-app-region: no-drag;` so the close button isn't swallowed by the drag region. The full updated rule:

```css
.settings-close {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 30px;
    padding: 6px;
    border-radius: 999px;
    background: transparent;
    color: var(--btn-close-icon);
    box-sizing: border-box;
    -webkit-app-region: no-drag;
}
```

- [ ] **Step 4: Run the full SettingsPanel test file**

Run: `cd app && npx vitest run src/ui/SettingsPanel.test.tsx`
Expected: all tests PASS (4 tests so far: 2 drag + 1 geometry + the close-button-no-drag assertion).

---

### Task 1.7: Phase 1 verification

- [ ] **Step 1: Type-check**

Run: `cd app && npx tsc --noEmit`
Expected: clean compile.

- [ ] **Step 2: Full test suite**

Run: `cd app && npm test`
Expected: all suites pass — `pomodoro.test.ts`, `network.test.ts`, `stateSync.test.ts`, `settings.test.ts`, `SettingsPanel.test.tsx`.

- [ ] **Step 3: Build**

Run: `cd app && npm run build`
Expected: clean build (no TS errors, no Vite warnings).

- [ ] **Step 4: Manual smoke (optional, requires Tauri)**

Run: `cd app && npm run tauri dev`
Open Settings (gear icon in PomodoroPanel). Drag the header — the entire OS window should follow the cursor across screens. Click the close button — panel closes, no drag.

---

## Phase 2 — Pixel-perfect tab content

> Each tab gets one task. Static placeholder values (e.g. "柔和铃声", "弹窗到顶部", "未选择") are intentional — the spec is strict structural parity with Pencil, not store-bound functionality.

### Task 2.1: `PomodoroTab` → mirror `gs1Tv`

**Files:**
- Modify: `app/src/ui/SettingsPanel.tsx`
- Modify: `app/src/ui/SettingsPanel.css`
- Modify: `app/src/ui/SettingsPanel.test.tsx`

- [ ] **Step 1: Write the failing structural test**

Append to `app/src/ui/SettingsPanel.test.tsx` (no new imports needed — `useSettingsStore` is already imported at the top from Task 1.1):

```tsx
describe('PomodoroTab parity with gs1Tv', () => {
    beforeEach(() => {
        useSettingsStore.setState({ isOpen: true, activeTab: 'pomodoro' });
    });

    it('renders pomoGrid + 4 pomoFooter rows', () => {
        render(<SettingsPanel />);
        // pomoGrid: work + break cards (label text)
        expect(screen.getByText('专注时长')).toBeTruthy();
        expect(screen.getByText('休息时长')).toBeTruthy();
        // pomoFooter rows
        expect(screen.getByText('结束提示音')).toBeTruthy();
        expect(screen.getByText('计时结束提示')).toBeTruthy();
        expect(screen.getByText('视频文件')).toBeTruthy();
        expect(screen.getByText('自定义视频文件')).toBeTruthy();
    });

    it('does NOT render the obsolete 总轮次 / 休息自动开始 rows', () => {
        render(<SettingsPanel />);
        expect(screen.queryByText('总轮次')).toBeNull();
        expect(screen.queryByText('休息自动开始')).toBeNull();
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd app && npx vitest run src/ui/SettingsPanel.test.tsx -t "PomodoroTab parity"`
Expected: FAIL — current tab still shows 总轮次 / 休息自动开始, no 结束提示音 / 计时结束提示 etc.

- [ ] **Step 3: Rewrite `PomodoroTab`**

In `app/src/ui/SettingsPanel.tsx`, replace the entire `function PomodoroTab()` block (currently lines 129-191) with:

```tsx
function PomodoroTab() {
    const pomo = usePomodoroStore();
    const [focusMin, setFocusMin] = useState(Math.round(pomo.focusDurationSeconds / 60));
    const [breakMin, setBreakMin] = useState(Math.round(pomo.breakDurationSeconds / 60));

    useEffect(() => {
        setFocusMin(Math.round(pomo.focusDurationSeconds / 60));
        setBreakMin(Math.round(pomo.breakDurationSeconds / 60));
    }, [pomo.focusDurationSeconds, pomo.breakDurationSeconds]);

    const dirty =
        focusMin * 60 !== pomo.focusDurationSeconds ||
        breakMin * 60 !== pomo.breakDurationSeconds;

    const apply = () => {
        pomo.applySettings(focusMin * 60, breakMin * 60, pomo.totalRounds, true);
    };

    return (
        <>
            <div className="apply-row">
                <button className="btn btn-primary apply-btn" disabled={!dirty} onClick={apply}>
                    应用
                </button>
            </div>
            <div className="settings-content-scroll">
                <div className="tab-pane has-apply">
                    {/* pomoGrid aIr3d */}
                    <div className="card card-grid">
                        <div className="card">
                            <span className="card-label">专注时长</span>
                            <NumberSuffix value={focusMin} onChange={setFocusMin} min={1} max={120} suffix="分钟" />
                        </div>
                        <div className="card card-break">
                            <span className="card-label">休息时长</span>
                            <NumberSuffix
                                value={breakMin} onChange={setBreakMin} min={0} max={60} suffix="分钟"
                                variant="warning"
                            />
                        </div>
                    </div>

                    {/* pomoFooter JpJcn */}
                    <div className="pomo-footer">
                        {/* pomoNotif aCOWE: 结束提示音 → 状态值文字（链接色） */}
                        <div className="card pomo-row">
                            <span className="pomo-row-label">结束提示音</span>
                            <span className="pomo-row-value pomo-row-value-link">柔和铃声</span>
                        </div>

                        {/* pomoEndAction I6SsL5: 计时结束提示 → Dropdown */}
                        <div className="card pomo-row">
                            <span className="pomo-row-label">计时结束提示</span>
                            <button className="dropdown dropdown-fit" type="button">
                                <span className="dropdown-value">弹窗到顶部</span>
                                <ChevronDownIcon className="dropdown-chevron" />
                            </button>
                        </div>

                        {/* pomoVideoPath WSnlp: enabled:false → disabled visual */}
                        <div className="card pomo-row is-disabled">
                            <span className="pomo-row-label">视频文件</span>
                            <button className="dropdown dropdown-fit" type="button" disabled>
                                <span className="dropdown-value">未选择</span>
                                <ChevronDownIcon className="dropdown-chevron" />
                            </button>
                        </div>

                        {/* pomoVideoCustom Jvg0I: 自定义视频文件 → 状态文字 + 文件夹图标 */}
                        <div className="card pomo-row">
                            <span className="pomo-row-label">自定义视频文件</span>
                            <span className="pomo-row-right">
                                <span className="pomo-row-value pomo-row-value-muted">未选择</span>
                                <FolderIcon />
                            </span>
                        </div>
                    </div>
                </div>
            </div>
        </>
    );
}
```

- [ ] **Step 4: Add the `FolderIcon` helper near the other icon helpers (after `PlusIcon`)**

Append to `app/src/ui/SettingsPanel.tsx`:

```tsx
function FolderIcon() {
    /* lucide `folder` — Pencil YQwLD: 16×16 #6B7280 */
    return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#6B7280" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
        </svg>
    );
}
```

- [ ] **Step 5: Add CSS for the new structures**

Append to `app/src/ui/SettingsPanel.css`:

```css
/* ===== pomoFooter JpJcn: vertical, gap 10 ===== */
.pomo-footer {
    display: flex;
    flex-direction: column;
    gap: var(--settings-card-gap); /* 10 */
}

/* row variant of .card: alignItems center, justifyContent space_between, padding [14,16] */
.pomo-row {
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
    padding: var(--settings-row-pad-y) var(--settings-row-pad-x);
    gap: 8px;
}

.pomo-row.is-disabled { opacity: 0.5; pointer-events: none; }

.pomo-row-label {
    font-family: var(--font-cn);
    font-size: 14px;
    font-weight: 500;
    color: var(--text-primary);
    line-height: 1;
}

.pomo-row-value {
    font-family: var(--font-cn);
    font-size: 12px;
    font-weight: 700;
    line-height: 1;
}

.pomo-row-value-link  { color: var(--text-link); }
.pomo-row-value-muted { color: var(--text-muted); }

.pomo-row-right {
    display: inline-flex;
    align-items: center;
    gap: 8px;
}

/* Frjkw 的 fit-content 变体 — pomoEndAction / pomoVideoPath 用的窄 dropdown */
.dropdown-fit { width: auto; }
```

- [ ] **Step 6: Run the parity test**

Run: `cd app && npx vitest run src/ui/SettingsPanel.test.tsx -t "PomodoroTab parity"`
Expected: both PomodoroTab tests PASS.

- [ ] **Step 7: Run all SettingsPanel + settings tests to catch regressions**

Run: `cd app && npx vitest run src/ui/SettingsPanel.test.tsx src/domain/settings.test.ts src/domain/pomodoro.test.ts`
Expected: all PASS.

---

### Task 2.2: `OnlineTab` → add `onlHistCard` + `onlBusyOverlay`

**Files:**
- Modify: `app/src/ui/SettingsPanel.tsx`
- Modify: `app/src/ui/SettingsPanel.css`
- Modify: `app/src/ui/SettingsPanel.test.tsx`

- [ ] **Step 1: Failing test for history card + busy overlay**

First, add this import to the **top of `app/src/ui/SettingsPanel.test.tsx`** (alongside the existing imports — not inside the new describe block):

```tsx
import { useNetworkStore } from '../domain/network';
```

Then append:

```tsx
describe('OnlineTab parity with 8Le5R', () => {
    beforeEach(() => {
        useSettingsStore.setState({ isOpen: true, activeTab: 'online' });
        useNetworkStore.setState({
            status: 'idle',
            roomCode: '',
            playerId: null,
            players: {},
            lastError: null,
        });
    });

    it('renders onlHistCard (历史房间) below the join form when not joined', () => {
        render(<SettingsPanel />);
        expect(screen.getByText('历史房间')).toBeTruthy();
    });

    it('renders onlBusyOverlay when status is connecting', () => {
        useNetworkStore.setState({ status: 'connecting' });
        render(<SettingsPanel />);
        expect(screen.getByText('正在加入房间…')).toBeTruthy();
    });

    it('does NOT render busy overlay when idle', () => {
        render(<SettingsPanel />);
        expect(screen.queryByText('正在加入房间…')).toBeNull();
    });
});
```

- [ ] **Step 2: Run, confirm failure**

Run: `cd app && npx vitest run src/ui/SettingsPanel.test.tsx -t "OnlineTab parity"`
Expected: 3 tests FAIL — history card text and overlay text are absent.

- [ ] **Step 3: Rewrite `OnlineTab`**

In `app/src/ui/SettingsPanel.tsx`, replace the entire `function OnlineTab()` block (currently lines 197-295) with:

```tsx
function OnlineTab() {
    const net = useNetworkStore();
    const [name, setName] = useState(net.playerName);
    const [code, setCode] = useState(net.roomCode);

    const isJoined = net.status === 'joined';
    const reconnecting = net.status === 'reconnecting';
    const connecting = net.status === 'connecting';

    return (
        <div className="settings-content-scroll online-tab-root">
            <div className="tab-pane">
                {/* onlAutoRow FUrip */}
                <div className="card pomo-row">
                    <span className="pomo-row-label">自动联网</span>
                    <Toggle checked={net.autoConnect} onChange={net.setAutoConnect} />
                </div>

                {!isJoined && (
                    <>
                        {/* onlJoinCard ArRDI */}
                        <div className="card">
                            <span className="card-title">加入房间</span>
                            <div className="card card-row-stack" style={{ background: 'transparent', padding: 0 }}>
                                <span className="card-label">用户名</span>
                                <input
                                    className="text-input"
                                    value={name}
                                    onChange={(e) => setName(e.currentTarget.value)}
                                    onBlur={() => net.setPlayerName(name)}
                                    placeholder="我的昵称"
                                />
                            </div>
                            <div className="card card-row-stack" style={{ background: 'transparent', padding: 0 }}>
                                <span className="card-label">房间号</span>
                                <input
                                    className="text-input"
                                    value={code}
                                    onChange={(e) => setCode(e.currentTarget.value.toUpperCase())}
                                    placeholder="ROOM-001"
                                />
                            </div>
                            <div className="card-actions" style={{ width: '100%' }}>
                                <button
                                    className="btn btn-secondary btn-block"
                                    onClick={() => net.createRoom(code)}
                                >
                                    创建房间
                                </button>
                                <button
                                    className="btn btn-primary btn-block"
                                    onClick={() => net.joinRoom(code)}
                                    disabled={!code}
                                >
                                    加入房间
                                </button>
                            </div>
                            {net.lastError && <div className="error-text">{net.lastError}</div>}
                        </div>

                        {/* onlHistCard E3S4e */}
                        <div className="card online-history">
                            <span className="card-title">历史房间</span>
                            <div className="history-list">
                                <button type="button" className="history-item" disabled>
                                    <span className="history-name">尚无历史</span>
                                    <span className="history-spacer" />
                                </button>
                            </div>
                        </div>
                    </>
                )}

                {isJoined && (
                    <div className="card card-room">
                        {reconnecting && (
                            <div className="online-reconnect">正在重新连接…</div>
                        )}
                        <div className="online-room-head">
                            <div className="online-room-info">
                                <span className="online-room-name">ROOM-{net.roomCode}</span>
                                <span className="online-room-sub">
                                    {Object.keys(net.players).length} 位成员
                                </span>
                            </div>
                            <button className="btn btn-secondary btn-fit" onClick={net.leaveRoom}>
                                退出房间
                            </button>
                        </div>
                        <div className="member-list">
                            {Object.values(net.players).map((p) => {
                                const isSelf = p.playerId === net.playerId;
                                const status = phaseToText(p.state?.pomodoro.phase, p.state?.pomodoro.isRunning ?? false);
                                return (
                                    <div key={p.playerId} className="member-item">
                                        <span className={`member-dot ${status.idle ? 'member-dot-idle' : ''}`} />
                                        <span className={`member-name ${isSelf ? 'member-name-self' : ''}`}>
                                            {p.playerName}{isSelf ? '（我）' : ''}
                                        </span>
                                        <span className={`member-status ${status.cls}`}>{status.label}</span>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}
            </div>

            {/* onlBusyOverlay 3aoUs — absolute, shown during connecting */}
            {connecting && (
                <div className="online-busy-overlay">
                    <span className="online-busy-text">正在加入房间…</span>
                </div>
            )}
        </div>
    );
}
```

Changes vs the current implementation: `自动联网` row reuses `.pomo-row` class instead of an inline `padding` style; `onlHistCard` added as an empty-state stub; `onlBusyOverlay` rendered when `status === 'connecting'`.

- [ ] **Step 4: Add overlay CSS**

Append to `app/src/ui/SettingsPanel.css`:

```css
/* online tab root must position the overlay */
.online-tab-root { position: relative; }

/* 3aoUs onlBusyOverlay: absolute, fill #FFFFFFD9, radius 16, center text 14/700 */
.online-busy-overlay {
    position: absolute;
    inset: 0;
    background: #FFFFFFD9;
    border-radius: var(--settings-card-radius);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1;
}

.online-busy-text {
    font-family: var(--font-cn);
    font-size: 14px;
    font-weight: 700;
    color: var(--text-primary);
    line-height: 1;
}
```

- [ ] **Step 5: Run online parity tests**

Run: `cd app && npx vitest run src/ui/SettingsPanel.test.tsx -t "OnlineTab parity"`
Expected: 3 tests PASS.

- [ ] **Step 6: Re-run all SettingsPanel + network tests**

Run: `cd app && npx vitest run src/ui/SettingsPanel.test.tsx src/domain/network.test.ts`
Expected: all PASS.

---

### Task 2.3: `GlobalTab` audit — verify Pdj9C parity

**Files:**
- Modify: `app/src/ui/SettingsPanel.test.tsx`

- [ ] **Step 1: Structural assertion (likely passes immediately)**

Append to `app/src/ui/SettingsPanel.test.tsx`:

```tsx
describe('GlobalTab parity with Pdj9C', () => {
    beforeEach(() => {
        useSettingsStore.setState({ isOpen: true, activeTab: 'global' });
    });

    it('renders the three Pdj9C cards', () => {
        render(<SettingsPanel />);
        expect(screen.getByText('界面缩放')).toBeTruthy();
        expect(screen.getByText('目标显示器')).toBeTruthy();
        expect(screen.getByText('按键计数')).toBeTruthy();
    });
});
```

- [ ] **Step 2: Run, confirm PASS**

Run: `cd app && npx vitest run src/ui/SettingsPanel.test.tsx -t "GlobalTab parity"`
Expected: PASS without any source edit (`GlobalTab` already mirrors Pdj9C).

If the test FAILS, that means one of the three card labels has drifted — restore the label in `function GlobalTab()`.

---

### Task 2.4: `PetTab` audit — verify v2ZgA placeholder

**Files:**
- Modify: `app/src/ui/SettingsPanel.test.tsx`

- [ ] **Step 1: Structural assertion**

Append to `app/src/ui/SettingsPanel.test.tsx`:

```tsx
describe('PetTab parity with v2ZgA', () => {
    beforeEach(() => {
        useSettingsStore.setState({ isOpen: true, activeTab: 'pet' });
    });

    it('renders the placeholder card (v2ZgA is fit_content(70) with no children)', () => {
        render(<SettingsPanel />);
        expect(screen.getByText('桌宠形态')).toBeTruthy();
        expect(screen.getByText(/尚未实现/)).toBeTruthy();
    });
});
```

- [ ] **Step 2: Run, confirm PASS**

Run: `cd app && npx vitest run src/ui/SettingsPanel.test.tsx -t "PetTab parity"`
Expected: PASS without edits.

---

### Task 2.5: Phase 2 verification

- [ ] **Step 1: Type-check**

Run: `cd app && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 2: Full test suite**

Run: `cd app && npm test`
Expected: all suites pass.

- [ ] **Step 3: Build**

Run: `cd app && npm run build`
Expected: clean.

- [ ] **Step 4: Manual visual smoke (requires Tauri)**

Run: `cd app && npm run tauri dev`

Walk-through:
1. Open Settings via the gear in PomodoroPanel.
2. Confirm panel sits centered, exactly `460 × 394` (use devtools inspector if unsure).
3. Drag the header — entire window moves freely across screen.
4. Pomodoro tab — verify `pomoGrid` (work + break) and four footer rows (`结束提示音`, `计时结束提示`, `视频文件` greyed, `自定义视频文件` with folder icon).
5. Online tab — without joining, verify "加入房间" card and "历史房间" card. Hit "加入房间" with a valid code — verify the white-translucent "正在加入房间…" overlay flashes during connect.
6. Pet tab — stub copy visible.
7. Global tab — three cards: 界面缩放 (slider + 1.0× value), 目标显示器 (dropdown), 按键计数 (toggle + description + add button).

If any of (2)-(7) fail visual parity, file the discrepancy and fix in a follow-up commit referencing the Pencil node id involved.

---

## Self-Review Check

- **Spec coverage**
  - Spec §Goals: window-drag → Task 1.3; 460×394 strict → Task 1.6 + 1.2; tab content 1:1 → Tasks 2.1–2.4; tests → Tasks 1.1, 1.2, 1.5, 2.1, 2.2, 2.3, 2.4.
  - Spec §Non-Goals: no separate window, no 总轮次/休息自动开始 UI, no animations. Reflected in Task 2.1 step 3 deleting those rows.
  - Spec §Files Touched: matches `File Structure` above.
- **Placeholder scan:** no "TBD", no "implement later", every code step has the complete code.
- **Type consistency:** removed `clampPanelPosition` / `PanelPosition` everywhere they appeared; new helpers (`FolderIcon`) defined before use; `MIN_SCALE`/`MAX_SCALE` retained.
- **Open caveat:** `@testing-library/react` may not be in dev deps. Task 1.1 step 2 handles install on first failure. If the project already has `@testing-library/react`, the install is a no-op.
