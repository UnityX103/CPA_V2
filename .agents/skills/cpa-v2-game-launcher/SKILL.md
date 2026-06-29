---
name: cpa-v2-game-launcher
description: Launch and manage the CPA_V2 desktop-pet game locally. Use when the user asks to start, run, open, restart, stop, or check the game/app, including phrases like "启动游戏", "运行游戏", "打开桌宠", "start CPA_V2", "launch the Tauri app", or "run the local multiplayer server".
---

# CPA_V2 Game Launcher

## Overview

Use this skill to start the CPA_V2 local development runtime: the Node.js WebSocket server on `ws://127.0.0.1:8039` and the Tauri desktop app from `app/`. Runtime and release targets are x64/x86_64 only unless the user explicitly asks for ARM.

## Quick Workflow

1. Confirm the current workspace is the CPA_V2 project root, or set `CPA_V2_ROOT` to it.
2. Run the bundled launcher:

```bash
.agents/skills/cpa-v2-game-launcher/scripts/launch_game.sh start
```

3. Report the desktop app launch status and log paths to the user.
4. If launch fails, inspect `.codex/run-logs/cpa-v2-server.log` and `.codex/run-logs/cpa-v2-tauri.log`.

## Commands

Start or reuse running processes:

```bash
.agents/skills/cpa-v2-game-launcher/scripts/launch_game.sh start
```

Restart both processes managed by this launcher:

```bash
.agents/skills/cpa-v2-game-launcher/scripts/launch_game.sh restart
```

Check status:

```bash
.agents/skills/cpa-v2-game-launcher/scripts/launch_game.sh status
```

Stop processes started by this launcher:

```bash
.agents/skills/cpa-v2-game-launcher/scripts/launch_game.sh stop
```

## Launch Rules

- Start the server from `Server/` with `npm start`; it defaults to port `8039`.
- Start the desktop app from `app/` with `npm run tauri -- dev`; Tauri starts Vite through `beforeDevCommand`.
- Do not start release packaging, updater publishing, or ARM/ARM64 builds for a simple game launch request.
- Keep the launcher non-destructive. Do not kill unrelated processes that happen to use port `8039`; report that the port is occupied and reuse it as the multiplayer endpoint.
- Use `.codex/run/` for pid files and `.codex/run-logs/` for logs.

## Troubleshooting

- If `npm` dependencies are missing, the launcher runs `npm install --package-lock=false` in `Server/` and `npm install` in `app/`.
- If the server is unreachable after startup, read `.codex/run-logs/cpa-v2-server.log`.
- If the Tauri window does not open, read `.codex/run-logs/cpa-v2-tauri.log` and check that Rust/Tauri dependencies are installed.
- If macOS key counting does not work, remind the user that Accessibility permission may be required; do not treat it as a launch failure.
