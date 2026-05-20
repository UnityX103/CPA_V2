# Daily Check-in Panels Design

**Date**: 2026-05-20  
**Status**: Approved by delegated defaults  
**Design source**: `AUI/PUI.pen` node `g9Gei` (`Daily Check-in Panels`), including `KB3Vp` (`Today Check-in Panel`) and `s6g1w` (`Check-in Plan Editor Panel`)

## Context

The Pencil design now contains a complete daily check-in module:

- A compact `Today Check-in Panel` for day-to-day completion.
- A larger `Check-in Plan Editor Panel` for editing the current week.
- A rest-day variant for the editor.

The app already has a proven independent-window pattern for panels such as the input counter: the main window owns domain state and mirror windows render focused UI through the bridge. The check-in module should use the same architecture rather than embedding the feature in the Pomodoro panel or Settings panel.

## Goals

- Pixel-sync the new check-in module from Pencil into CPA_V2.
- Add a `today-checkin` independent window for the compact daily panel.
- Add a `checkin-editor` independent window for editing the current weekly plan.
- Persist the current weekly plan and daily check-in records locally.
- Link Pomodoro completion to check-in items of type `pomodoroFocus`.
- Summarize the future analysis panel requirements and data contracts without implementing that panel in this pass.

## Non-Goals

- No analysis panel UI in this implementation pass.
- No cloud sync or WebSocket protocol changes.
- No historical weekly plan editor.
- No input-counter or mouse-counter check-in item type.
- No changes to the main Pomodoro window size or layout.

## Recommended Architecture

Create a new `checkin` domain module. The main window is the source of truth:

- `app/src/domain/checkin.ts` owns the store, derived selectors, and actions.
- `app/src/domain/checkinPersistence.ts` reads and writes local persisted snapshots.
- `App.tsx` hydrates check-in state on startup and mounts a check-in window controller.
- Mirror windows receive `checkin` snapshots through `bridge`.
- Mirror windows dispatch check-in actions back to the main window through `bridge`.

Two independent Tauri windows render focused UI:

- `today-checkin` renders only `TodayCheckinPanel`.
- `checkin-editor` renders only `CheckinPlanEditorPanel`.

This follows the existing bridge and independent-window model used by `input-counter`, keeping multi-window state predictable and keeping the main Pomodoro panel small.

## Data Model

The store should separate plan definitions from daily records.

```ts
type CheckinItemType = 'manual' | 'pomodoroFocus';

type CheckinItem = {
    id: string;
    title: string;
    type: CheckinItemType;
    targetCount: number;
};

type WeekdayKey = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

type CheckinDayPlan =
    | { kind: 'inherit' }
    | { kind: 'rest' }
    | { kind: 'items'; items: CheckinItem[] };

type WeeklyCheckinPlan = {
    weekStartDate: string;
    days: Record<WeekdayKey, CheckinDayPlan>;
    carryToNextWeek: boolean;
};

type DailyCheckinRecord = {
    date: string;
    countsByItemId: Record<string, number>;
    processedPomodoroEndEventIds: number[];
};
```

The persisted snapshot should include `schemaVersion: 1`, the current `weeklyPlan`, and `dailyRecords`. Use ISO local dates (`YYYY-MM-DD`) for records.

## Plan Rules

The first version uses one current weekly plan.

- The user edits the current week.
- If `carryToNextWeek` is on, a new week starts from the current plan when the app detects a future week.
- Older weekly plans are not editable in this pass.

`inherit` is resolved at read time. A day with no explicit items uses the nearest previous non-inherit ordinary day. The completion record remains tied to the actual calendar date. This avoids hidden copy operations when saving plans.

`rest` has the highest priority:

- No check-in items are generated for that day.
- The day is excluded from weekly target totals.
- The day is excluded from completion-rate and streak calculations.
- The today panel shows a compact rest state derived from the editor rest-state styling, with no item rows.

## Pomodoro Integration

When the Pomodoro store emits a new end event where `fromPhase === 'focus'`, the check-in store should increment every effective item for today whose type is `pomodoroFocus`.

The action must be idempotent. Store each processed Pomodoro end-event id in today's record and ignore repeats. This protects against React effect re-runs, mirror-window reloads, and bridge replay.

Manual item counts change only through explicit `+1` actions in the today panel.

## Window Behavior

