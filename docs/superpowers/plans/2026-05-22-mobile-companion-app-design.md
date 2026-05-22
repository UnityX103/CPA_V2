# Mobile Companion App Design Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Add a complete mobile companion design set to `AUI/PUI.pen` with Pomodoro screens, plan screens, iOS widgets, Android widgets, and Dynamic Island states.

**Architecture:** This is a Pencil-only implementation. Add one new top-level frame named `Mobile Companion App` near the existing `Daily Check-in Panels` frame, then build four contained sections: mobile app screens, iOS widgets, Android widgets, and Dynamic Island. Existing desktop components remain untouched.

**Tech Stack:** Pencil MCP (`mcp__pencil__open_document`, `batch_get`, `batch_design`, `snapshot_layout`, `get_screenshot`, `export_nodes`) and Git.

---

### Task 1: Prepare Pencil Context

**Files:**
- Modify: `AUI/PUI.pen`
- Reference: `docs/superpowers/specs/2026-05-22-mobile-companion-app-design.md`

- [x] **Step 1: Open the Pencil document**

Use Pencil MCP:

```json
{
  "path": "/Users/xpy/Desktop/NanZhai/CPA_V2/.worktrees/phoneui/AUI/PUI.pen"
}
```

Expected: Pencil opens `AUI/PUI.pen`.

- [x] **Step 2: Read canvas layout**

Use `snapshot_layout` with:

```json
{
  "filePath": "/Users/xpy/Desktop/NanZhai/CPA_V2/.worktrees/phoneui/AUI/PUI.pen",
  "maxDepth": 0
}
```

Expected: top-level frames include `g9Gei` named `Daily Check-in Panels` and no `Mobile Companion App` frame.

- [x] **Step 3: Read existing source components**

Use `batch_get` for:

```json
{
  "filePath": "/Users/xpy/Desktop/NanZhai/CPA_V2/.worktrees/phoneui/AUI/PUI.pen",
  "nodeIds": ["YRqeB", "KB3Vp", "s6g1w", "g9Gei"],
  "readDepth": 2,
  "resolveVariables": true
}
```

Expected: source components confirm current colors, typography, and row hierarchy.

### Task 2: Create Mobile App Screens

**Files:**
- Modify: `AUI/PUI.pen`

- [x] **Step 1: Insert the top-level mobile group and app-screen section**

Use `batch_design` to create:

- `Mobile Companion App` at an empty area to the right of or below `Daily Check-in Panels`.
- `Mobile App Screens` section.
- Five 390x844 phone frames:
  - `Mobile/Home Focus`
  - `Mobile/Home Break`
  - `Mobile/Today Plan`
  - `Mobile/Plan Editor Normal`
  - `Mobile/Plan Editor Rest + Inherit`

The first batch should set `placeholder: true` on the new group and section while they are being built.

Expected: five phone frames exist and are visually separated with labels.

- [x] **Step 2: Build shared mobile screen shell**

Each phone frame should include:

- Status bar row.
- App header row.
- Sync status pill.
- Main content stack.
- Warm background fill.
- Rounded content cards.

Use these stable style values:

```js
const phone = { width: 390, height: 844, cornerRadius: 32, clip: true, fill: "#FFF8F2" };
const panel = { cornerRadius: 24, fill: "#FFFDFBEE", stroke: { fill: "#EFDCCD", thickness: 1 } };
const text = { fontFamily: "MaokenAssortedSans", fontWeight: "700" };
const focus = "#D15F3D";
const rest = "#2D8F4E";
```

Expected: all five app screens share the same visual language.

- [x] **Step 3: Fill `Mobile/Home Focus`**

Add:

- Phase title `专注中`.
- Large time `24:12`.
- Orange ring/progress treatment.
- Primary button `暂停`.
- Secondary hint `下一段休息 5 分钟`.
- Today summary card with `今日计划`, progress `2/3`, and three rows: `番茄钟专注`, `看书`, `拉伸`.

Expected: Pomodoro dominates the first screen and the plan summary is visible below it.

