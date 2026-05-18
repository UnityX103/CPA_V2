# Active App Logo And Title Display Design

## Problem

The input counter panel should show the foreground application's icon and optionally show the opened document/window title. The current implementation can collect an icon payload, but it uses a TIFF data URL that is not reliable in the webview image path. The panel also always prefers `window_title`, with no user setting for hiding document/file names.

## Design

On macOS, convert `NSRunningApplication.icon()` into PNG bytes before base64 encoding. The frontend should receive `icon_data_url` as `data:image/png;base64,...`. If native conversion fails, the frontend keeps the existing fallback app-window icon.

Continue collecting the foreground window title from the current CGWindow-based path. This should cover common document-title cases such as Excel's active workbook name when macOS exposes it through `kCGWindowName`. If no title is available, the frontend falls back to the app name.

Add a global setting named `showActiveAppWindowTitle`, defaulting to `true`. When enabled, the input counter panel label is `window_title || name || 未聚焦应用`. When disabled, the label is `name || 未聚焦应用`, so file/document names are not displayed. The setting should persist and mirror into the input-counter window through the existing bridge snapshot.

## Testing

Add coverage for:

- Native source expects PNG icon generation, not TIFF data URLs.
- Input counter panel respects the title-display setting.
- Title fallback still uses the app name when title display is disabled or title is empty.
- Settings store dispatch, hydration, persistence, bridge snapshot, and mirror client include `showActiveAppWindowTitle`.
- Settings UI exposes a toggle for `显示打开的文件名`.

## Out Of Scope

This design does not add Windows active-app/icon implementation. Existing non-macOS active app stubs remain a separate platform follow-up.
