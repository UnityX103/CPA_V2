# Check-in Editor Inherit and Context Menu Design

Date: 2026-05-22

Scope: `app/src/ui/CheckinPlanEditorPanel.tsx`, `app/src/ui/CheckinPlanEditorPanel.css`, `app/src/ui/CheckinPlanEditorPanel.test.tsx`, `app/src/domain/checkin.ts`, and `AUI/PUI.pen`.

Design source: `AUI/PUI.pen` reusable node `s6g1w` (`Check-in Plan Editor Panel`) and item-row action node `Cpdxm`.

## Goal

The plan editor should make three states explicit:

- A normal day has its own editable items.
- A rest day hides items.
- An empty ordinary day can inherit the nearest previous day plan.

The row action on the right, currently represented by Pencil node `Cpdxm`, should become the ordering affordance. Deleting a plan item moves to a row context menu opened by right-click.

When the selected day has no custom items, the editor should show a button for inheriting the previous day plan. Once clicked, the panel should show that the day is inheriting the previous day. If the user then adds a column, the day automatically stops inheriting and becomes its own editable item plan.

## Recommended Approach

Use `CheckinDayPlan.kind === 'inherit'` as the source of truth for inherited days.

This matches the existing domain model and avoids inventing a second UI-only inheritance flag. The editor draft already stores day plans locally until save, so inheritance can be edited without touching the persisted plan until the user saves.

Alternatives considered:

- Treat an empty `items` plan as inherited. This is visually simple but ambiguous because an intentionally empty day and an inherited day would look the same in persisted data.
- Copy previous-day items into the current day when the user clicks inherit. This makes the UI easy, but it destroys the link to the previous day and would not reflect later edits to that previous day.

## Interaction Design

### Row ordering and delete

`Cpdxm` remains on the far right of each item row and visually uses the grip icon. It should no longer delete the row.

The implementation should expose order controls through this affordance. The first pass can use a compact menu or buttons for moving the item up and down. Drag sorting is not required for this pass because the existing code has no sortable list behavior and a deterministic up/down action is easier to test.

Deleting an item should be available from a right-click context menu on the item row:

- Right-click a row opens a small menu near the pointer.
- The menu contains `删除栏目`.
- Selecting `删除栏目` removes that item from the draft.
- Clicking elsewhere, selecting another row, switching days, toggling rest day, saving, or canceling closes the menu.

Keyboard and test accessibility should remain button/menu based. The delete action may also be reachable from the row action menu if implementation finds that right-click-only deletion is too hidden for accessibility, but the visible standalone delete button should be removed.

### Inherit empty state

For `selectedPlan.kind === 'inherit'`, the day content card should render an inheritance state instead of the editable item list:

- Title: selected day content, such as `周二内容`.
- Badge: `已继承前一天`.
- Primary empty-state message: `已继承前一天计划`.
- Supporting text: explain that today's visible check-in items come from the nearest previous ordinary plan.
- Button: `基于前一天计划`.

Clicking `基于前一天计划` keeps the draft day as `{ kind: 'inherit' }` and sets a local UI acknowledgement so the panel clearly shows `已继承前一天计划`.

For an ordinary item day with `items.length === 0`, show a similar empty-state action:

- Message: `还没有当天专属项目`.
- Button: `基于前一天计划`.

Clicking the button changes that day to `{ kind: 'inherit' }`.

### Adding items cancels inheritance

Clicking `新增栏目` while the selected day is inherited should automatically change the selected day to `{ kind: 'items', items: [] }` before opening the type chooser.

After the user chooses `番茄钟` or `通用`, the new item is added to that independent item list. This means adding an item always expresses intent to customize the current day.

### Rest day precedence

The rest-day toggle remains highest priority:

- Turning rest day on sets `{ kind: 'rest' }` and closes context menus and icon pickers.
- Turning rest day off sets an empty item plan, not an inherited plan, preserving the existing explicit-edit behavior.

## Pencil Design Changes

Update `s6g1w`:

- Keep `Cpdxm` as a grip/order affordance and align its naming with ordering rather than deletion.
- Add a context-menu visual variant near an item row showing `删除栏目`.
- Add an inherited-state visual variant of the day-content card with `已继承前一天计划` and `基于前一天计划`.
- Update copy so empty inherited days are described as inherited, not merely "未填写".

The existing rest-state instance `EPCaA` should remain as the rest-day variant. A new nearby instance can demonstrate the inherited state without replacing the default editor component.

## Data Flow

The editor continues to work against a cloned draft:

1. Opening the editor clones `weeklyPlan`.
2. Row reorder, delete, inherit, rest, and add operations mutate only the draft.
3. Save normalizes item plans and calls `setWeeklyPlan`.
4. Cancel discards the draft.

No bridge or persistence schema changes are required because `CheckinDayPlan` already supports `inherit`.

## Error Handling

If a user opens a context menu and then performs another operation, close the menu before applying the operation.

If the previous effective plan is empty, inherited days still remain valid and resolve to an empty list through existing `effectivePlanForDate` behavior.

## Tests

Update `CheckinPlanEditorPanel.test.tsx` to cover:

- `Cpdxm` no longer deletes a row.
- Reordering moves an item up or down in the draft and saves the new order.
- Right-clicking an item row opens a menu with `删除栏目`.
- Choosing `删除栏目` removes the item only from the draft until save.
- An inherited selected day shows the inherited empty state.
- Clicking `基于前一天计划` turns an empty item day into `kind: 'inherit'`.
- Clicking `新增栏目` from an inherited day creates an independent item day and adds the chosen item.
- Switching days, rest toggle, save, and cancel close any open context menu.

Domain tests are only needed if implementation changes `effectivePlanForDate`; the preferred approach should not require domain behavior changes.

## Non-goals

- No drag-and-drop sorting in this pass.
- No multi-select item deletion.
- No historical plan inheritance.
- No persistence schema migration.
- No server protocol change.

## Approval Notes

Default decisions used for this spec:

- Visual companion declined.
- Use the existing `inherit` domain state.
- Make right-click deletion the primary deletion path.
- Use deterministic up/down ordering rather than drag sorting for the first pass.
- Preserve rest-day behavior as explicit and non-inherited when toggled off.
