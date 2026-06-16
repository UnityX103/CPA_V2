# Settings Plan Panel And Pet Removal Design

## Context

Pencil node `HnSHL` is the current Global Settings Panel reference. It keeps the existing rows for UI scale, autostart, check-in system, auto update, and binding keys, and adds a new row named `gspPlanPanel` with label `计划面板` and toggle `gsp-plan-panel-toggle`.

Pencil node `vnYnS` is the current Unified Settings Panel reference. Its sidebar now contains only three tabs: `番茄钟`, `联机`, and `全局`. The old `宠物` tab is no longer part of the design.

This supplements the item-level check-in plan work from `docs/superpowers/specs/2026-06-15-checkin-item-repeat-plan-design.md`.

## Default Decisions

1. Add a settings-domain boolean named `planPanelEnabled`.
2. Default `planPanelEnabled` to `true` for new installs and older persisted settings.
3. Keep `checkinEnabled` as the master switch for the check-in system.
4. Let `planPanelEnabled` control the visible/openable Today plan panel only.
5. Keep check-in plan data and records intact when `planPanelEnabled` is turned off.
6. Remove the Settings `pet` tab and `PetTab` UI from the current implementation.

## Behavior

The plan panel may open only when both settings are enabled:

```ts
checkinEnabled && planPanelEnabled
```

When `checkinEnabled` becomes false, the existing behavior remains: close both the today check-in panel and plan editor panel because the whole check-in feature is disabled.

When `planPanelEnabled` becomes false, close only the today check-in panel and stop automatic or manual attempts to open it. The plan editor and persisted plan template remain available through valid check-in flows while the master check-in switch is enabled.

Older local settings, bridge snapshots, and cloud/local user preference archives that do not contain `planPanelEnabled` hydrate with `true`.

## UI Mapping

`SettingsPanel` should match `vnYnS` by rendering exactly these tabs:

```ts
[
  { id: 'pomodoro', label: '番茄钟' },
  { id: 'online', label: '联机' },
  { id: 'global', label: '全局' },
]
```

`GlobalTab` should match `HnSHL` row order:

1. `界面缩放`
2. `开机自启动`
3. `打卡系统`
4. `计划面板`
5. auto update row
6. binding-key row

The `计划面板` row uses the same compact row styling as `打卡系统` and toggles `settings.planPanelEnabled`.

## Data Flow

`planPanelEnabled` belongs to the settings domain because it is a global UI visibility preference, not check-in plan content.

The field must be included in:

- settings store state, actions, persisted snapshot, and hydration;
- settings persistence load/save validation;
- user preferences snapshots and normalization;
- bridge snapshot and dispatch payloads;
- mirror/main settings dispatch so secondary windows receive the same value.

The field must not change check-in plan template items, repeat days, daily records, or migration behavior.

## Testing

Focused coverage should prove:

- settings defaults and hydration set missing `planPanelEnabled` to `true`;
- persistence saves and loads explicit `planPanelEnabled`;
- bridge host/client snapshots and dispatch apply the setting;
- user preferences/cloud archive snapshots preserve the setting;
- Settings panel no longer renders the `宠物` tab;
- Global settings renders and toggles `计划面板`;
- today check-in window opening is blocked when `planPanelEnabled` is false;
- disabling `checkinEnabled` still closes both check-in windows.

## Spec Self-Review

- Placeholder scan: no unresolved placeholders.
- Consistency check: `planPanelEnabled` controls only the Today plan panel; `checkinEnabled` remains the master switch.
- Scope check: this is one incremental settings/UI/bridge change and does not reopen the item-repeat plan model.
- Ambiguity check: old persisted data defaults are explicit, and pet removal is limited to the current Settings tab/UI entry.
