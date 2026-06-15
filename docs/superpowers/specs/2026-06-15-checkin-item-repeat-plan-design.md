# Check-in Item Repeat Plan Design

**Date**: 2026-06-15
**Status**: Approved by delegated default policy
**Design source**: `AUI/PUI.pen` node `g9Gei`, reusable `s6g1w` (`Check-in Plan Editor Panel`)

## Context

The existing check-in system is built around `WeeklyCheckinPlan.days`: each weekday is edited as `inherit`, `rest`, or an explicit item list. The new Pencil design under `g9Gei` changes the plan editor model. The editor now says each check-in item can set its own repeat cycle, and `s6g1w` contains an `item-repeat-content-card` where each item row switches between two row-local states:

- `周期`: choose repeat days for that item.
- `次数`: edit count-related metadata for that item.

The product direction is no longer "edit what each day contains". It is "edit each thing, including which weekdays it repeats on".

## Goals

- Replace the day-owned weekly plan model with an item-owned repeat plan model.
- Update the plan editor to match Pencil node `s6g1w`.
- Keep the today panel driven by effective items for the current weekday.
- Preserve existing daily completion records by continuing to key records by `date + itemId`.
- Normalize old `WeeklyCheckinPlan` snapshots into the new template model.
- Keep local preference, cloud account data, and bridge snapshots consistent.

## Non-Goals

- No historical plan editor.
- No multi-template scheduling.
- No server room protocol change.
- No new native Tauri commands.
- No direct reads of the encrypted `.pen` file; Pencil MCP remains the only design access path.

## Selected Architecture

Use a single current check-in template owned by `app/src/domain/checkin.ts`.

```ts
type CheckinRepeatDay = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';
type CheckinEditMode = 'cycle' | 'count';

interface CheckinPlanItem {
    id: string;
    title: string;
    type: 'manual' | 'pomodoroFocus';
    targetCount: number;
    icon?: CheckinItemIcon;
    repeatDays: CheckinRepeatDay[];
    editMode: CheckinEditMode;
    perUseAmount?: number;
    perUseUnit?: string;
    countInputValue?: number;
    countUnitSize?: number;
    countUnitLabel?: string;
    countLoopCount?: number;
}

interface CheckinPlanTemplate {
    schemaVersion: 2;
    items: CheckinPlanItem[];
    carryToNextWeek: boolean;
}
```

`CheckinState` stores `planTemplate`, `dailyRecords`, and `lastError`. Existing public selectors stay conceptually stable, but are renamed or adapted around the new source:

- `itemsForDate(state, date)` filters `planTemplate.items` by `weekdayForDate(date)`.
- `dailySummary(state, date)` uses those effective items.
- `weeklySummary(state, weekStartDate)` evaluates each calendar day by filtering repeated items.
- `streakSummary(state, today)` treats days with no effective items as complete days.

## Day Semantics

If no item repeats on a date, the today panel displays `今日无计划`. This is not a rest day. It counts as 100% complete for daily, weekly, and streak summaries because there is nothing due.

The old explicit rest-day concept is removed from the plan editor. A user creates a no-plan day by making sure no item repeats on that weekday.

## Editor Behavior

`CheckinPlanEditorPanel` works against a cloned template draft. Save commits the draft; cancel discards it.

The panel maps to the new `s6g1w` hierarchy:

- Header: `计划编辑`.
- Content card: `打卡计划项目`.
- Add button: `新增项目`.
- Each row maps to `Component/RepeatPlanItemRow`.
- Apply row keeps `取消` and `保存计划`.

Each item row has:

- Icon and item copy.
- A `周期 / 次数` segmented control stored as `editMode`.
- A grip/action affordance for row actions.

In `周期` mode, the row shows a cycle label and seven weekday pills. Toggling a pill adds or removes that weekday from `repeatDays`. The default new item repeats every day.

In `次数` mode, the row shows `输入值`, `每轮次数`, and `循环次数`. These fields are stored and displayed, but they do not automatically compute `targetCount`. The today panel continues to use the item's independent `targetCount` for `+1` completion progress.

