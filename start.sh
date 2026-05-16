#!/usr/bin/env bash
# 一键启动 CPA_V2（macOS）
# - 后台拉起 Server (ws://127.0.0.1:8039)
# - 前台运行 Tauri dev（关掉它会顺带 kill Server）
# - 自动补齐 cargo PATH（brew 装 rustup 时不会生成 ~/.cargo/bin 软链）
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

log() { printf '\033[1;36m[start]\033[0m %s\n' "$*"; }
err() { printf '\033[1;31m[start]\033[0m %s\n' "$*" >&2; }

# --- 1. 确保 cargo 在 PATH 上 ----------------------------------------------
if ! command -v cargo >/dev/null 2>&1; then
  CARGO_BIN=""
  if [ -x "$HOME/.cargo/bin/cargo" ]; then
    CARGO_BIN="$HOME/.cargo/bin"
  else
    # brew rustup 把工具链放在 ~/.rustup/toolchains/<triple>/bin/cargo
    for d in "$HOME/.rustup/toolchains"/*/bin; do
      if [ -x "$d/cargo" ]; then CARGO_BIN="$d"; break; fi
    done
  fi
  if [ -z "$CARGO_BIN" ]; then
    err "找不到 cargo。请先 rustup default stable，或 brew install rustup && rustup-init -y"
    exit 1
  fi
  export PATH="$CARGO_BIN:$PATH"
  log "已注入 cargo 路径: $CARGO_BIN"
fi

# --- 2. Server: 已在 :8039 监听就跳过 --------------------------------------
SERVER_PID=""
if lsof -iTCP:8039 -sTCP:LISTEN -n -P >/dev/null 2>&1; then
  log "Server 已在 :8039 监听，跳过启动"
else
  log "启动 Server (Server/ → npm start)"
  ( cd Server && npm start ) &
  SERVER_PID=$!
  log "Server PID = $SERVER_PID"
fi

cleanup() {
  if [ -n "$SERVER_PID" ] && kill -0 "$SERVER_PID" 2>/dev/null; then
    log "关闭 Server (PID $SERVER_PID)"
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

# --- 3. Tauri dev（前台，Ctrl-C 退出整套） ---------------------------------
log "启动 Tauri dev (app/ → npm run tauri dev)"
cd app
npm run tauri dev
