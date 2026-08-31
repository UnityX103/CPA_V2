#!/usr/bin/env python3
"""Apply the reviewed CPA control protocol to the pinned upstream checkout."""

from __future__ import annotations

import argparse
import subprocess
from pathlib import Path

UPSTREAM_COMMIT = "a7d103d2818b40e12b8a39948e9ebf4c6085bfd3"

CONTROL_BLOCK = """const CPA_CONTROL_PROTOCOL_VERSION = 1;
const cpaControlArg = process.argv.find((arg) => arg.startsWith('--cpa-control-file='));
const cpaControlFile = cpaControlArg ? cpaControlArg.slice('--cpa-control-file='.length) : null;
const cpaControlAckFile = cpaControlFile ? cpaControlFile.replace(/\\.json$/, '.ack.json') : null;
let cpaControlPollInterval = null;
let cpaLastControlNonce = null;
let cpaPendingControlNonce = null;

function startCpaControlFile() {
  if (!cpaControlFile || !cpaControlAckFile) return;
  cpaControlPollInterval = setInterval(() => {
    try {
      const command = JSON.parse(fs.readFileSync(cpaControlFile, 'utf8'));
      if (command.v !== CPA_CONTROL_PROTOCOL_VERSION ||
          typeof command.nonce !== 'string' ||
          command.nonce === cpaLastControlNonce ||
          command.nonce === cpaPendingControlNonce ||
          command.command !== 'kill-all') return;
      if (!overlayWindow || overlayWindow.isDestroyed() || overlayWindow.webContents.isLoading()) return;
      cpaPendingControlNonce = command.nonce;
      overlayWindow.webContents.send('kill-all', command.nonce);
    } catch (error) {
      if (error && error.code !== 'ENOENT') {
        console.error('[cpa-control] command failed', error);
      }
    }
  }, 50);
}

function stopCpaControlFile() {
  if (cpaControlPollInterval) clearInterval(cpaControlPollInterval);
  cpaControlPollInterval = null;
}

ipcMain.on('cpa-control-complete', (_event, nonce) => {
  if (!cpaControlAckFile || nonce !== cpaPendingControlNonce) return;
  cpaLastControlNonce = nonce;
  cpaPendingControlNonce = null;
  fs.writeFileSync(cpaControlAckFile, JSON.stringify({
    v: CPA_CONTROL_PROTOCOL_VERSION,
    nonce,
    ok: true,
  }));
});
"""


def replace_once(value: str, old: str, new: str, label: str) -> str:
    if value.count(old) != 1:
        raise ValueError(f"unexpected upstream {label}; reviewed adapter cannot be applied")
    return value.replace(old, new, 1)


def prepare(source_dir: Path) -> None:
    source_dir = source_dir.resolve()
    commit = subprocess.check_output(
        ["git", "-C", str(source_dir), "rev-parse", "HEAD"], text=True,
    ).strip()
    if commit != UPSTREAM_COMMIT:
        raise ValueError(f"upstream commit must be {UPSTREAM_COMMIT}, got {commit}")
    status = subprocess.check_output(
        ["git", "-C", str(source_dir), "status", "--porcelain", "--untracked-files=all"],
        text=True,
    )
    if status:
        raise ValueError("upstream checkout must be clean before applying the CPA adapter")

    main_path = source_dir / "main.js"
    overlay_path = source_dir / "src" / "overlay" / "overlay.js"
    main = main_path.read_text(encoding="utf-8")
    main = replace_once(main, "let tray = null;\n", f"let tray = null;\n\n{CONTROL_BLOCK}\n", "main globals")
    main = replace_once(
        main,
        "  startCursorPolling();\n  startHitTestPolling();\n",
        "  startCursorPolling();\n  startHitTestPolling();\n  startCpaControlFile();\n",
        "startup",
    )
    main = replace_once(
        main,
        "app.on('will-quit', () => {\n  globalShortcut.unregisterAll();\n",
        "app.on('will-quit', () => {\n  stopCpaControlFile();\n  globalShortcut.unregisterAll();\n",
        "shutdown",
    )
    overlay = overlay_path.read_text(encoding="utf-8")
    overlay = replace_once(
        overlay,
        "ipcRenderer.on('kill-all', () => {\n  manager.killAll();\n});",
        "ipcRenderer.on('kill-all', (_event, controlNonce) => {\n"
        "  manager.killAll();\n"
        "  if (typeof controlNonce === 'string') {\n"
        "    ipcRenderer.send('cpa-control-complete', controlNonce);\n"
        "  }\n"
        "});",
        "renderer kill-all handler",
    )
    with main_path.open("w", encoding="utf-8", newline="\n") as destination:
        destination.write(main)
    with overlay_path.open("w", encoding="utf-8", newline="\n") as destination:
        destination.write(overlay)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-dir", type=Path, required=True)
    args = parser.parse_args()
    prepare(args.source_dir)


if __name__ == "__main__":
    main()