## Today Panel Behavior

`TodayCheckinPanel` renders effective items for today:

- At least one item: current progress, item rows, and `+1` actions.
- No items: `今日无计划`, a compact explanation, and the edit button.

Pomodoro completion increments every effective `pomodoroFocus` item for the date, once per Pomodoro end-event id as today. If no `pomodoroFocus` item repeats today, the Pomodoro completion does not write a check-in count.

## Persistence And Migration

The canonical local and cloud check-in payload becomes:

```ts
checkin: {
    planTemplate: CheckinPlanTemplate;
    dailyRecords: Record<string, DailyCheckinRecord>;
}
```

Older `schemaVersion: 1` check-in snapshots are accepted. Migration converts `WeeklyCheckinPlan.days` into an item template:

1. Resolve each weekday's effective old item list using the previous inherit rules.
2. Skip old `rest` weekdays.
3. Group compatible items by stable identity: type, title, icon, per-use metadata, and target count.
4. Merge each group into one `CheckinPlanItem` with the union of weekdays in `repeatDays`.
5. Preserve item ids where possible so existing `dailyRecords.countsByItemId` remain useful.
6. If an id conflict appears between incompatible old items, keep the first id and mint stable derived ids for later groups.

Malformed v2 templates fall back to defaults for the invalid section rather than blocking startup.

## Bridge And Cloud Sync

`BridgeSnapshot.checkin` carries `planTemplate`, `dailyRecords`, and `lastError`. The check-in dispatch action changes from `setWeeklyPlan` to `setPlanTemplate`.

`userPreferences.ts`, `checkinPersistence.ts`, and `cloudAccountData.ts` normalize both legacy weekly plans and new templates. Cloud conflict handling keeps the latest server template and continues to merge `dailyRecords` by maximum counts plus unioned Pomodoro event ids.

## Error Handling

- Empty `repeatDays` is valid and means the item is currently inactive.
- Invalid weekday values are dropped.
- Invalid numeric metadata is clamped to non-negative integers.
- Blank titles fall back to `新项目` or `专注番茄`.
- Unknown icon keys are dropped and resolved through the existing default icon behavior.
- More than one `pomodoroFocus` item may exist if the user creates them intentionally; Pomodoro completion applies to all effective Pomodoro items for that date.

## Testing

Domain tests:

- Default template produces effective items for today.
- `itemsForDate` filters items by `repeatDays`.
- No-plan days produce 100% daily completion without rest semantics.
- Weekly summaries count no-plan days as complete and include only due item targets.
- Pomodoro completion increments effective `pomodoroFocus` items once per end-event id.
- v1 weekly plans migrate into v2 item templates with repeated weekdays merged.

Persistence and sync tests:

- Local check-in persistence loads and saves v2 templates.
- Legacy v1 snapshots normalize into v2 templates.
- User preferences build, hydrate, and normalize `planTemplate`.
- Cloud data conflict merge preserves server template and merges daily records.
- Bridge snapshots and dispatch use `planTemplate` and `setPlanTemplate`.

UI tests:

- Editor renders item rows instead of day selector/rest/inherit UI.
- Weekday pills edit `repeatDays` only in the draft until save.
- Mode toggle switches between `周期` and `次数`.
- Count metadata edits are saved but do not change `targetCount`.
- Cancel discards draft edits.
- Today panel renders `今日无计划` for a weekday with no effective items.

Manual verification:

- Compare the editor against Pencil `s6g1w`.
- Confirm the today panel still renders normal items and the no-plan state.
- Save a plan, restart, and confirm the repeat days and count metadata persist.
- Complete a focus Pomodoro and confirm only today's effective Pomodoro items increment.

## Spec Self-Review

- Placeholder scan: no unresolved placeholders remain.
- Internal consistency: the selected model, UI behavior, persistence, bridge, and tests all use `planTemplate`.
- Scope check: this is one focused model and editor migration; no historical planning or server room protocol work is included.
- Ambiguity check: no-plan days are explicitly not rest days, and count metadata explicitly does not compute `targetCount`.
