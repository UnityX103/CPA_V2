# Pomodoro End Video Design

**Date**: 2026-05-16
**Project**: CPA_V2 Tauri rewrite
**Scope**: Implement the Pomodoro end-action slice for bundled default video playback plus user-selected custom `.webm` playback.

## Goal

When a Pomodoro phase ends, the app can either show the existing top popup reminder or play a video. The first bundled video option is named `千千`. The source file for that bundled option is `/Users/xpy/Desktop/ms1.webm`, but implementation must copy it into the project so the final app package does not depend on the user's Desktop file at runtime.

Custom videos are intentionally lighter weight: the app stores the user's selected absolute file path only. It does not copy, import, rename, or manage custom video files.

## Current Context

CPA_V2 already has a working Pomodoro state store in `app/src/domain/pomodoro.ts` and static settings rows in `app/src/ui/SettingsPanel.tsx` for:

- `计时结束提示`
- `自定义视频文件`

The rewrite design already names the Unity parity fields `endActionMode`, `endActionVideoPath`, and `endActionVideoIndex`, but CPA_V2 has not yet implemented runtime end-action playback. This spec fills that focused gap without introducing a larger video library.

## Decisions

1. Use approach 1 from brainstorming: a small but complete end-action slice.
2. Bundle the default `千千` video with the app by copying `/Users/xpy/Desktop/ms1.webm` into the project, for example `app/public/videos/ms1.webm`.
3. Keep bundled videos in a typed frontend registry. The initial registry contains:
   - id: `qianqian`
   - name: `千千`
   - kind: `builtin`
   - url: bundled public asset URL
4. Save custom videos as absolute paths only.
5. Restrict custom video selection to `.webm`.
6. If a custom file is missing or unreadable when playback is requested, show a popup message and fall back to the top popup end action.

## Non-Goals

- No full video-library management UI.
- No custom video copying, transcoding, thumbnail generation, delete flow, or rename flow.
- No migration of Unity `VideoClip` semantics. Tauri playback uses browser video capabilities.
- No support for non-`.webm` custom files in this slice.

## User-Facing Behavior

### Default State

The Pomodoro end action defaults to video playback with the bundled video `千千` selected.

If the user never changes any settings, ending a focus phase or completing the last round plays `千千`.

### Settings

The Pomodoro settings tab changes from static labels to real controls:

- `计时结束提示`
  - `弹窗到顶部`
  - `播放视频`
- Video source when `播放视频` is active:
  - bundled option: `千千`
  - custom option: selected `.webm` absolute path, if present
- `自定义视频文件`
  - shows `未选择` when empty
  - shows the selected filename when set
  - opens a native file picker filtered to `.webm`

The existing Apply-row pattern remains the source of truth for committing settings changes.

### End Action

When a Pomodoro phase transitions because time reaches zero:

1. If `endActionMode` is `topWindow`, perform the top popup action.
2. If `endActionMode` is `playVideo` and the selected source is bundled, play the bundled asset.
3. If `endActionMode` is `playVideo` and the selected source is custom, validate the absolute path before playback.
4. If custom validation fails, show a clear popup such as `视频文件不存在，请重新选择`, then perform the top popup action.

Manual skip behavior should use the same end-action rule unless implementation discovers an existing UX reason to exclude skip-triggered transitions. The final implementation plan should make that choice explicit before coding.

## Architecture

### Data Model

Extend the Pomodoro domain state with end-action settings:

```ts
type PomodoroEndActionMode = 'topWindow' | 'playVideo';
type PomodoroVideoSourceKind = 'builtin' | 'custom';

interface PomodoroVideoSettings {
    sourceKind: PomodoroVideoSourceKind;
    builtinVideoId: string;
    customVideoPath: string;
}
```

`PomodoroState` owns:

- `endActionMode`
- `endActionVideo`

The state store remains responsible for configuration and phase transitions only. It should not directly render or manage a `<video>` element.