- [x] **Step 4: Fill `Mobile/Home Break`**

Add:

- Phase title `休息中`.
- Large time `04:38`.
- Green ring/progress treatment.
- Primary button `继续休息`.
- Secondary action `开始下一轮`.
- Today summary card with completed styling.

Expected: same structure as focus screen, but clearly green rest state.

- [x] **Step 5: Fill `Mobile/Today Plan`**

Add:

- Header `今日计划`.
- Date line `5月22日 · 周五`.
- Progress card `2/3 项已完成`.
- Three item rows:
  - `番茄钟专注`, `2/4 次`, incomplete orange.
  - `看书`, `1/1 次`, complete green.
  - `拉伸`, `0/1 次`, incomplete orange.
- Visible `+1` controls.
- `编辑计划` entry.

Expected: row semantics match the desktop `Today Check-in Panel`, adapted to phone width.

- [x] **Step 6: Fill `Mobile/Plan Editor Normal`**

Add:

- Header `编辑计划`.
- Week/day selector row.
- Selected-day card `周五计划`.
- Rest-day toggle off.
- Item list rows with type and target count.
- Ordering/menu affordance on rows.
- `新增栏目`, `取消`, and `保存计划`.

Expected: normal-day editing state is implementable and not dependent on drag-only sorting.

- [x] **Step 7: Fill `Mobile/Plan Editor Rest + Inherit`**

Add two stacked cards inside the phone frame:

- Rest card:
  - Title `休息日`.
  - Copy `当天不会生成打卡项目`.
  - Green moon/check visual.
- Inherit card:
  - Title `继承前一天`.
  - Copy `今日项目来自最近一个普通日`.
  - Button `基于前一天计划`.

Expected: rest and inherit states are both visible in the same specification screen.

- [x] **Step 8: Clear placeholders for mobile app screens**

Use `batch_design` to update the completed app-screen section and its children:

```js
U(mobileScreens, { placeholder: false })
```

Expected: no completed mobile app screen remains marked as placeholder.

### Task 3: Create iOS Widgets

**Files:**
- Modify: `AUI/PUI.pen`

- [x] **Step 1: Insert iOS widget section**

Add `iOS Widgets` under `Mobile Companion App`.

Create two widget frames:

- `iOS Widget Small`, size `158 x 158`.
- `iOS Widget Medium`, size `338 x 158`.

Expected: both frames appear below or beside the app-screen section.

- [x] **Step 2: Fill iOS small widget**

Add:

- Compact title `CPA`.
- Ring progress.
- Time `24:12`.
- Phase label `专注中`.

Expected: the small widget is Pomodoro-only.

- [x] **Step 3: Fill iOS medium widget**

Add:

- Left Pomodoro area with time and phase.
- Right today summary `今日 2/3`.
- Two short rows `番茄钟 2/4` and `看书 完成`.

Expected: the medium widget combines Pomodoro status with today-plan summary.

- [x] **Step 4: Clear placeholders for iOS widgets**

Use `batch_design` to mark the section complete.

Expected: iOS widget section has no placeholder flag.

### Task 4: Create Android Widgets

**Files:**
- Modify: `AUI/PUI.pen`

- [x] **Step 1: Insert Android widget section**

Add `Android Widgets` under `Mobile Companion App`.

Create two widget frames:

- `Android Widget 2x2`, size `160 x 160`.
- `Android Widget 4x2`, size `360 x 160`.

Expected: both Android widget frames are visually distinct from iOS widgets.

- [x] **Step 2: Fill Android 2x2 widget**

Add:

- Time `24:12`.
- Label `专注中`.
- Compact progress bar or ring.
- Small app mark.

Expected: widget reads as a compact timer card.

- [x] **Step 3: Fill Android 4x2 widget**

Add:

- Large time `24:12`.
- Label `专注中`.
- Today count `今日 2/3`.
- Two plan rows.
- Compact pause action.

Expected: widget reads as a rectangular Android companion card.

- [x] **Step 4: Clear placeholders for Android widgets**

Use `batch_design` to mark the section complete.

