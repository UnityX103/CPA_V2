# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## What this is

`CPA_V2` is the **Tauri 2 + Rust + React/TS** rewrite of `CPA`, a desktop-pet pomodoro originally built on Unity 6 + QFramework. The goal is full feature parity with the Unity app while shedding the Unity stack. See `docs/superpowers/specs/2026-05-15-cpa-tauri-rewrite-design.md` for the migration scope, what's intentionally not migrated (HybridCLR, FFmpegOut, Unity Test Framework, etc.), and the iteration plan.

Runtime and release targets are **macOS x86_64 + macOS ARM64, and Windows x86_64**. Build macOS as two separate thin artifacts (`x86_64-apple-darwin` and `aarch64-apple-darwin`), each carrying only its matching self-contained runtime; do not build Universal macOS binaries. Windows remains x86_64 NSIS only unless the user explicitly asks for Windows ARM64.

**Target platforms: macOS and Windows.** Any new native feature in `src-tauri/` MUST ship both implementations (or call out an explicit Windows follow-up). Existing modules (`key_counter`, `active_app`) currently only have macOS impls with `#[cfg(not(target_os = "macos"))]` no-op stubs — that is tech debt to be filled in, not the design intent. Encapsulate platform differences under `src-tauri/src/<feature>/{macos,windows}.rs` with a platform-neutral Tauri-command surface.

## Top-level layout

```
CPA_V2/
├── app/                ← Tauri 2 desktop app (frontend + Rust shell)
│   ├── src/            ← React + TypeScript
│   │   ├── domain/     ← Zustand stores + services (Pomodoro / Network / BindingKey / ActiveApp / Settings / stateSync)
│   │   ├── extensions/ ← Lazy feature runtimes driven by signed extension manifests
│   │   ├── ui/         ← React UI components and their native CSS
│   │   └── styles/     ← global.css + tokens.css (no Tailwind, native CSS only)
│   └── src-tauri/      ← Rust (lib.rs, active_app.rs, key_counter.rs)
├── Server/             ← Node.js WebSocket backend (port 8039) — has its own .git
├── .agents/skills/cpa-v2-extension-packs/ ← Extension implementation contract and validation
└── docs/superpowers/   ← Specs and adversarial reviews
```

## Common commands

### Graphify knowledge graph
- After every completed modification to project files—including code, tests, documentation, configuration, and assets—run `graphify update .` from the repository root before reporting the task as complete.
- Treat a successful Graphify update as part of the definition of done. If the update fails, report the failure explicitly instead of claiming completion.

### Extension skill validation
- Validate the project-local extension skill without changing global Python packages: `uv run --with pyyaml python ~/.codex/skills/.system/skill-creator/scripts/quick_validate.py .agents/skills/cpa-v2-extension-packs`.

### Tauri app (`app/`)
- Dev (Rust + Vite + opens transparent window): `cd app && npm run tauri dev`
- Frontend-only dev server: `cd app && npm run dev`
- Build: `cd app && npm run build` (runs `tsc && vite build`)
- All tests: `cd app && npm test` (vitest run; jsdom env)
- Single test file: `cd app && npx vitest run src/domain/pomodoro.test.ts`
- Tauri CLI passthrough: `cd app && npm run tauri -- <args>`

### Server (`Server/`)
- Install: `cd Server && npm install --package-lock=false`
- Start: `cd Server && npm start` (listens on `ws://127.0.0.1:8039`; override via `PORT` env)
- All tests: `cd Server && npm test` (which runs `node --test test/*.js` — not `node --test test/`, see `Server/README.md` for why on Node 25)
- Single test file: `cd Server && node --test test/protocol.test.js`

