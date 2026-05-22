# Mobile Companion App Design

Date: 2026-05-22

Status: Draft for user review

Design source: `AUI/PUI.pen`, extending the existing CPA visual system and existing Pomodoro / daily check-in / check-in editor designs.

## Goal

Create a mobile companion design set directly in `AUI/PUI.pen`.

The mobile design is a focused companion experience rather than a full account or room-management app. It must include:

- Pomodoro mobile screens.
- Today plan panel.
- Plan editor panel.
- iOS small and medium widgets.
- Android 2x2 and 4x2 widgets.
- Dynamic Island compact and expanded notification states.

The design should be detailed enough to guide implementation later. It should not replace or mutate the existing desktop components.

## Chosen Direction

Use a `Mobile Companion App` design group placed near the existing `Daily Check-in Panels` area in Pencil.

The visual style follows the current CPA design language:

- Warm white translucent panels.
- Orange focus state.
- Green break, complete, and rest state.
- MaokenAssortedSans typography.
- Soft rounded surfaces around 20-28 px for app panels and 12-18 px for rows.
- Compact, information-first layout with no marketing-style hero section.

The mobile app uses a light navigation model. It does not need a full tab bar. The first screen exposes the two core areas: Pomodoro and today plan.

## Non-Goals

- No complete login, account, room, or multiplayer flow.
- No native iOS or Android style rewrite.
- No desktop component redesign.
- No implementation code in this design pass.
- No cloud sync protocol changes.
- No exhaustive widget size matrix beyond the chosen four widgets.

## Pencil Structure

Add a new top-level frame:

- `Mobile Companion App`

Inside it, create these sections:

- `Mobile App Screens`
- `iOS Widgets`
- `Android Widgets`
- `Dynamic Island`

The new group should be placed in empty canvas space near `Daily Check-in Panels`, with enough spacing to avoid overlap. Existing top-level frames and reusable desktop components should remain intact.

## Mobile App Screens

Use `390 x 844` as the phone baseline size.

### Mobile/Home Focus

Purpose: default mobile home screen during a focus session.

Content:

- Status bar treatment at the top.
- Header with app name or short product label.
- Sync status pill such as `已同步 · MacBook` or `离线可用`.
- Main Pomodoro card.
- Large circular progress or ring progress.
- Phase label: `专注中`.
- Remaining time.
- Primary start / pause control.
- Secondary next-step text such as next break length.
- Today plan summary card with up to three visible plan items.
- Button or row affordance to open the full today plan.

State:

- Orange is the dominant state color.
- The Pomodoro card is the primary visual element.
- Today plan is secondary but visible in the first viewport.

### Mobile/Home Break

Purpose: home screen during break.

Content:

- Same page structure as `Mobile/Home Focus`.
- Phase label changes to `休息中`.
- Remaining time uses the break timer.
- Green state color replaces orange in progress and key badges.
- A next-focus hint is visible.

State:

- The design must clearly distinguish break from focus without changing the whole app structure.

### Mobile/Today Plan

Purpose: focused daily check-in panel.

Content:

- Date and daily progress summary.
- Completion status pill.
- Progress bar.
- Plan item rows.
- Each row shows icon, title, current count, target count, status, and `+1` affordance.
- Edit-plan entry.

States shown:

- At least one incomplete manual item.
- At least one completed item.
- At least one Pomodoro-driven item.

Rules:

- Keep the row structure aligned with the existing `Today Check-in Panel`.
- The phone layout can be taller and more readable than the desktop compact panel.

### Mobile/Plan Editor Normal

Purpose: edit a normal plan day.

Content:

- Header with `编辑计划`.
- Week/day selector.
- Selected-day card.
- Rest-day toggle.
- Item list.
- Item rows show title, type, target count, and ordering/menu affordance.
- Add item button.
- Save and cancel action row.

Rules:

- The mobile editor should prioritize readability over fitting everything above the fold.
- It may use vertical scrolling as an implementation assumption.
- Sorting is represented as deterministic up/down or menu actions, not drag-only behavior.

### Mobile/Plan Editor Rest + Inherit

