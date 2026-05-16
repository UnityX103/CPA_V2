# Pomodoro End Video Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a bundled default Pomodoro end video named `千千`, allow users to select custom `.webm` files by absolute path, and fall back to the top popup action when custom playback cannot proceed.

**Architecture:** Keep Pomodoro state responsible for timer state and end-action configuration only. Put bundled video metadata in a registry, native file validation in a small Rust module, file picker/path conversion in a TypeScript adapter, and playback/fallback side effects in a React end-action layer mounted by the main app.

**Tech Stack:** Tauri 2, Rust, React 19, TypeScript, Zustand, Vitest, Testing Library, browser-native `<video>`, `@tauri-apps/plugin-dialog`, `tauri-plugin-dialog`, `tauri-plugin-fs`, `tauri-plugin-persisted-scope`.

---

## File Structure

- Create: `app/public/videos/ms1.webm`
  - Bundled default video copied from `/Users/xpy/Desktop/ms1.webm`.
- Create: `app/src/domain/pomodoroVideos.ts`
  - Typed registry of bundled videos. Initial item is `qianqian` / `千千`.
- Modify: `app/src/domain/pomodoro.ts`
  - Add end-action types, defaults, settings action, and a phase-end event token.
- Modify: `app/src/domain/pomodoro.test.ts`
  - Cover defaults, settings updates, settings-window dispatch, and end-event emission.
- Modify: `app/src/domain/bridge/protocol.ts`
  - Include end-action settings in snapshots and dispatch payloads.
- Modify: `app/src/domain/bridge/host.ts`
  - Send end-action settings and apply settings-window dispatches on the main store.
- Modify: `app/src/domain/bridge/client.ts`
  - Mirror end-action settings into the settings window.
- Modify: `app/src/domain/bridge/*.test.ts`
  - Keep bridge protocol, host snapshot, and client mirror tests in sync.
- Create: `app/src-tauri/src/video_files.rs`
  - Validate absolute `.webm` custom video paths.
- Modify: `app/src-tauri/src/lib.rs`
  - Register the video file validation command and required plugins.
- Modify: `app/src-tauri/Cargo.toml`
  - Add Tauri plugin dependencies.
- Modify: `app/package.json`, `app/package-lock.json`
  - Add `@tauri-apps/plugin-dialog`.
- Modify: `app/src-tauri/tauri.conf.json`
  - Allow media loading from bundled assets and the Tauri asset protocol.
- Modify: `app/src-tauri/capabilities/default.json`
  - Add dialog permissions for native open/message dialogs.
- Create: `app/src/domain/videoFiles.ts`
  - Wrap native dialog, validation command, `convertFileSrc`, and missing-file message.
- Create: `app/src/domain/videoFiles.test.ts`
  - Unit tests for file picker and validation wrapper behavior.
- Create: `app/src/domain/pomodoroEndAction.ts`
  - Pure resolver that maps Pomodoro state to `topWindow` or playable video.
- Create: `app/src/domain/pomodoroEndAction.test.ts`
  - Unit tests for bundled/default/custom/fallback decisions.
- Create: `app/src/ui/PomodoroEndActionLayer.tsx`
  - Subscribe to Pomodoro end events, render top popup, render video overlay.
- Create: `app/src/ui/PomodoroEndActionLayer.css`
  - Styling for top popup and video overlay.
- Modify: `app/src/App.tsx`
  - Mount the end-action layer in the main window.
- Modify: `app/src/ui/SettingsPanel.tsx`
  - Turn static Pomodoro end-action rows into working controls.
- Modify: `app/src/ui/SettingsPanel.test.tsx`
  - Cover `千千`, end-action controls, custom filename display, and picker call.

## Task 1: Bundle `千千` and Add the Video Registry

**Files:**
- Create: `app/public/videos/ms1.webm`
- Create: `app/src/domain/pomodoroVideos.ts`
- Test: `app/src/domain/pomodoroVideos.test.ts`

- [ ] **Step 1: Write the failing registry test**

Create `app/src/domain/pomodoroVideos.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
    BUILTIN_POMODORO_VIDEOS,
    DEFAULT_BUILTIN_POMODORO_VIDEO_ID,
    getBuiltinPomodoroVideo,
} from './pomodoroVideos';

describe('pomodoro video registry', () => {
    it('registers 千千 as the default bundled video', () => {
        expect(DEFAULT_BUILTIN_POMODORO_VIDEO_ID).toBe('qianqian');
        expect(BUILTIN_POMODORO_VIDEOS).toEqual([
            {
                id: 'qianqian',
                name: '千千',
                url: '/videos/ms1.webm',
            },
        ]);
        expect(getBuiltinPomodoroVideo('qianqian')?.name).toBe('千千');
        expect(getBuiltinPomodoroVideo('missing')).toBeNull();
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
cd app
npx vitest run src/domain/pomodoroVideos.test.ts
```

Expected: FAIL because `./pomodoroVideos` does not exist.

- [ ] **Step 3: Copy the bundled asset**

Run:

```bash
cd app
mkdir -p public/videos
cp /Users/xpy/Desktop/ms1.webm public/videos/ms1.webm
test -s public/videos/ms1.webm
```

Expected: no output and exit code `0`.

- [ ] **Step 4: Add the registry implementation**

Create `app/src/domain/pomodoroVideos.ts`:

```ts
export interface BuiltinPomodoroVideo {
    id: string;
    name: string;
    url: string;
}

export const DEFAULT_BUILTIN_POMODORO_VIDEO_ID = 'qianqian';

export const BUILTIN_POMODORO_VIDEOS: BuiltinPomodoroVideo[] = [
    {
        id: DEFAULT_BUILTIN_POMODORO_VIDEO_ID,
        name: '千千',
        url: '/videos/ms1.webm',
    },
];

export function getBuiltinPomodoroVideo(id: string): BuiltinPomodoroVideo | null {
    return BUILTIN_POMODORO_VIDEOS.find((video) => video.id === id) ?? null;
}
```

- [ ] **Step 5: Run the registry test**

Run:

```bash
cd app
npx vitest run src/domain/pomodoroVideos.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add app/public/videos/ms1.webm app/src/domain/pomodoroVideos.ts app/src/domain/pomodoroVideos.test.ts
git commit -m "feat: bundle qianqian pomodoro video"
```

## Task 2: Extend Pomodoro State With End-Action Settings and Events

**Files:**
- Modify: `app/src/domain/pomodoro.ts`
- Modify: `app/src/domain/pomodoro.test.ts`

- [ ] **Step 1: Add failing Pomodoro state tests**

Append these tests to `app/src/domain/pomodoro.test.ts`:

```ts
describe('Pomodoro end-action settings', () => {
    beforeEach(reset);

    it('defaults to playing the bundled 千千 video', () => {
        const state = usePomodoroStore.getState();
        expect(state.endActionMode).toBe('playVideo');
        expect(state.endActionVideo).toEqual({
            sourceKind: 'builtin',
            builtinVideoId: 'qianqian',
            customVideoPath: '',
        });
    });

    it('applies end-action settings without resetting timer progress', () => {
        usePomodoroStore.setState({ remainingSeconds: 321, currentRound: 2 });
        usePomodoroStore.getState().applyEndActionSettings('topWindow', {
            sourceKind: 'custom',
            builtinVideoId: 'qianqian',
            customVideoPath: '/tmp/end.webm',
        });
        const state = usePomodoroStore.getState();
        expect(state.endActionMode).toBe('topWindow');
        expect(state.endActionVideo.customVideoPath).toBe('/tmp/end.webm');
        expect(state.remainingSeconds).toBe(321);
        expect(state.currentRound).toBe(2);
    });

    it('emits an end event when timer reaches zero', () => {
        usePomodoroStore.getState().applySettings(1, 60, 4, true);
        usePomodoroStore.getState().start();
        expect(usePomodoroStore.getState().lastEndEvent).toBeNull();

        usePomodoroStore.getState().tick(1);

        expect(usePomodoroStore.getState().lastEndEvent).toEqual({
            id: 1,
            fromPhase: 'focus',
            toPhase: 'break',
            triggeredBy: 'timer',
        });
    });

    it('emits an end event when skip advances the phase', () => {
        usePomodoroStore.getState().start();
        usePomodoroStore.getState().skip();

        expect(usePomodoroStore.getState().lastEndEvent).toEqual({
            id: 1,
            fromPhase: 'focus',
            toPhase: 'break',
            triggeredBy: 'skip',
        });
    });
});
```

Update the settings-window test in the same file to include a new dispatch case:

```ts
    it('applyEndActionSettings dispatches instead of mutating local state', () => {
        const spy = vi.spyOn(dispatchMod, 'dispatch').mockResolvedValue();
        const store = createPomodoroStore({ isSettingsWindow: true });
        store.getState().applyEndActionSettings('topWindow', {
            sourceKind: 'custom',
            builtinVideoId: 'qianqian',
            customVideoPath: '/tmp/end.webm',
        });
        expect(store.getState().endActionMode).toBe('playVideo');
        expect(spy).toHaveBeenCalledWith(expect.objectContaining({
            v: BRIDGE_VERSION,
            store: 'pomodoro',
            action: 'applyEndActionSettings',
            args: ['topWindow', {
                sourceKind: 'custom',
                builtinVideoId: 'qianqian',
                customVideoPath: '/tmp/end.webm',
            }],
        }));
        spy.mockRestore();
    });
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
cd app
npx vitest run src/domain/pomodoro.test.ts
```

Expected: FAIL because end-action fields and `applyEndActionSettings` do not exist.

- [ ] **Step 3: Add Pomodoro end-action types and defaults**

In `app/src/domain/pomodoro.ts`, add imports and types near the existing `PomodoroPhase` type:

```ts
import { DEFAULT_BUILTIN_POMODORO_VIDEO_ID } from './pomodoroVideos';

export type PomodoroEndActionMode = 'topWindow' | 'playVideo';
export type PomodoroVideoSourceKind = 'builtin' | 'custom';
export type PomodoroEndTrigger = 'timer' | 'skip';

export interface PomodoroVideoSettings {
    sourceKind: PomodoroVideoSourceKind;
    builtinVideoId: string;
    customVideoPath: string;
}

export interface PomodoroEndEvent {
    id: number;
    fromPhase: PomodoroPhase;
    toPhase: PomodoroPhase;
    triggeredBy: PomodoroEndTrigger;
}

const DEFAULT_END_ACTION_MODE: PomodoroEndActionMode = 'playVideo';
const DEFAULT_END_ACTION_VIDEO: PomodoroVideoSettings = {
    sourceKind: 'builtin',
    builtinVideoId: DEFAULT_BUILTIN_POMODORO_VIDEO_ID,
    customVideoPath: '',
};
```

Add fields to `PomodoroState`:

```ts
    endActionMode: PomodoroEndActionMode;
    endActionVideo: PomodoroVideoSettings;
    lastEndEvent: PomodoroEndEvent | null;
```

Add an action to `PomodoroActions`:

```ts
    applyEndActionSettings: (mode: PomodoroEndActionMode, video: PomodoroVideoSettings) => void;
```

- [ ] **Step 4: Implement default state and event emission**

Inside `createPomodoroStore`, add the default fields to both the settings-window store and main store:

```ts
            endActionMode: DEFAULT_END_ACTION_MODE,
            endActionVideo: DEFAULT_END_ACTION_VIDEO,
            lastEndEvent: null,
```

For settings-window mode, add the dispatcher action:

```ts
            applyEndActionSettings: (mode, video) => {
                void dispatch({
                    v: BRIDGE_VERSION,
                    store: 'pomodoro',
                    action: 'applyEndActionSettings',
                    args: [mode, video],
                });
            },
```

In the main-store closure, add an event counter:

```ts
        let endEventId = 0;
```

Replace `advancePhase` with a version that records source phase and trigger:

```ts
        function makeEndEvent(
            fromPhase: PomodoroPhase,
            toPhase: PomodoroPhase,
            triggeredBy: PomodoroEndTrigger,
        ): PomodoroEndEvent {
            endEventId += 1;
            return { id: endEventId, fromPhase, toPhase, triggeredBy };
        }

        function advancePhase(state: PomodoroState, triggeredBy: PomodoroEndTrigger): Partial<PomodoroState> {
            if (state.currentPhase === 'focus') {
                accumulator = 0;
                return {
                    currentPhase: 'break',
                    remainingSeconds: state.breakDurationSeconds,
                    isRunning: state.autoStartBreak,
                    consecutiveCompletedFocus: state.consecutiveCompletedFocus + 1,
                    lastEndEvent: makeEndEvent('focus', 'break', triggeredBy),
                };
            }
            if (state.currentPhase === 'break') {
                const nextRound = state.currentRound + 1;
                if (nextRound > state.totalRounds) {
                    return {
                        currentPhase: 'completed',
                        isRunning: false,
                        remainingSeconds: 0,
                        lastEndEvent: makeEndEvent('break', 'completed', triggeredBy),
                    };
                }
                accumulator = 0;
                return {
                    currentRound: nextRound,
                    currentPhase: 'focus',
                    remainingSeconds: state.focusDurationSeconds,
                    isRunning: false,
                    lastEndEvent: makeEndEvent('break', 'focus', triggeredBy),
                };
            }
            return {};
        }
```