### Updater release publishing
- Updater endpoints are ordered CNB first, GitHub second: `https://cnb.cool/nanzhaigame-xpy/CPA_V2/-/releases/latest/download/latest.json`, then `https://github.com/UnityX103/CPA_V2/releases/latest/download/latest.json`. Tauri only tries the second endpoint when the first returns a non-2xx response.
- The GitHub source repository is mirrored to `https://cnb.cool/nanzhaigame-xpy/CPA_V2`. Every release must push the same branch/tag and publish matching assets to both remotes; do not publish GitHub Latest until the CNB mirror has passed its public download checks.
- Publish generated files from `app/release-updates/` as GitHub Release assets on `UnityX103/CPA_V2` and CNB Release assets on `nanzhaigame-xpy/CPA_V2`; do not use `updates.nanzhaigame.cn` for new releases.
- Generate provider-specific manifests with `app/scripts/prepare-cnb-release.mjs`. Updater binary signatures are reusable, but the CNB video-module index must be re-signed after its package URLs are rewritten. CNB indexes carry GitHub package URLs as signed mirrors.
- Use `app/scripts/sync-cnb-release.mjs` for CNB asset uploads. It uploads `latest.json` last, verifies every remote size/hash, and only then marks the CNB Release as Latest.
- GitHub credentials are not stored in this repo. Use `gh auth status` before publishing, and keep release keys inside the ignored `cpa-v2-release/` credential pack.
- Do not publish macOS packages built with `--no-sign`. The repo defaults to ad-hoc macOS signing (`bundle.macOS.signingIdentity = "-"`) as a minimum resource-seal fix, but polished public downloads require Developer ID signing plus Apple notarization.
- macOS updater publishing supports both `darwin-x86_64` and `darwin-aarch64`; publish only keys whose matching thin package was built and verified. Windows updater publishing remains x64 / x86_64 only.
- For Windows updater packages, `latest.json` must include `windows-x86_64-nsis` and `windows-x86_64` platform keys in addition to macOS keys.
- Windows release publishing targets **x86_64 NSIS only**. Do not build or publish Windows ARM64 packages unless the user explicitly asks for an ARM64 Windows release.

## Architecture: state layering (borrowed from Unity QFramework)

The domain layer is structured to mirror what existed in Unity, so the Unity field names and module boundaries carry over directly:

- **Domain Store ≈ Model**: Each domain has a Zustand store (`app/src/domain/{pomodoro,network,bindingKey,activeApp,settings}.ts`). Components read from these stores; they do not mutate state directly.
- **Service ≈ System**: Behaviour lives in store *actions* and React hooks (`useStateSync`, `useActiveAppListener`, `useBindingKeyListener`). The cross-store synchroniser is `app/src/domain/stateSync.ts`.
- **Tauri command/event ≈ Utility/IPC**: Native operations (window control, foreground-app query, global keyboard, hit-test passthrough) live in Rust under `app/src-tauri/src/` and are exposed via `#[tauri::command]` (invoke) or `app.emit("...")` (events). On macOS these go through AppKit (NSWorkspace, CGEventTap, NSView hitTest); on Windows through Win32 (GetForegroundWindow, SetWindowsHookEx, WM_NCHITTEST). The command/event surface is identical across platforms.

The protocol layer (`Server/src/protocol.js` + `app/src/domain/network.ts`) carries `RemoteState = { pomodoro, activeApp, bindingKey }`. Every wire message includes `v: PROTOCOL_VERSION` (currently `1`); mismatched versions are rejected and the connection is closed.

## Downloadable extension packs

**Use the `cpa-v2-extension-packs` skill whenever adding, migrating, reviewing, or troubleshooting an optional downloadable module, common runtime, extension settings page, module lifecycle action, or signed module manifest.** Read its extension contract before changing code.

- Current pack graph: `video.editor → video.core` and `pet.cockroach-invasion → pet.core`.
- Before adding a second feature to an existing family, follow the skill's multi-feature storage rules: common dependencies may have many dependents, and every feature needs its own active pointer and deterministic settings contribution.
- Optional runtimes, models, and feature logic must remain outside the default app bundle. Features install their common dependencies automatically; shared components use content-addressed storage and independent pointers.
- Native status is authoritative. Installation, upgrade, enable/disable, and uninstall go through the unified commands in `src-tauri/src/extension_packs.rs`; do not reintroduce feature-specific lifecycle buttons or frontend-only enablement.
- A common pack cannot be disabled while an enabled dependent uses it or uninstalled while any dependent remains installed. Layered feature uninstall preserves common components. Legacy monolithic packages must upgrade before feature-only uninstall.
- Enabled, installed features contribute settings tabs through `app/src/domain/extensionPacks.ts` and `app/src/ui/ExtensionSettingsOutlet.tsx`. Do not maintain parallel pack-ID lists or hard-coded navigation branches.
- The CPA core publishes `pomodoro-broadcast-v1`. Pet-specific policy belongs to the signed feature manifest's `runtimeContribution`; `pet.core` owns only reusable runtime, dependencies, process lifecycle, and control protocol.
- Feature activation is allow-listed by pack ID in Rust. Never execute shell commands or arbitrary remote React/JavaScript supplied by a manifest.
- Platform-specific extension code follows the same macOS/Windows file split required for all native features.