Expected: Android widget section has no placeholder flag.

### Task 5: Create Dynamic Island States

**Files:**
- Modify: `AUI/PUI.pen`

- [x] **Step 1: Insert Dynamic Island section**

Add `Dynamic Island` under `Mobile Companion App`.

Create:

- `Dynamic Island Compact`, size around `126 x 36`.
- `Dynamic Island Expanded`, size around `360 x 120`.

Expected: both states appear in the mobile design group.

- [x] **Step 2: Fill compact state**

Add:

- Black capsule background.
- Small orange or green phase dot/icon.
- Time `24:12`.

Expected: compact state reads as a live timer.

- [x] **Step 3: Fill expanded state**

Add:

- Black rounded expanded surface.
- Phase `专注中`.
- Time `24:12`.
- Progress indicator.
- Pause / continue controls.
- Today summary `今日 2/3`.

Expected: expanded state is a live activity, not a full app screen.

- [x] **Step 4: Clear placeholders for Dynamic Island**

Use `batch_design` to mark the section complete.

Expected: Dynamic Island section has no placeholder flag.

### Task 6: Verify Pencil Design

**Files:**
- Modify: `AUI/PUI.pen`
- Optional create: `/tmp/cpa-v2-mobile-companion.png`

- [x] **Step 1: Check layout problems**

Run `snapshot_layout` on the new `Mobile Companion App` node with:

```json
{
  "filePath": "/Users/xpy/Desktop/NanZhai/CPA_V2/.worktrees/phoneui/AUI/PUI.pen",
  "parentId": "<Mobile Companion App node id>",
  "problemsOnly": true,
  "maxDepth": 8
}
```

Expected: no clipped or overlapping layout problems that hide required content.

- [x] **Step 2: Screenshot the new group**

Run `get_screenshot` for the `Mobile Companion App` node.

Expected: screenshot shows all required surfaces:

- Five phone screens.
- Two iOS widgets.
- Two Android widgets.
- Compact and expanded Dynamic Island states.

- [x] **Step 3: Fix visual issues**

If text overflows, frames overlap, or required states are missing, adjust the relevant section with `batch_design` and repeat the screenshot.

Expected: all text is visible and all sections are readable.

- [x] **Step 4: Confirm existing desktop frames remain**

Run `batch_get` for:

```json
{
  "filePath": "/Users/xpy/Desktop/NanZhai/CPA_V2/.worktrees/phoneui/AUI/PUI.pen",
  "nodeIds": ["YRqeB", "KB3Vp", "s6g1w", "g9Gei"],
  "readDepth": 1
}
```

Expected: existing desktop source frames are still present.

### Task 7: Commit Pencil Changes

**Files:**
- Modify: `AUI/PUI.pen`
- Modify: `docs/superpowers/plans/2026-05-22-mobile-companion-app-design.md`

- [x] **Step 1: Review Git status**

Run:

```bash
git status --short
```

Expected: `AUI/PUI.pen` and this plan file are modified or added.

- [x] **Step 2: Commit**

Run:

```bash
git add AUI/PUI.pen docs/superpowers/plans/2026-05-22-mobile-companion-app-design.md
git commit -m "design: add mobile companion app pencil screens"
```

Expected: commit succeeds.

## Execution Result

- Added the `Mobile Companion App` board as an independent Pencil design group.
- Added five mobile app screens: focus timer, break timer, today plan, normal plan editor, and rest/inherit plan editor.
- Added iOS small/medium widgets, Android 2x2/4x2 widgets, and compact/expanded Dynamic Island states.
- Verified required node names through Pencil MCP and saved the Pencil document to disk.

## Self-Review

- Spec coverage: the plan covers mobile focus, break, today plan, normal editor, rest/inherit editor, iOS small/medium widgets, Android 2x2/4x2 widgets, Dynamic Island compact/expanded states, and verification.
- Placeholder scan: the plan contains no TBD or future-fill instructions.
- Scope check: this is a single Pencil design pass and does not include React, Tauri, account, room, or protocol implementation.