`today-checkin`:

- Transparent, decorationless, skip taskbar, draggable.
- Always on top by default, matching the app's companion-window behavior. No pin button is added unless a later Pencil update adds one.
- Base width: `278`, matching `KB3Vp`.
- Height follows effective item count and UI scale.
- Uses `useScaledWindowSize`.
- Does not resize or reposition the main Pomodoro window.
- Remains visible on rest days so the user can still open the editor.

`checkin-editor`:

- Transparent, decorationless, skip taskbar, draggable.
- Base width: `460`, matching `s6g1w`.
- Base height follows the normal editor design (`898` in Pencil), but clamps to monitor bounds through `scaled_window`.
- If clamped, the editor content scrolls inside the panel body; the outer transparent window remains stable.
- Opens from the today panel's edit button.
- Uses an editor draft: opening copies the current weekly plan into local component state, save dispatches the new plan, cancel discards the draft.

The main app should build the windows hidden during setup if that keeps first-mouse and platform hooks consistent with existing windows. Otherwise, lazy creation is acceptable if the same hooks are installed before first display.

## Pixel-Sync Requirements

Implement React/CSS directly against the Pencil hierarchy:

- `TodayCheckinPanel` maps to `KB3Vp`.
- `CheckinPlanEditorPanel` maps to `s6g1w`.
- Rest-state editor rendering maps to the `EPCaA` instance under `g9Gei`.

The first implementation should preserve:

- Panel dimensions and corner radii.
- `MaokenAssortedSans` typography.
- Orange incomplete state and green complete/rest state.
- Item row structure, status pills, progress bar, and `+1` buttons.
- Editor week selector, selected-day rest toggle, item rows, copy hints, and save/cancel row.

The implementation may use local CSS classes rather than generated markup, but visible hierarchy and spacing should stay close to the design.

## Analysis Panel Summary

This pass should document the data needed by a future analysis panel, but should not build that panel.

Future analysis panel capabilities:

- Daily completion rate excluding rest days.
- Weekly completion rate excluding rest days.
- Consecutive completed-day streak excluding rest days.
- Per-item completion history.
- Manual vs Pomodoro-driven completion totals.
- Missed-day list for non-rest days.
- Current-week summary: planned items, completed items, rest days, and remaining targets.

The check-in store should expose pure selectors so the future panel can consume the same definitions:

- `effectivePlanForDate(date)`
- `recordForDate(date)`
- `dailySummary(date)`
- `weeklySummary(weekStartDate)`
- `streakSummary(today)`

The analysis panel should not need to read component-local draft state.

## Error Handling

- If persistence load fails, use the default current-week plan and log a warning.
- If persistence save fails, keep in-memory edits and expose a `lastError` field for UI follow-up.
- If an inherited day cannot find a previous ordinary day, use an empty item list.
- If a stored item id no longer exists in the effective plan, keep the record data but ignore it in active progress calculations.
- If a malformed bridge snapshot arrives, ignore it through the existing bridge version guard.

## Testing

Domain tests:

- Default weekly plan produces an effective plan for today.
- `inherit` resolves from the previous non-inherit ordinary day.
- Rest days produce no items and are excluded from daily and weekly summaries.
- Manual `incrementItem` updates only today's record.
- Pomodoro focus completion increments every `pomodoroFocus` item once per end-event id.
- Week rollover creates the next current plan when `carryToNextWeek` is enabled.

Bridge tests:

- `BridgeSnapshot` includes `checkin`.
- Mirror windows apply check-in snapshots.
- Dispatch routes check-in actions to the main store.

UI tests:

- `TodayCheckinPanel` renders incomplete, complete, and compact rest states.
- `+1` dispatches the correct item action.
- The edit button opens `checkin-editor`.
- `CheckinPlanEditorPanel` edits a draft and only saves on explicit save.
- Rest-day toggle replaces item editing with the rest state.

Window configuration tests:

- Capabilities allow `today-checkin` and `checkin-editor`.
- Rust builds hidden or lazy independent windows with transparent, decorationless configuration.
- Main window dimensions remain unchanged.

Manual verification:

- Compare both panels against Pencil screenshots.
- Confirm UI scale changes resize both check-in windows.
- Confirm a focus Pomodoro completion increments today's Pomodoro check-in item once.
- Relaunch the app and confirm plan and records persist.