Update call sites:

```ts
set(advancePhase(state, 'skip'));
set({ remainingSeconds: 0, ...advancePhase(get(), 'timer') });
```

Add the main-store action:

```ts
            applyEndActionSettings: (mode, video) => {
                set({
                    endActionMode: mode,
                    endActionVideo: {
                        sourceKind: video.sourceKind,
                        builtinVideoId: video.builtinVideoId || DEFAULT_BUILTIN_POMODORO_VIDEO_ID,
                        customVideoPath: video.customVideoPath,
                    },
                });
            },
```

In `reset()` inside the test file, include:

```ts
        endActionMode: 'playVideo',
        endActionVideo: {
            sourceKind: 'builtin',
            builtinVideoId: 'qianqian',
            customVideoPath: '',
        },
        lastEndEvent: null,
```

- [ ] **Step 5: Run Pomodoro tests**

Run:

```bash
cd app
npx vitest run src/domain/pomodoro.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add app/src/domain/pomodoro.ts app/src/domain/pomodoro.test.ts
git commit -m "feat: add pomodoro end action state"
```

## Task 3: Extend the Settings Window Bridge

**Files:**
- Modify: `app/src/domain/bridge/protocol.ts`
- Modify: `app/src/domain/bridge/host.ts`
- Modify: `app/src/domain/bridge/client.ts`
- Modify: `app/src/domain/bridge/protocol.test.ts`
- Modify: `app/src/domain/bridge/host.test.ts`
- Modify: `app/src/domain/bridge/client.test.ts`

- [ ] **Step 1: Write failing bridge tests**

Update `SAMPLE` in `app/src/domain/bridge/client.test.ts` so its Pomodoro section is:

```ts
    pomodoro: {
        focusDurationSeconds: 600,
        breakDurationSeconds: 120,
        totalRounds: 6,
        endActionMode: 'topWindow',
        endActionVideo: {
            sourceKind: 'custom',
            builtinVideoId: 'qianqian',
            customVideoPath: '/tmp/end.webm',
        },
    },
```

Add assertions in the first client test:

```ts
        expect(usePomodoroStore.getState().endActionMode).toBe('topWindow');
        expect(usePomodoroStore.getState().endActionVideo.customVideoPath).toBe('/tmp/end.webm');
```

Update `app/src/domain/bridge/host.test.ts` first snapshot test with:

```ts
        usePomodoroStore.getState().applyEndActionSettings('topWindow', {
            sourceKind: 'custom',
            builtinVideoId: 'qianqian',
            customVideoPath: '/tmp/end.webm',
        });
        const snap = buildSnapshot();
        expect(snap.pomodoro.endActionMode).toBe('topWindow');
        expect(snap.pomodoro.endActionVideo.customVideoPath).toBe('/tmp/end.webm');
```

Add a dispatch test in `host.test.ts`:

```ts
    it('routes pomodoro/applyEndActionSettings to the main store', () => {
        applyDispatch({
            v: BRIDGE_VERSION,
            store: 'pomodoro',
            action: 'applyEndActionSettings',
            args: ['topWindow', {
                sourceKind: 'custom',
                builtinVideoId: 'qianqian',
                customVideoPath: '/tmp/end.webm',
            }],
        });
        expect(usePomodoroStore.getState().endActionMode).toBe('topWindow');
        expect(usePomodoroStore.getState().endActionVideo.customVideoPath).toBe('/tmp/end.webm');
    });
```

Update `app/src/domain/bridge/protocol.test.ts` sample snapshot and dispatch samples:

```ts
            pomodoro: {
                focusDurationSeconds: 1500,
                breakDurationSeconds: 300,
                totalRounds: 4,
                endActionMode: 'playVideo',
                endActionVideo: {
                    sourceKind: 'builtin',
                    builtinVideoId: 'qianqian',
                    customVideoPath: '',
                },
            },
```

Add to `samples`:

```ts
            { v: 1, store: 'pomodoro', action: 'applyEndActionSettings', args: ['topWindow', {
                sourceKind: 'custom',
                builtinVideoId: 'qianqian',
                customVideoPath: '/tmp/end.webm',
            }] },
```

Change the length assertion from `11` to `12`.

- [ ] **Step 2: Run bridge tests to verify they fail**

Run:

```bash
cd app
npx vitest run src/domain/bridge/protocol.test.ts src/domain/bridge/host.test.ts src/domain/bridge/client.test.ts
```

Expected: FAIL because bridge types and handlers do not include end-action settings.

- [ ] **Step 3: Update bridge protocol types**

In `app/src/domain/bridge/protocol.ts`, import Pomodoro end-action types:

```ts
import type { PomodoroEndActionMode, PomodoroVideoSettings } from '../pomodoro';
```

Extend `BridgeSnapshot.pomodoro`:

```ts
        endActionMode: PomodoroEndActionMode;
        endActionVideo: PomodoroVideoSettings;
```

Extend `DispatchPayload`:

```ts
    | {
        v: typeof BRIDGE_VERSION;
        store: 'pomodoro';
        action: 'applyEndActionSettings';
        args: [PomodoroEndActionMode, PomodoroVideoSettings];
    }
```

- [ ] **Step 4: Update host snapshot and dispatch**

In `app/src/domain/bridge/host.ts`, add to `buildSnapshot().pomodoro`:

```ts
            endActionMode: p.endActionMode,
            endActionVideo: p.endActionVideo,
```

Update `applyDispatch` Pomodoro branch:

```ts
        case 'pomodoro': {
            const p = usePomodoroStore.getState();
            switch (payload.action) {
                case 'applySettings':
                    p.applySettings(...payload.args);
                    return;
                case 'applyEndActionSettings':
                    p.applyEndActionSettings(...payload.args);
                    return;
            }
            return;
        }
```

Update `pomoSig`:

```ts
function pomoSig(s: {
    focusDurationSeconds: number;
    breakDurationSeconds: number;
    totalRounds: number;
    endActionMode: string;
    endActionVideo: { sourceKind: string; builtinVideoId: string; customVideoPath: string };
}): string {
    return [
        s.focusDurationSeconds,
        s.breakDurationSeconds,
        s.totalRounds,
        s.endActionMode,
        s.endActionVideo.sourceKind,
        s.endActionVideo.builtinVideoId,
        s.endActionVideo.customVideoPath,
    ].join('|');
}
```

- [ ] **Step 5: Update client mirror**

