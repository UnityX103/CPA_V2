# TODO Panel Design

Date: 2026-06-17

## Goal

Import the Pencil TODO panel into CPA_V2 as a real, test-covered feature. The panel shows a current task, a filtered TODO history, and controls for adding, completing, deleting, editing, and setting an item as the current task.

## Pencil Source

- `EzVnr`: TODO panel state group.
- `Ys03p`: expanded panel, 340 x 388.
- `rjt0c`: collapsed panel, 340 x 132.
- `jdmyz`: reusable `TodoItemRow` editing component.
- `SShOP`: completed and incomplete non-edit item instances.
- `oNq0G`: settings row currently labeled `计划面板`; relabel to `TODO面板` and use it as the TODO panel enable switch.

## Architecture

Add a dedicated TODO domain store instead of reusing the check-in store. The check-in system tracks repeatable daily completion counts, while TODOs are task records with editing state, time metadata, current-task promotion, and filter state.

The TODO store owns:

- `currentTaskTitle`: editable current execution text.
- `items`: TODO history records.
- `activeFilter`: `today`, `week`, or `other`.
- `expanded`: whether the panel renders `Ys03p` or `rjt0c`.
- actions for adding current task to TODO, toggling completion, deleting, editing, saving time/title, and setting an item as current.

Persist TODO state as part of the user preference archive so local storage and cloud sync restore it with other user-owned settings. Keep migrations tolerant: missing TODO data hydrates to an empty current task, expanded panel, `today` filter, and no items.

## Components

Create focused components:

- `TodoPanel`: top-level panel, visibility controlled by settings.
- `TodoCurrentTask`: current execution input plus add button.
- `TodoFilterTabs`: today/week/other filter control.
- `TodoItemRow`: one TODO history item, including non-edit and edit rendering.

Every current task and history row is represented by its own component instance. `TodoItemRow` maps the Pencil component states: non-edit incomplete/complete from `SShOP`, edit state from `jdmyz`.

Use the existing native CSS approach. The panel should follow the Pencil colors, spacing, rounded corners, and lucide icons from the node dump. The main app should render the TODO panel near the existing pomodoro panel without changing Tauri native window behavior.

## Behavior

The add button takes the non-empty current task text, creates a TODO item in the active filter bucket, assigns a local timestamp, and clears the current input.

Completion toggles each item between incomplete and complete. Completed rows keep the green check state and muted title styling from Pencil.

Delete removes the item immediately.

Edit opens row-level editing for title and start/end time. Saving is triggered by leaving edit mode or pressing the row edit control again.

Set current execution copies the item title into the current task field and leaves the source TODO item in history.

Filters show:

- `today`: items created for the local current date.
- `week`: items created during the current local week.
- `other`: items outside the current local week.

## Settings

Replace the global settings row label `计划面板` with `TODO面板`. The existing `planPanelEnabled` setting should be renamed in UI only if a full domain rename would cause avoidable churn; otherwise the persisted key can remain as a compatibility alias while the displayed behavior becomes TODO panel visibility.

## Testing

Add focused Vitest coverage:

- TODO store default state, add, complete, delete, edit, and set-current actions.
- `TodoPanel` renders expanded and collapsed states.
- UI interactions for add, complete, delete, edit, set-current, and filter switching.
- `App` hides the panel when the TODO switch is off.
- User preference hydrate/build includes TODO data and tolerates missing TODO snapshots.

## Non-Goals

- No separate native Tauri window for TODO in this iteration.
- No server protocol changes.
- No multi-device conflict resolution beyond the existing user preference sync model.
- No reminders, notifications, recurring tasks, or drag sorting.

## Self-Review

- No placeholders remain.
- The design keeps TODO separate from check-in data and avoids protocol changes.
- The persistence decision is explicit: TODO is part of user preferences and cloud sync.
- The settings compatibility behavior is explicit to avoid breaking existing persisted archives.