## Non-obvious rules and constraints

- **UI workflow:** Implement and refine UI directly in React/TypeScript and native CSS using the user’s requirements, supplied screenshots, and existing components/styles. Validate the rendered interface and relevant interactions. Pencil files and design synchronization are no longer maintained or required; do not create or update `.pen` files or block work on Pencil availability. References to Pencil nodes or Pencil-first steps in historical specs, plans, research, and code comments are historical context only and impose no current workflow requirements.
- **Tauri capabilities are intentionally minimal.** `app/src-tauri/capabilities/default.json` only allows `core:default`, `core:window:default`, `core:window:allow-start-dragging`, `core:event:default`. All privileged operations (always-on-top, click-through, active-app query) must go through a `#[tauri::command]` defined in `lib.rs`. CSP is set in `tauri.conf.json` — do not disable it. (See adversarial-review #4.)
- **WebSocket reconnect uses a generation counter.** `network.ts` increments `internal.generation` on every new socket / leave / disconnect; stale `onopen`/`onmessage`/`onclose` callbacks that don't match the current generation are no-ops. When adding new socket lifecycle code, preserve this guard. (Adversarial-review #2.)
- **`stateSync.lastSent` is keyed by `roomCode:playerId:payload`**, and reset on `joined → not-joined` and `not-joined → joined`. A naive payload-only key will silently drop the first heartbeat of a re-joined room. (Adversarial-review #3.)
- **Pomodoro `accumulator` must be zeroed on every phase transition** (`pomodoro.ts:38,55`). Carrying it across `focus → break` shortens the first break second. (Adversarial-review #7.)
- **Server is single-node by design.** Rooms / icon cache / rate windows live in in-process `Map`s. Do not assume multi-node deployment. (Adversarial-review #8.)
- **Server caps incoming WebSocket payload at 2 MiB** (`Server/src/index.js:32`); the `ws` library enforces this before `JSON.parse`. Do not parse-then-cap.
- **Native bridges have platform-specific permission/availability requirements.**
  - macOS `key_counter.rs` uses `CGEventTap` and silently no-ops without Accessibility permission. The Windows equivalent (low-level keyboard hook via `SetWindowsHookEx(WH_KEYBOARD_LL, ...)`) does not require permission but is subject to UIPI when a higher-IL window is foreground — surface this in the UI same way as Accessibility on macOS.
  - macOS `active_app.rs` uses `NSWorkspace.frontmostApplication`; Windows uses `GetForegroundWindow` + `QueryFullProcessImageName`. The 1Hz poll thread lives in `lib.rs` and exits on `RunEvent::ExitRequested|Exit` via `AtomicBool`. Don't spin a new unbounded thread without the same shutdown hook. (Adversarial-review #6.)
- **Window is transparent / always-on-top / decorationless** by `tauri.conf.json` and re-asserted in `lib.rs::setup`. Resizing/positioning logic must respect this. The transparent overlay relies on native per-region hit-testing for mouse passthrough — `NSView.hitTest:` on macOS returning `nil` for non-UI regions, `WM_NCHITTEST` on Windows returning `HTTRANSPARENT`. Do NOT toggle `set_ignore_cursor_events` / `WS_EX_TRANSPARENT` as a substitute; they're whole-window switches that race with cursor motion.

## Tests live alongside source

`app/src/domain/*.test.ts` (vitest, jsdom). The 5 client-side tests required by the spec are listed in `docs/superpowers/specs/2026-05-15-adversarial-review.md` Finding #10 — keep these as the minimum coverage when refactoring `pomodoro.ts`, `network.ts`, or `stateSync.ts`. Server tests cover room manager, protocol, integration, and end-to-end latency.