Purpose: capture states that are easy to miss in implementation.

Content:

- One rest-day state where item editing is hidden and the page explains that the day does not generate check-in items.
- One inherit state where the day inherits the nearest previous ordinary day.
- A `基于前一天计划` action for the inherit state.

Rules:

- Rest state has priority over inheritance.
- Turning off rest day returns to an editable ordinary day.
- Adding an item from an inherited day implies customization of that day.

## iOS Widgets

Use CPA visual language, not strict native iOS styling. The widgets should still respect common iOS widget proportions.

### iOS Small Widget

Purpose: quick Pomodoro status.

Content:

- App/pet mark or compact title.
- Circular or ring progress.
- Remaining time.
- Phase label.

State:

- Focus state is the primary example.

### iOS Medium Widget

Purpose: Pomodoro status plus today plan summary.

Content:

- Pomodoro progress and remaining time on one side.
- Today completion summary on the other side.
- Up to two plan rows or one concise completion line.

State:

- Show an active focus session with partial daily progress.

## Android Widgets

Use the same CPA colors and typography, but give Android widgets a slightly more rectangular card feel.

### Android 2x2 Widget

Purpose: compact Pomodoro status.

Content:

- Remaining time.
- Phase label.
- Progress ring or compact bar.
- Small app mark.

### Android 4x2 Widget

Purpose: Pomodoro status plus today plan summary.

Content:

- Large remaining time.
- Focus / break label.
- Today completion count.
- Two short plan rows.
- Compact action affordance for start / pause.

## Dynamic Island

Create a small section for iPhone Dynamic Island notification states.

### Compact State

Content:

- Capsule black background.
- Small focus or break icon.
- Remaining time.

### Expanded State

Content:

- Current phase.
- Remaining time.
- Progress indicator.
- Pause / continue affordance.
- Today completion summary such as `今日 2/3`.

Rules:

- The expanded state should read like a live activity for the current Pomodoro, not a full app panel.
- Orange focus and green break variants can be shown with labels or paired examples.

## Sync Treatment

The mobile design includes only light sync status.

Allowed examples:

- `已同步 · MacBook`
- `离线可用`
- `等待同步`

The design should not include:

- Login forms.
- Room code input.
- Member roster.
- Multiplayer card UI.

This preserves the current cloud-sync direction without expanding the mobile design into account management.

## Relationship To Existing CPA_V2 Design

Reuse visual concepts from existing Pencil components:

- `pomodoroPanel` for timer hierarchy.
- `Today Check-in Panel` for daily plan rows and completion language.
- `Check-in Plan Editor Panel` for normal, rest, and inherit plan semantics.
- Existing button, toggle, and pill styles where practical.

The mobile screens can be new frames rather than connected component instances when direct reuse would make the layout cramped. The visible hierarchy and semantics should stay aligned with the existing desktop components.

## Error And Empty States

The design should include enough visual cues for later implementation:

- Offline status is allowed but non-blocking.
- Rest day has a positive green empty state.
- Inherited day explicitly says it inherits the previous day.
- Empty ordinary day can offer `基于前一天计划`.
- No destructive state needs a confirmation dialog in this design pass.

## Implementation Notes For Later

This design is a Pencil-only pass. Later implementation can decide whether the mobile UI becomes:

- A responsive web/mobile shell.
- A separate mobile companion client.
- A staged prototype in the existing React app.

The design should not assume Tauri mobile support in this pass.

## Verification

After Pencil editing, verify:

- No new frames overlap existing top-level frames.
- All text is visible and fits inside its parent.
- The mobile screens show focus, break, today plan, normal editor, rest, and inherit states.
- iOS and Android widget sections each include the agreed two sizes.
- Dynamic Island includes compact and expanded states.
- Existing desktop design frames are still present and visually unchanged.

## Self-Review

- The scope is limited to Pencil design and a later implementation-ready spec.
- The mobile product direction is a focused companion, not a full account or multiplayer app.
- Required surfaces are explicitly listed.
- Platform widgets and Dynamic Island are included without expanding into full native platform design systems.
- Existing desktop components remain untouched.
