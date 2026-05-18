# Scaled Window Sizing

## Context

Global UI scale currently changes the rendered content size, but Tauri window sizes do not follow it. The Settings window shows the clearest failure: `.settings-scale-content` uses `zoom: var(--app-ui-scale)`, while the native window is still created at `460x440` and the root is intentionally `overflow: hidden`. At larger scales, the content grows past the fixed window boundary and gets clipped.

The same global setting affects more than one UI surface. The fix should cover every Tauri UI window that participates in global UI scale, not only the Settings window.

## Goals

- Make native window sizes follow `settings.uiScale` for all scaled Tauri UI windows.
- Keep `settings.uiScale` as the single source of truth.
- Preserve the dangerous Global Settings preview/apply/revert flow.
- Preserve each window's existing interaction model and position semantics.
- Prevent scaled windows from growing beyond the current monitor bounds.
- Keep the Settings window's existing scroll ownership: only the inner content area scrolls.

## Non-Goals

- Do not redesign the Global Settings UI.
- Do not change the dangerous-setting confirmation copy or timing.
- Do not couple RemoteRoster, video playback, or unrelated future windows into this pass.
- Do not add user-controlled persistent window-size preferences.
- Do not replace content scaling with a new visual scale system.

## Window Coverage

This pass covers the Tauri UI windows that currently participate in the app shell:

| Window label | Base size | Scaled size behavior | Position behavior |
| --- | ---: | --- | --- |
| `main` | `249x171` | width and height multiply by `uiScale` | preserve current position, clamp back inside monitor if needed |
| `settings` | `460x440` | width and height multiply by `uiScale` | recenter on the main window's current monitor |
| `input-counter` | `128x dynamic height` | width and current dynamic height multiply by `uiScale` | preserve current position, clamp back inside monitor if needed |

Input counter dynamic height remains derived from the visible binding-key pill count. The new sizing layer treats that value as the base height before scale is applied.

## Architecture

Add one shared scaled-window sizing layer instead of patching each window independently.

Frontend:

- Add a small hook/helper for scaled windows, for example `useScaledWindowSize`.
- The hook reads the mirrored `settings.uiScale`.
- The caller supplies the window label, base width, base height, and whether the window should recenter.
- The hook invokes a single Tauri command whenever the base dimensions or `uiScale` change.

Rust:

- Add one platform-neutral Tauri command, for example `resize_scaled_window`.
- The command accepts `{ label, baseWidth, baseHeight, scale, center }`.
- The command computes the target logical size, applies monitor constraints, calls `set_size`, then adjusts position according to the window's position behavior.
- The command no-ops when the target window does not exist.

This keeps platform differences and monitor math inside `src-tauri`, while React components only report the size they need.

## Data Flow

`settings.uiScale` remains the only scale input.

1. The main window loads persisted settings and hosts the source settings store as it does today.
2. Settings, input counter, and other mirrored windows receive `uiScale` through the existing bridge snapshots.
3. Each scaled window hook reacts to `uiScale` changes.
4. The hook invokes the shared resize command with the caller's base dimensions.
5. Rust computes the native window size and position.

During dangerous scale preview:

- Dragging the Global scale slider updates the effective `uiScale`.
- Every active scaled window previews the larger or smaller native size immediately.
- Applying the dangerous change keeps the scaled sizes.
- Cancelling or timing out reverts `uiScale`; the hooks request the old sizes again.

## Size And Bounds Rules

Target logical size:

```text
targetWidth = baseWidth * uiScale
targetHeight = baseHeight * uiScale
```

The command clamps the result with these rules:

- `uiScale` is still clamped by the settings store to the existing scale range.
- Target size must not exceed the current monitor's logical size minus a small edge margin, recommended as `24px`.
- Target size should not go below the window's existing minimum size.
- If monitor lookup fails, fall back to applying the unclamped target size and return no positioning error to the UI.

Position rules:

- `settings` recenters on the main window's current monitor after resize.
- `main` and `input-counter` preserve current top-left position.
- Preserved-position windows are clamped just enough to remain visible inside the monitor after resizing.

When a high scale still cannot fit all Settings content after monitor clamping, the existing `.settings-content-scroll` path remains responsible for vertical overflow. The shell, title, sidebar, and apply layer stay fixed.

## Error Handling

- Missing window label: return success without resizing.
- Invalid or non-finite dimensions: return an error and log from the frontend caller.
- Monitor lookup failure: resize only, skip recenter/clamp.
- Tauri resize or position failure: return the error string so the caller can log it.
- Repeated preview updates should be idempotent; repeated calls with the same dimensions should not change behavior.

## Tests

Rust unit tests:

- Computes scaled target size from base dimensions and scale.
- Clamps target size to monitor logical bounds with margin.
- Keeps minimum dimensions.
- Computes centered origin for Settings.
- Clamps preserved positions back inside the monitor.

Frontend tests:

- `App` requests a scaled resize for `main` when `uiScale` changes.
- `SettingsApp` requests a scaled resize for `settings` and marks it as centered.
- `InputCounterPanel` includes both visible binding count and `uiScale` in its resize request.
- Reverting a dangerous scale preview triggers a resize back to the previous scale.

Manual verification:

- Start the app with `./start.sh`.
- Open Settings, move Global scale to `1.5x`, then `2.0x`.
- Confirm the main, Settings, and input-counter windows grow with the preview.
- Confirm Settings remains usable and only the content area scrolls when screen bounds cap the window.
- Cancel or let the dangerous preview time out and confirm all active scaled windows return to the previous size.