In `app/src/domain/bridge/client.ts`, add to the Pomodoro mirror state:

```ts
        endActionMode: snap.pomodoro.endActionMode,
        endActionVideo: snap.pomodoro.endActionVideo,
```

- [ ] **Step 6: Run bridge tests**

Run:

```bash
cd app
npx vitest run src/domain/bridge/protocol.test.ts src/domain/bridge/host.test.ts src/domain/bridge/client.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

Run:

```bash
git add app/src/domain/bridge/protocol.ts app/src/domain/bridge/host.ts app/src/domain/bridge/client.ts app/src/domain/bridge/*.test.ts
git commit -m "feat: bridge pomodoro end action settings"
```

## Task 4: Add Native Video Path Validation and Dialog Capability

**Files:**
- Modify: `app/package.json`
- Modify: `app/package-lock.json`
- Modify: `app/src-tauri/Cargo.toml`
- Modify: `app/src-tauri/tauri.conf.json`
- Modify: `app/src-tauri/capabilities/default.json`
- Create: `app/src-tauri/src/video_files.rs`
- Modify: `app/src-tauri/src/lib.rs`

- [ ] **Step 1: Add dependencies**

Run:

```bash
cd app
npm install @tauri-apps/plugin-dialog@^2
cd src-tauri
cargo add tauri-plugin-dialog@2
cargo add tauri-plugin-fs@2
cargo add tauri-plugin-persisted-scope@2 --features protocol-asset
```

Expected: `package.json`, `package-lock.json`, `Cargo.toml`, and `Cargo.lock` update.

- [ ] **Step 2: Write failing Rust tests**

Create `app/src-tauri/src/video_files.rs`:

```rust
use serde::Serialize;
use std::path::Path;

#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct CustomVideoValidation {
    pub ok: bool,
    pub message: Option<String>,
}

pub(crate) fn validate_webm_path(path: &Path) -> CustomVideoValidation {
    let _ = path;
    CustomVideoValidation {
        ok: false,
        message: Some("stub always rejects".to_string()),
    }
}

#[tauri::command]
pub fn validate_custom_video_path(path: String) -> CustomVideoValidation {
    validate_webm_path(Path::new(&path))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn unique_path(name: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!(
            "cpa-video-files-{}-{name}",
            std::process::id(),
        ))
    }

    #[test]
    fn accepts_existing_absolute_webm_file() {
        let path = unique_path("ok.webm");
        fs::write(&path, b"webm").unwrap();
        let result = validate_webm_path(&path);
        let _ = fs::remove_file(&path);

        assert_eq!(result, CustomVideoValidation { ok: true, message: None });
    }

    #[test]
    fn rejects_missing_file() {
        let path = unique_path("missing.webm");
        let result = validate_webm_path(&path);

        assert_eq!(
            result,
            CustomVideoValidation {
                ok: false,
                message: Some("视频文件不存在，请重新选择".to_string()),
            },
        );
    }

    #[test]
    fn rejects_non_webm_extension() {
        let path = unique_path("bad.mp4");
        fs::write(&path, b"mp4").unwrap();
        let result = validate_webm_path(&path);
        let _ = fs::remove_file(&path);

        assert_eq!(
            result,
            CustomVideoValidation {
                ok: false,
                message: Some("请选择 .webm 视频文件".to_string()),
            },
        );
    }
}
```

- [ ] **Step 3: Run Rust tests to verify they fail**

Run:

```bash
cd app/src-tauri
cargo test video_files
```

Expected: FAIL because `validate_webm_path` always returns `stub always rejects`.

- [ ] **Step 4: Implement validation**

Replace `validate_webm_path` in `app/src-tauri/src/video_files.rs`:

```rust
pub(crate) fn validate_webm_path(path: &Path) -> CustomVideoValidation {
    if !path.is_absolute() {
        return CustomVideoValidation {
            ok: false,
            message: Some("视频路径必须是绝对路径".to_string()),
        };
    }

    let is_webm = path
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.eq_ignore_ascii_case("webm"))
        .unwrap_or(false);
    if !is_webm {
        return CustomVideoValidation {
            ok: false,
            message: Some("请选择 .webm 视频文件".to_string()),
        };
    }

    match std::fs::metadata(path) {
        Ok(meta) if meta.is_file() => CustomVideoValidation { ok: true, message: None },
        _ => CustomVideoValidation {
            ok: false,
            message: Some("视频文件不存在，请重新选择".to_string()),
        },
    }
}
```

- [ ] **Step 5: Register the module, command, and plugins**

In `app/src-tauri/src/lib.rs`, add:

```rust
mod video_files;
```

In the builder plugin chain, register plugins in this order:

```rust
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_persisted_scope::init())
        .plugin(tauri_plugin_store::Builder::new().build())
```

In `invoke_handler`, add:

```rust
            video_files::validate_custom_video_path,
```

- [ ] **Step 6: Update Tauri CSP and capabilities**

In `app/src-tauri/tauri.conf.json`, update `security.csp` so it includes `media-src`:

```json
"csp": "default-src 'self' ipc: http://ipc.localhost; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data: blob: asset: http://asset.localhost; media-src 'self' blob: asset: http://asset.localhost; connect-src 'self' ipc: http://ipc.localhost ws://127.0.0.1:* ws://localhost:*"
```

In `app/src-tauri/capabilities/default.json`, add dialog permissions:

```json
    "dialog:allow-open",
    "dialog:allow-message"
```

Keep the existing permissions unchanged.

- [ ] **Step 7: Run Rust tests**

Run:

```bash
cd app/src-tauri
cargo test video_files
```

Expected: PASS.

- [ ] **Step 8: Commit**

Run:

```bash
git add app/package.json app/package-lock.json app/src-tauri/Cargo.toml app/src-tauri/Cargo.lock app/src-tauri/tauri.conf.json app/src-tauri/capabilities/default.json app/src-tauri/src/lib.rs app/src-tauri/src/video_files.rs
git commit -m "feat: validate custom pomodoro videos"
```

## Task 5: Add the TypeScript Video File Adapter

**Files:**
- Create: `app/src/domain/videoFiles.ts`
- Create: `app/src/domain/videoFiles.test.ts`

- [ ] **Step 1: Write adapter tests**

Create `app/src/domain/videoFiles.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
    customVideoSrc,
    pickCustomWebmPath,
    showCustomVideoMissingMessage,
    validateCustomVideoPath,
} from './videoFiles';

const { invokeMock, openMock, messageMock, convertFileSrcMock } = vi.hoisted(() => ({
    invokeMock: vi.fn(),
    openMock: vi.fn(),
    messageMock: vi.fn(),
    convertFileSrcMock: vi.fn((path: string) => `asset://${path}`),
}));

vi.mock('@tauri-apps/api/core', () => ({
    invoke: invokeMock,
    convertFileSrc: convertFileSrcMock,
}));

vi.mock('@tauri-apps/plugin-dialog', () => ({
    open: openMock,
    message: messageMock,
}));

beforeEach(() => {
    invokeMock.mockReset();
    openMock.mockReset();
    messageMock.mockReset();
    convertFileSrcMock.mockClear();
});

describe('videoFiles', () => {
    it('opens a native picker filtered to webm and returns a single path', async () => {
        openMock.mockResolvedValue('/tmp/custom.webm');

        await expect(pickCustomWebmPath()).resolves.toBe('/tmp/custom.webm');
        expect(openMock).toHaveBeenCalledWith({
            multiple: false,
            directory: false,
            filters: [{ name: 'WebM 视频', extensions: ['webm'] }],
        });
    });

    it('returns null when picker is cancelled or returns multiple paths', async () => {
        openMock.mockResolvedValue(null);
        await expect(pickCustomWebmPath()).resolves.toBeNull();

        openMock.mockResolvedValue(['/tmp/a.webm']);
        await expect(pickCustomWebmPath()).resolves.toBeNull();
    });

    it('validates custom paths through the Tauri command', async () => {
        invokeMock.mockResolvedValue({ ok: true, message: null });

        await expect(validateCustomVideoPath('/tmp/custom.webm')).resolves.toEqual({ ok: true, message: null });
        expect(invokeMock).toHaveBeenCalledWith('validate_custom_video_path', { path: '/tmp/custom.webm' });
    });

    it('converts custom paths to asset protocol URLs', () => {
        expect(customVideoSrc('/tmp/custom.webm')).toBe('asset:///tmp/custom.webm');
    });

    it('shows a native message for missing custom videos', async () => {
        await showCustomVideoMissingMessage('视频文件不存在，请重新选择');
        expect(messageMock).toHaveBeenCalledWith('视频文件不存在，请重新选择', {
            title: '自定义视频不可用',
            kind: 'warning',
        });
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
cd app
npx vitest run src/domain/videoFiles.test.ts
```

Expected: FAIL because `./videoFiles` does not exist.

- [ ] **Step 3: Implement the adapter**

Create `app/src/domain/videoFiles.ts`:

```ts
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { message, open } from '@tauri-apps/plugin-dialog';

export interface CustomVideoValidation {
    ok: boolean;
    message: string | null;
}

export async function pickCustomWebmPath(): Promise<string | null> {
    const selected = await open({
        multiple: false,
        directory: false,
        filters: [{ name: 'WebM 视频', extensions: ['webm'] }],
    });
    return typeof selected === 'string' ? selected : null;
}

export async function validateCustomVideoPath(path: string): Promise<CustomVideoValidation> {
    return invoke<CustomVideoValidation>('validate_custom_video_path', { path });
}

export function customVideoSrc(path: string): string {
    return convertFileSrc(path);
}

export async function showCustomVideoMissingMessage(text: string): Promise<void> {
    await message(text, {
        title: '自定义视频不可用',
        kind: 'warning',
    });
}
```

- [ ] **Step 4: Run adapter tests**

Run:

```bash
cd app
npx vitest run src/domain/videoFiles.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add app/src/domain/videoFiles.ts app/src/domain/videoFiles.test.ts
git commit -m "feat: add custom video file adapter"
```

## Task 6: Replace Static Pomodoro Settings Rows With Working Controls

**Files:**
- Modify: `app/src/ui/SettingsPanel.tsx`
- Modify: `app/src/ui/SettingsPanel.test.tsx`

- [ ] **Step 1: Add failing settings UI tests**

In `app/src/ui/SettingsPanel.test.tsx`, add imports:

```ts
import { usePomodoroStore } from '../domain/pomodoro';
```

Extend the Tauri/dialog mocks:

```ts
const { startDragging, invokeMock, listenMock, pickCustomWebmPathMock } = vi.hoisted(() => ({
    startDragging: vi.fn(),
    invokeMock: vi.fn(),
    listenMock: vi.fn(() => Promise.resolve(() => {})),
    pickCustomWebmPathMock: vi.fn(),
}));
```

Add:

```ts
vi.mock('../domain/videoFiles', () => ({
    pickCustomWebmPath: pickCustomWebmPathMock,
}));
```

In `beforeEach`, reset the Pomodoro store fields:

```ts
    usePomodoroStore.setState({
        endActionMode: 'playVideo',
        endActionVideo: {
            sourceKind: 'builtin',
            builtinVideoId: 'qianqian',
            customVideoPath: '',
        },
    });
    pickCustomWebmPathMock.mockReset();
```

Add tests under `describe('PomodoroTab parity with gs1Tv', ...)`:

```ts
    it('shows 千千 as the default video option', () => {
        render(<SettingsPanel />);
        expect(screen.getByText('千千')).toBeTruthy();
        expect(screen.getByText('播放视频')).toBeTruthy();
    });

    it('lets the user switch to top-window end action and apply it', async () => {
        render(<SettingsPanel />);
        const select = screen.getByLabelText('计时结束提示');
        await act(async () => {
            fireEvent.change(select, { target: { value: 'topWindow' } });
        });
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: '应用' }));
        });

        expect(usePomodoroStore.getState().endActionMode).toBe('topWindow');
    });

    it('selects and displays a custom webm absolute path', async () => {
        pickCustomWebmPathMock.mockResolvedValue('/Users/xpy/Videos/custom.webm');
        render(<SettingsPanel />);

        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: '选择自定义视频' }));
        });

        expect(screen.getByText('custom.webm')).toBeTruthy();

        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: '应用' }));
        });

        expect(usePomodoroStore.getState().endActionVideo).toEqual({
            sourceKind: 'custom',
            builtinVideoId: 'qianqian',
            customVideoPath: '/Users/xpy/Videos/custom.webm',
        });
    });
```

- [ ] **Step 2: Run settings tests to verify they fail**

Run:

```bash
cd app
npx vitest run src/ui/SettingsPanel.test.tsx
```

Expected: FAIL because controls are still static.

- [ ] **Step 3: Implement local settings state and dirty tracking**

In `app/src/ui/SettingsPanel.tsx`, add imports:

```ts
import type { PomodoroEndActionMode, PomodoroVideoSettings } from '../domain/pomodoro';
import { BUILTIN_POMODORO_VIDEOS, DEFAULT_BUILTIN_POMODORO_VIDEO_ID } from '../domain/pomodoroVideos';
import { pickCustomWebmPath } from '../domain/videoFiles';
```

Inside `PomodoroTab`, add local state:

```ts
    const [endActionMode, setEndActionMode] = useState<PomodoroEndActionMode>(pomo.endActionMode);
    const [endActionVideo, setEndActionVideo] = useState<PomodoroVideoSettings>(pomo.endActionVideo);
```

Extend the sync effect:

```ts
        setEndActionMode(pomo.endActionMode);
        setEndActionVideo(pomo.endActionVideo);
```

Use this dependency list:

```ts
    }, [pomo.focusDurationSeconds, pomo.breakDurationSeconds, pomo.endActionMode, pomo.endActionVideo]);
```

Replace `dirty`:

```ts
    const dirty =
        focusMin * 60 !== pomo.focusDurationSeconds ||
        breakMin * 60 !== pomo.breakDurationSeconds ||
        endActionMode !== pomo.endActionMode ||
        endActionVideo.sourceKind !== pomo.endActionVideo.sourceKind ||
        endActionVideo.builtinVideoId !== pomo.endActionVideo.builtinVideoId ||
        endActionVideo.customVideoPath !== pomo.endActionVideo.customVideoPath;
```

Replace `apply`:

```ts
    const apply = () => {
        pomo.applySettings(focusMin * 60, breakMin * 60, pomo.totalRounds, true);
        pomo.applyEndActionSettings(endActionMode, endActionVideo);
    };
```

Add helpers:

```ts
    const customFileName = endActionVideo.customVideoPath
        ? endActionVideo.customVideoPath.split(/[\\/]/).pop() || endActionVideo.customVideoPath
        : '未选择';

    const chooseCustomVideo = async () => {
        const path = await pickCustomWebmPath();
        if (!path) return;
        setEndActionMode('playVideo');
        setEndActionVideo({
            sourceKind: 'custom',
            builtinVideoId: endActionVideo.builtinVideoId || DEFAULT_BUILTIN_POMODORO_VIDEO_ID,
            customVideoPath: path,
        });
    };
```

- [ ] **Step 4: Replace the two static rows**

Replace the `计时结束提示` row in `SettingsPanel.tsx`:

```tsx
                        <div className="card pomo-row">
                            <label className="pomo-row-label" htmlFor="pomodoro-end-action">计时结束提示</label>
                            <select
                                id="pomodoro-end-action"
                                aria-label="计时结束提示"
                                className="dropdown dropdown-fit"
                                value={endActionMode}
                                onChange={(e) => setEndActionMode(e.currentTarget.value as PomodoroEndActionMode)}
                            >
                                <option value="topWindow">弹窗到顶部</option>
                                <option value="playVideo">播放视频</option>
                            </select>
                        </div>

                        {endActionMode === 'playVideo' && (
                            <div className="card pomo-row">
                                <label className="pomo-row-label" htmlFor="pomodoro-video-source">视频选项</label>
                                <select
                                    id="pomodoro-video-source"
                                    aria-label="视频选项"
                                    className="dropdown dropdown-fit"
                                    value={endActionVideo.sourceKind === 'custom' ? 'custom' : endActionVideo.builtinVideoId}
                                    onChange={(e) => {
                                        const value = e.currentTarget.value;
                                        if (value === 'custom') {
                                            setEndActionVideo({
                                                sourceKind: 'custom',
                                                builtinVideoId: endActionVideo.builtinVideoId || DEFAULT_BUILTIN_POMODORO_VIDEO_ID,
                                                customVideoPath: endActionVideo.customVideoPath,
                                            });
                                            return;
                                        }
                                        setEndActionVideo({
                                            sourceKind: 'builtin',
                                            builtinVideoId: value,
                                            customVideoPath: endActionVideo.customVideoPath,
                                        });
                                    }}
                                >
                                    {BUILTIN_POMODORO_VIDEOS.map((video) => (
                                        <option key={video.id} value={video.id}>{video.name}</option>
                                    ))}
                                    <option value="custom">自定义视频</option>
                                </select>
                            </div>
                        )}
```

Replace the `自定义视频文件` row:

```tsx
                        <div className="card pomo-row">
                            <span className="pomo-row-label">自定义视频文件</span>
                            <button
                                className="pomo-row-right pomo-file-button"
                                type="button"
                                aria-label="选择自定义视频"
                                onClick={() => { void chooseCustomVideo(); }}
                            >
                                <span className={`pomo-row-value ${endActionVideo.customVideoPath ? '' : 'pomo-row-value-muted'}`}>
                                    {customFileName}
                                </span>
                                <FolderIcon />
                            </button>
                        </div>
```

- [ ] **Step 5: Add minimal CSS for the file button**

In `app/src/ui/SettingsPanel.css`, add:

```css
.pomo-file-button {
    appearance: none;
    border: 0;
    background: transparent;
    padding: 0;
    color: inherit;
    cursor: pointer;
}
```

- [ ] **Step 6: Run settings tests**

Run:

```bash
cd app
npx vitest run src/ui/SettingsPanel.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit**

Run:

```bash
git add app/src/ui/SettingsPanel.tsx app/src/ui/SettingsPanel.css app/src/ui/SettingsPanel.test.tsx
git commit -m "feat: wire pomodoro end video settings"
```

## Task 7: Add the Pure End-Action Resolver

**Files:**
- Create: `app/src/domain/pomodoroEndAction.ts`
- Create: `app/src/domain/pomodoroEndAction.test.ts`

- [ ] **Step 1: Write resolver tests**

Create `app/src/domain/pomodoroEndAction.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import type { PomodoroState } from './pomodoro';
import { resolvePomodoroEndAction } from './pomodoroEndAction';

function state(partial: Partial<PomodoroState>): PomodoroState {
    return {
        focusDurationSeconds: 1500,
        breakDurationSeconds: 300,
        totalRounds: 4,
        currentRound: 1,
        remainingSeconds: 0,
        currentPhase: 'break',
        isRunning: false,
        isPinned: false,
        autoStartBreak: true,
        consecutiveCompletedFocus: 1,
        endActionMode: 'playVideo',
        endActionVideo: {
            sourceKind: 'builtin',
            builtinVideoId: 'qianqian',
            customVideoPath: '',
        },
        lastEndEvent: null,
        ...partial,
    };
}

describe('resolvePomodoroEndAction', () => {
    it('returns topWindow when top popup mode is selected', async () => {
        await expect(resolvePomodoroEndAction(state({ endActionMode: 'topWindow' }), {
            validateCustomVideoPath: vi.fn(),
            customVideoSrc: vi.fn(),
            showCustomVideoMissingMessage: vi.fn(),
        })).resolves.toEqual({ kind: 'topWindow' });
    });

    it('returns the bundled 千千 video by default', async () => {
        await expect(resolvePomodoroEndAction(state({}), {
            validateCustomVideoPath: vi.fn(),
            customVideoSrc: vi.fn(),
            showCustomVideoMissingMessage: vi.fn(),
        })).resolves.toEqual({
            kind: 'video',
            title: '千千',
            src: '/videos/ms1.webm',
        });
    });

    it('validates and returns custom video asset URLs', async () => {
        const validateCustomVideoPath = vi.fn().mockResolvedValue({ ok: true, message: null });
        const customVideoSrc = vi.fn().mockReturnValue('asset:///tmp/custom.webm');

        await expect(resolvePomodoroEndAction(state({
            endActionVideo: {
                sourceKind: 'custom',
                builtinVideoId: 'qianqian',
                customVideoPath: '/tmp/custom.webm',
            },
        }), {
            validateCustomVideoPath,
            customVideoSrc,
            showCustomVideoMissingMessage: vi.fn(),
        })).resolves.toEqual({
            kind: 'video',
            title: 'custom.webm',
            src: 'asset:///tmp/custom.webm',
        });
    });

    it('shows a message and falls back when custom validation fails', async () => {
        const showCustomVideoMissingMessage = vi.fn().mockResolvedValue(undefined);

        await expect(resolvePomodoroEndAction(state({
            endActionVideo: {
                sourceKind: 'custom',
                builtinVideoId: 'qianqian',
                customVideoPath: '/tmp/missing.webm',
            },
        }), {
            validateCustomVideoPath: vi.fn().mockResolvedValue({
                ok: false,
                message: '视频文件不存在，请重新选择',
            }),
            customVideoSrc: vi.fn(),
            showCustomVideoMissingMessage,
        })).resolves.toEqual({ kind: 'topWindow' });
        expect(showCustomVideoMissingMessage).toHaveBeenCalledWith('视频文件不存在，请重新选择');
    });
});
```

- [ ] **Step 2: Run resolver tests to verify they fail**

Run:

```bash
cd app
npx vitest run src/domain/pomodoroEndAction.test.ts
```

Expected: FAIL because `./pomodoroEndAction` does not exist.

- [ ] **Step 3: Implement the resolver**

Create `app/src/domain/pomodoroEndAction.ts`:

```ts
import type { PomodoroState } from './pomodoro';
import { getBuiltinPomodoroVideo } from './pomodoroVideos';
import type { CustomVideoValidation } from './videoFiles';

export type ResolvedPomodoroEndAction =
    | { kind: 'topWindow' }
    | { kind: 'video'; title: string; src: string };

export interface PomodoroEndActionRuntime {
    validateCustomVideoPath: (path: string) => Promise<CustomVideoValidation>;
    customVideoSrc: (path: string) => string;
    showCustomVideoMissingMessage: (text: string) => Promise<void>;
}

function fileName(path: string): string {
    return path.split(/[\\/]/).pop() || path;
}

export async function resolvePomodoroEndAction(
    state: Pick<PomodoroState, 'endActionMode' | 'endActionVideo'>,
    runtime: PomodoroEndActionRuntime,
): Promise<ResolvedPomodoroEndAction> {
    if (state.endActionMode === 'topWindow') {
        return { kind: 'topWindow' };
    }

    if (state.endActionVideo.sourceKind === 'builtin') {
        const video = getBuiltinPomodoroVideo(state.endActionVideo.builtinVideoId);
        if (!video) return { kind: 'topWindow' };
        return { kind: 'video', title: video.name, src: video.url };
    }

    const path = state.endActionVideo.customVideoPath;
    if (!path) {
        await runtime.showCustomVideoMissingMessage('请先选择自定义视频文件');
        return { kind: 'topWindow' };
    }

    const validation = await runtime.validateCustomVideoPath(path);
    if (!validation.ok) {
        await runtime.showCustomVideoMissingMessage(validation.message ?? '视频文件不可用，请重新选择');
        return { kind: 'topWindow' };
    }

    return {
        kind: 'video',
        title: fileName(path),
        src: runtime.customVideoSrc(path),
    };
}
```

- [ ] **Step 4: Run resolver tests**

Run:

```bash
cd app
npx vitest run src/domain/pomodoroEndAction.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add app/src/domain/pomodoroEndAction.ts app/src/domain/pomodoroEndAction.test.ts
git commit -m "feat: resolve pomodoro end actions"
```

## Task 8: Add the Runtime End-Action Layer

**Files:**
- Create: `app/src/ui/PomodoroEndActionLayer.tsx`
- Create: `app/src/ui/PomodoroEndActionLayer.css`
- Create: `app/src/ui/PomodoroEndActionLayer.test.tsx`
- Modify: `app/src/App.tsx`

- [ ] **Step 1: Write layer tests**

Create `app/src/ui/PomodoroEndActionLayer.test.tsx`:

```tsx
import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usePomodoroStore } from '../domain/pomodoro';
import { PomodoroEndActionLayer } from './PomodoroEndActionLayer';

const { resolvePomodoroEndActionMock } = vi.hoisted(() => ({
    resolvePomodoroEndActionMock: vi.fn(),
}));

vi.mock('../domain/pomodoroEndAction', () => ({
    resolvePomodoroEndAction: resolvePomodoroEndActionMock,
}));

vi.mock('../domain/videoFiles', () => ({
    validateCustomVideoPath: vi.fn(),
    customVideoSrc: vi.fn(),
    showCustomVideoMissingMessage: vi.fn(),
}));

beforeEach(() => {
    resolvePomodoroEndActionMock.mockReset();
    usePomodoroStore.setState({
        lastEndEvent: null,
        endActionMode: 'playVideo',
        endActionVideo: {
            sourceKind: 'builtin',
            builtinVideoId: 'qianqian',
            customVideoPath: '',
        },
    });
});

describe('PomodoroEndActionLayer', () => {
    it('shows the top popup when resolver returns topWindow', async () => {
        resolvePomodoroEndActionMock.mockResolvedValue({ kind: 'topWindow' });
        render(<PomodoroEndActionLayer />);

        await act(async () => {
            usePomodoroStore.setState({
                lastEndEvent: {
                    id: 1,
                    fromPhase: 'focus',
                    toPhase: 'break',
                    triggeredBy: 'timer',
                },
            });
        });

        expect(await screen.findByText('专注结束')).toBeTruthy();
    });

    it('shows video overlay when resolver returns video', async () => {
        resolvePomodoroEndActionMock.mockResolvedValue({
            kind: 'video',
            title: '千千',
            src: '/videos/ms1.webm',
        });
        render(<PomodoroEndActionLayer />);

        await act(async () => {
            usePomodoroStore.setState({
                lastEndEvent: {
                    id: 1,
                    fromPhase: 'focus',
                    toPhase: 'break',
                    triggeredBy: 'timer',
                },
            });
        });

        expect(await screen.findByLabelText('播放 千千')).toBeTruthy();
    });
});
```

- [ ] **Step 2: Run layer tests to verify they fail**

Run:

```bash
cd app
npx vitest run src/ui/PomodoroEndActionLayer.test.tsx
```

Expected: FAIL because `PomodoroEndActionLayer` does not exist.

- [ ] **Step 3: Implement the layer**

Create `app/src/ui/PomodoroEndActionLayer.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react';
import { usePomodoroStore, type PomodoroEndEvent } from '../domain/pomodoro';
import { resolvePomodoroEndAction } from '../domain/pomodoroEndAction';
import {
    customVideoSrc,
    showCustomVideoMissingMessage,
    validateCustomVideoPath,
} from '../domain/videoFiles';
import './PomodoroEndActionLayer.css';

interface VideoOverlayState {
    title: string;
    src: string;
}

function popupTitle(event: PomodoroEndEvent): string {
    if (event.toPhase === 'completed') return '番茄钟完成';
    if (event.fromPhase === 'focus') return '专注结束';
    return '休息结束';
}

export function PomodoroEndActionLayer() {
    const [popup, setPopup] = useState<string | null>(null);
    const [video, setVideo] = useState<VideoOverlayState | null>(null);
    const seenId = useRef<number | null>(null);

    useEffect(() => {
        return usePomodoroStore.subscribe((state) => {
            const event = state.lastEndEvent;
            if (!event || event.id === seenId.current) return;
            seenId.current = event.id;

            void resolvePomodoroEndAction(state, {
                validateCustomVideoPath,
                customVideoSrc,
                showCustomVideoMissingMessage,
            }).then((action) => {
                if (action.kind === 'video') {
                    setPopup(null);
                    setVideo({ title: action.title, src: action.src });
                    return;
                }
                setVideo(null);
                setPopup(popupTitle(event));
                window.setTimeout(() => {
                    setPopup((current) => current === popupTitle(event) ? null : current);
                }, 4000);
            });
        });
    }, []);

    return (
        <>
            {popup && <div className="pomo-end-popup" role="status">{popup}</div>}
            {video && (
                <div className="pomo-video-backdrop" role="dialog" aria-label={`播放 ${video.title}`}>
                    <button className="pomo-video-close" type="button" onClick={() => setVideo(null)} aria-label="关闭视频">
                        ×
                    </button>
                    <video
                        className="pomo-video-player"
                        src={video.src}
                        autoPlay
                        controls
                        onEnded={() => setVideo(null)}
                    />
                </div>
            )}
        </>
    );
}
```

- [ ] **Step 4: Add styles**

Create `app/src/ui/PomodoroEndActionLayer.css`:

```css
.pomo-end-popup {
    position: fixed;
    top: 18px;
    left: 50%;
    z-index: 80;
    transform: translateX(-50%);
    padding: 10px 18px;
    border-radius: 8px;
    background: #fffdfb;
    color: #5b4636;
    box-shadow: 0 8px 24px rgba(64, 44, 28, 0.18);
    font-size: 14px;
    font-weight: 700;
}

.pomo-video-backdrop {
    position: fixed;
    inset: 0;
    z-index: 100;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(16, 14, 12, 0.82);
}

.pomo-video-player {
    max-width: min(86vw, 960px);
    max-height: 78vh;
    background: #000;
}

.pomo-video-close {
    position: fixed;
    top: 18px;
    right: 18px;
    width: 32px;
    height: 32px;
    border: 0;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.92);
    color: #3a2d24;
    font-size: 22px;
    line-height: 32px;
    cursor: pointer;
}
```

- [ ] **Step 5: Mount the layer**

In `app/src/App.tsx`, import and render the layer:

```tsx
import { PomodoroEndActionLayer } from './ui/PomodoroEndActionLayer';
```

Render:

```tsx
            <PomodoroPanel />
            <RemoteRoster />
            <PomodoroEndActionLayer />
```

- [ ] **Step 6: Run layer tests**

Run:

```bash
cd app
npx vitest run src/ui/PomodoroEndActionLayer.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit**

Run:

```bash
git add app/src/App.tsx app/src/ui/PomodoroEndActionLayer.tsx app/src/ui/PomodoroEndActionLayer.css app/src/ui/PomodoroEndActionLayer.test.tsx
git commit -m "feat: play pomodoro end videos"
```

## Task 9: Full Verification and Packaging Check

**Files:**
- No planned source changes unless verification exposes a defect.

- [ ] **Step 1: Run focused frontend tests**

Run:

```bash
cd app
npx vitest run \
  src/domain/pomodoroVideos.test.ts \
  src/domain/pomodoro.test.ts \
  src/domain/bridge/protocol.test.ts \
  src/domain/bridge/host.test.ts \
  src/domain/bridge/client.test.ts \
  src/domain/videoFiles.test.ts \
  src/domain/pomodoroEndAction.test.ts \
  src/ui/SettingsPanel.test.tsx \
  src/ui/PomodoroEndActionLayer.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run all frontend tests**

Run:

```bash
cd app
npx vitest run
```

Expected: PASS.

- [ ] **Step 3: Run Rust tests**

Run:

```bash
cd app/src-tauri
cargo test
```

Expected: PASS.

- [ ] **Step 4: Run frontend build**

Run:

```bash
cd app
npm run build
```

Expected: PASS. Confirm `dist/videos/ms1.webm` exists after build:

```bash
test -s dist/videos/ms1.webm
```

Expected: no output and exit code `0`.

- [ ] **Step 5: Run a dev smoke test**

Run:

```bash
cd app
npm run tauri dev
```

Manual checks:

1. Settings > Pomodoro shows `计时结束提示`, `播放视频`, `千千`, and `自定义视频文件`.
2. Ending a 1-second focus session plays the bundled `千千` video.
3. Selecting a custom `.webm` shows its filename after Apply.
4. Moving or deleting the selected custom `.webm`, then ending the timer, shows `视频文件不存在，请重新选择` and then shows the top popup fallback.

- [ ] **Step 6: Commit verification fixes if needed**

If verification required fixes, commit only those fixes:

```bash
git add app
git commit -m "fix: stabilize pomodoro end video flow"
```

If no fixes were needed, do not create an empty commit.