### Built-In Video Registry

Create a small registry module, likely under `app/src/domain/pomodoroVideos.ts` or similar:

```ts
interface BuiltinPomodoroVideo {
    id: string;
    name: string;
    url: string;
}
```

The first entry is `千千`. Future bundled videos are added by copying their files into the public videos folder and appending registry entries.

### Runtime End-Action Service

Add a small frontend boundary that listens for Pomodoro phase-end events and performs side effects:

- resolve selected video source
- call Tauri file validation for custom paths
- open the video overlay or window
- show error popup and fall back to top popup when needed

The Pomodoro state machine should expose enough signal for this service to know a phase ended. This can be done with a returned action result, an incrementing event token in state, or a store subscription that detects phase changes. The implementation plan should choose the least intrusive option after reading the current store and tests.

### Video Playback UI

Use browser-native `<video>` playback for both bundled and custom sources.

Bundled videos use a public asset URL.

Custom videos use a URL resolved through Tauri-safe file access. The implementation should verify the correct Tauri 2 mechanism before coding. If direct local paths cannot be safely loaded by the webview, add a narrowly scoped Tauri command or asset protocol path conversion rather than widening CSP broadly.

Playback UI can be a full-screen or centered overlay. It should be visually simple in this slice:

- black or neutral backdrop
- video centered
- close button
- close on playback end

### Native Commands

Add only the minimum Tauri commands needed for this slice:

- pick a `.webm` file and return its absolute path
- validate that an absolute custom video path exists, is readable, and has `.webm` extension
- optionally convert a valid custom path into a webview-loadable video URL if Tauri requires that

These commands are app-local helpers. They should not expose arbitrary file reads to frontend code.

### Settings Window Bridge

Because settings can run in a separate window, the bridge snapshot and dispatch payloads must include the new Pomodoro end-action settings. Settings-window actions should dispatch to the main window rather than mutating local mirror state.

## Error Handling

Custom video errors are user-visible and recoverable:

- missing file
- unreadable file
- wrong extension
- path validation failure

All of these show a popup message and fall back to `弹窗到顶部`.

Bundled video errors are treated as implementation or packaging errors. The app should still fall back to `弹窗到顶部`, and tests should catch missing bundled assets before release.

## Persistence

This design assumes the Pomodoro settings should persist with the rest of the app settings once the existing persistence layer is available or wired for this store. If implementation finds no current Pomodoro persistence in CPA_V2, it should keep the state shape persistence-ready and avoid inventing a separate storage mechanism just for videos.

## Testing

Unit tests:

- default Pomodoro end-action settings select `playVideo` + bundled `千千`
- applying settings updates end-action fields
- settings-window mode dispatches end-action updates instead of local mutation
- custom path validation failure produces fallback behavior

Component tests:

- Pomodoro settings renders `计时结束提示` and `自定义视频文件` as real controls
- `千千` is visible as the default bundled video option
- selected custom filename is displayed after path selection

Rust or integration tests:

- `.webm` absolute path validation accepts a real `.webm`
- wrong extension is rejected
- missing file is rejected

Build/package verification:

- `app/public/videos/ms1.webm` exists after the implementation copies it
- frontend build references the bundled video asset successfully

## Implementation Sequence

1. Copy `/Users/xpy/Desktop/ms1.webm` into the project public videos folder.
2. Add the bundled video registry with `千千`.
3. Extend Pomodoro state, actions, tests, and settings bridge payloads.
4. Replace the static settings rows with working controls.
5. Add minimal Tauri commands for `.webm` path selection and validation.
6. Add the end-action runtime service and video playback overlay.
7. Add fallback popup behavior.
8. Run unit, component, and build checks.

## Open Clarification Resolved

The user chose absolute-path persistence for custom videos. If the file disappears, the app must show a popup and fall back to the top popup action.

The user also confirmed the default video should be copied into the project and bundled with the app.
