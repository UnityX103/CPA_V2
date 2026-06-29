#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="${CPA_V2_ROOT:-$(cd "$SCRIPT_DIR/../../../.." && pwd)}"
PORT="${CPA_V2_SERVER_PORT:-8039}"
RUN_DIR="$PROJECT_ROOT/.codex/run"
LOG_DIR="${CPA_V2_LOG_DIR:-$PROJECT_ROOT/.codex/run-logs}"
SERVER_PID_FILE="$RUN_DIR/cpa-v2-server.pid"
TAURI_PID_FILE="$RUN_DIR/cpa-v2-tauri.pid"
SERVER_LOG="$LOG_DIR/cpa-v2-server.log"
TAURI_LOG="$LOG_DIR/cpa-v2-tauri.log"

usage() {
  printf 'Usage: %s [start|stop|restart|status]\n' "$0"
}

ensure_dirs() {
  mkdir -p "$RUN_DIR" "$LOG_DIR"
}

is_pid_running() {
  local pid="${1:-}"
  [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null
}

pid_from_file() {
  local file="$1"
  [[ -f "$file" ]] && tr -d '[:space:]' < "$file" || true
}

is_port_open() {
  nc -z 127.0.0.1 "$PORT" >/dev/null 2>&1
}

wait_for_port() {
  local attempts=40
  while (( attempts > 0 )); do
    if is_port_open; then
      return 0
    fi
    sleep 0.5
    attempts=$((attempts - 1))
  done
  return 1
}

ensure_npm() {
  if ! command -v npm >/dev/null 2>&1; then
    printf 'ERROR: npm is required but was not found in PATH.\n' >&2
    exit 1
  fi
}

start_server() {
  local pid
  pid="$(pid_from_file "$SERVER_PID_FILE")"
  if is_pid_running "$pid"; then
    printf 'server: already running (pid %s)\n' "$pid"
    return 0
  fi

  if is_port_open; then
    printf 'server: port %s is already listening; reusing existing endpoint\n' "$PORT"
    return 0
  fi

  if [[ ! -d "$PROJECT_ROOT/Server/node_modules" ]]; then
    printf 'server: installing dependencies\n'
    (cd "$PROJECT_ROOT/Server" && npm install --package-lock=false) >>"$SERVER_LOG" 2>&1
  fi

  printf 'server: starting on ws://127.0.0.1:%s\n' "$PORT"
  (cd "$PROJECT_ROOT/Server" && PORT="$PORT" nohup npm start >>"$SERVER_LOG" 2>&1 & echo $! > "$SERVER_PID_FILE")

  if wait_for_port; then
    printf 'server: ready on ws://127.0.0.1:%s\n' "$PORT"
  else
    printf 'server: did not become ready; see %s\n' "$SERVER_LOG" >&2
    return 1
  fi
}

start_tauri() {
  local pid
  pid="$(pid_from_file "$TAURI_PID_FILE")"
  if is_pid_running "$pid"; then
    printf 'tauri: already running (pid %s)\n' "$pid"
    return 0
  fi

  if [[ ! -d "$PROJECT_ROOT/app/node_modules" ]]; then
    printf 'tauri: installing dependencies\n'
    (cd "$PROJECT_ROOT/app" && npm install) >>"$TAURI_LOG" 2>&1
  fi

  printf 'tauri: starting desktop app\n'
  (cd "$PROJECT_ROOT/app" && nohup npm run tauri -- dev >>"$TAURI_LOG" 2>&1 & echo $! > "$TAURI_PID_FILE")
  sleep 2
  pid="$(pid_from_file "$TAURI_PID_FILE")"
  if is_pid_running "$pid"; then
    printf 'tauri: launch command running (pid %s)\n' "$pid"
  else
    printf 'tauri: launch command exited early; see %s\n' "$TAURI_LOG" >&2
    return 1
  fi
}

stop_pid_file() {
  local label="$1"
  local file="$2"
  local pid
  pid="$(pid_from_file "$file")"
  if is_pid_running "$pid"; then
    printf '%s: stopping pid %s\n' "$label" "$pid"
    kill "$pid" 2>/dev/null || true
  else
    printf '%s: not running\n' "$label"
  fi
  rm -f "$file"
}

status() {
  local server_pid tauri_pid
  server_pid="$(pid_from_file "$SERVER_PID_FILE")"
  tauri_pid="$(pid_from_file "$TAURI_PID_FILE")"

  if is_pid_running "$server_pid"; then
    printf 'server: running (pid %s)\n' "$server_pid"
  elif is_port_open; then
    printf 'server: port %s is listening (external or unmanaged process)\n' "$PORT"
  else
    printf 'server: stopped\n'
  fi

  if is_pid_running "$tauri_pid"; then
    printf 'tauri: running (pid %s)\n' "$tauri_pid"
  else
    printf 'tauri: stopped\n'
  fi

  printf 'logs: %s\n' "$LOG_DIR"
}

start() {
  ensure_dirs
  ensure_npm
  start_server
  start_tauri
  status
}

stop() {
  ensure_dirs
  stop_pid_file tauri "$TAURI_PID_FILE"
  stop_pid_file server "$SERVER_PID_FILE"
}

case "${1:-start}" in
  start)
    start
    ;;
  stop)
    stop
    ;;
  restart)
    stop
    start
    ;;
  status)
    ensure_dirs
    status
    ;;
  -h|--help|help)
    usage
    ;;
  *)
    usage >&2
    exit 2
    ;;
esac
