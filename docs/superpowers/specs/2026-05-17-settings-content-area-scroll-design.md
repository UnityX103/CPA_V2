# Settings Content Area Scroll Design

**Date**: 2026-05-17
**Project**: CPA_V2 Tauri rewrite
**Scope**: Make the Settings window shell fixed-height while only the Pencil `contentArea` node (`2RdBk`) scrolls.

## Context

The Pencil source of truth has `Unified Settings Panel` (`vnYnS`) with a fixed panel shell. Inside it, `body` (`3kLAl`) contains the sidebar and `content` (`NCXdZ`). The active settings panel is mounted as `contentArea` (`2RdBk`) under `NCXdZ`, with the shared Apply overlay (`EkvuW`) as a sibling.

The current React/CSS implementation already has per-tab `.settings-content-scroll` containers, but the outer settings window root still allows scrolling. That makes the whole Settings surface eligible to scroll instead of treating `2RdBk` as the only scrollable viewport.

The selected approach is **A: minimal semantic alignment**. Keep the existing structure, but tighten overflow ownership so the shell is fixed and scroll belongs to the `2RdBk` area.

## Goals

- Keep the Settings window shell fixed to the Tauri settings window height.
- Prevent the outer settings root and scale wrapper from scrolling.
- Preserve header, sidebar tabs, and the Apply overlay as non-scrolling UI.
- Make only the `2RdBk / contentArea` equivalent scroll when active tab content exceeds available height.
- Keep the change small and local to Settings layout CSS and layout guards.

## Non-Goals

- Do not redesign all Settings tabs.
- Do not change Pomodoro, Online, Pet, or Global settings behavior.
- Do not change the shared Apply overlay behavior except as needed to keep it fixed above scrollable content.
- Do not change native Tauri window creation unless a CSS-only solution proves insufficient.
- Do not replace the current tab components with a full DOM hierarchy rewrite.

## Design

The fixed shell is owned by the settings window root and panel:

- `.settings-window-root` fills the viewport and uses `overflow: hidden`.
- `.settings-scale-content` fills the root height and does not create a document-level scroll container.
- `.settings-panel` remains `width: 100%` and `height: 100%`.
- `.settings-body` keeps `min-height: 0` and `overflow: hidden` so children can shrink without forcing shell scroll.

The scroll viewport is owned by the content area:

- `.settings-content` remains the `NCXdZ` positioning context for the active content and `SettingsApplyRow`.
- The active tab's `.settings-content-scroll` remains the practical React equivalent of Pencil node `2RdBk`.
- `.settings-content-scroll` keeps `flex: 1`, `min-height: 0`, and `overflow-y: auto`.
- The Apply row stays an absolute sibling inside `.settings-content`, so it does not scroll with tab content.

This keeps the implementation close to the existing DOM while matching the Pencil hierarchy:

```text
settings-window-root         fixed, no scroll
  settings-scale-content     fixed, scaled content wrapper
    settings-panel           fixed shell
      settings-head          fixed header
      settings-body          clipped body
        settings-nav         fixed sidebar
        settings-content     NCXdZ, fixed positioning context
          settings-content-scroll 2RdBk equivalent, scroll viewport
          apply-row          EkvuW equivalent, fixed overlay
```

## Testing

Update CSS/layout guard tests in `SettingsPanel.test.tsx`:

- Assert `.settings-window-root` does not use `overflow: auto`.
- Assert `.settings-scale-content` has a bounded height path instead of expanding to content height.
- Assert `.settings-content-scroll` remains the only vertical auto-scroll container in the Settings panel CSS.
- Preserve existing guards for `min-height: 0` on flex containers.
- Preserve existing Apply overlay guards so `apply-row` remains absolute and outside normal tab layout.

Manual verification should open the Settings window and confirm that long tab content scrolls inside the right content area while the title, sidebar, and Apply overlay remain stationary.

## Implementation Notes

- Start with CSS only. The likely implementation is in `app/src/styles/global.css` and `app/src/ui/SettingsPanel.css`.
- If tests reveal existing expectations that describe a resizable shell, update only the wording/guards that conflict with fixed shell scroll ownership.
- Do not touch bridge protocols, Pomodoro store behavior, WebSocket reconnect logic, native hit-testing, or video playback.
- Keep `AUI/PUI.pen` unchanged unless visual inspection shows the design file itself contradicts the confirmed target. Current Pencil selection already identifies `2RdBk` as the intended scrollable content area.
