# Pomodoro Auto-Start Break Setting Design

**Date**: 2026-05-16
**Scope**: Update the Pomodoro settings design and behavior so focus completion does not automatically start the break by default. Users can opt into automatic break start from the Pomodoro settings panel.

## Goal

When a focus session ends, the app should enter the break phase with the break duration loaded, but the timer should be paused by default. The user starts the break manually. A Pomodoro setting named `自动开始休息` lets users restore the current automatic break-start behavior.

The visual source of truth is `AUI/PUI.pen`; this change must start there before frontend implementation.

## Pencil Design

Modify `Pomodoro Settings Panel` (`gs1Tv`) in `AUI/PUI.pen`.

- Add a new row under `pomoFooter` (`JpJcn`).
- Name the row `pomoAutoStartBreak`.
- Place it after `pomoEndAction` (`I6SsL5`) and before `pomoVideoCustom` (`Jvg0I`).
- Reuse the existing normal footer row shape: `cornerRadius: 16`, `fill: #F6F7F8`, `justifyContent: space_between`, `alignItems: center`, `padding: [14,16]`, `width: fill_container`.
- Left label text: `自动开始休息`.
- Right control: `Toggle Switch` (`NGo9f`), visually off by default.
- Do not restore the old `总轮次` row in this design pass.
- Keep `pomoVideoPath` (`WSnlp`) disabled/collapsed.

This keeps the new option in the regular settings group, matching the user's selected approach and avoiding a taller explanatory row.

## Frontend State

`autoStartBreak` already exists in `app/src/domain/pomodoro.ts`, but its default must change from `true` to `false` in both main-window and settings-window store creation.

The settings window must be able to view and edit `autoStartBreak`:

- Include `autoStartBreak` in `BridgeSnapshot.pomodoro`.
- Include it in settings mirror updates.
- Extend the Pomodoro dispatch surface so the settings window can apply the value back to the main window.
- Include the toggle in Pomodoro tab dirty-state calculation so changing only this option enables the Apply button.

The implementation can either extend `applySettings` to accept `autoStartBreak`, or add a narrowly named Pomodoro action for this setting. The preferred path is extending `applySettings`, because the current settings tab already batches Pomodoro changes behind the shared Apply button.

## Behavior

On focus completion:

- Always transition from `focus` to `break`.
- Always reset `remainingSeconds` to `breakDurationSeconds`.
- Set `isRunning` to the current `autoStartBreak` value.
- Keep clearing the local tick accumulator on every phase transition so the first break second is never shortened.

With the default setting off, the user sees the break phase ready to start and must press Start manually. With the setting on, focus completion immediately starts the break countdown.

## Tests

Update the minimum Pomodoro coverage:

- Default `autoStartBreak=false`: completing a focus interval enters `break`, loads full break duration, and leaves `isRunning=false`.
- `autoStartBreak=true`: completing a focus interval enters `break`, loads full break duration, and leaves `isRunning=true`.
- Existing accumulator regression still passes with `autoStartBreak=true`.
- Settings panel renders `自动开始休息` in the Pomodoro tab after the Pencil design is updated.
- Settings-window bridge tests cover snapshot and dispatch of `autoStartBreak`.

## Non-Goals

- Do not add a description/subtitle under the setting label.
- Do not add a separate confirmation dialog for starting break manually.
- Do not change break-to-focus behavior in this pass.
- Do not implement persistence changes unless the existing Pomodoro settings persistence path already requires updating for `applySettings`.
