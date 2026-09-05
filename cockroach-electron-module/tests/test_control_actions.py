import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('prepare_actions', ROOT / 'scripts/prepare_source.py')
PREPARE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PREPARE)


class ControlActionsTest(unittest.TestCase):
    def test_spawn_once_acknowledges_without_repeating_and_kill_still_works(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory)
            overlay = source / 'src/overlay/overlay.js'
            overlay.parent.mkdir(parents=True)
            (source / 'main.js').write_text(
                "const fs = require('fs');\nlet tray = null;\n"
                "  startCursorPolling();\n  startHitTestPolling();\n"
                "app.on('will-quit', () => {\n  globalShortcut.unregisterAll();\n"
            )
            overlay.write_text("ipcRenderer.on('kill-all', () => {\n  manager.killAll();\n});")
            with mock.patch.object(PREPARE.subprocess, 'check_output', side_effect=[PREPARE.UPSTREAM_COMMIT + '\n', '']):
                PREPARE.prepare(source)
            script = r"""
const vm = require('node:vm');
const assert = require('node:assert/strict');
const payload = JSON.parse(require('node:fs').readFileSync(0, 'utf8'));
let command, ack, poll, count = 0, spawnCalls = 0;
const renderer = {}, main = {};
const context = vm.createContext({
    process: { argv: ['--cpa-control-file=/tmp/control.json'] },
    fs: { readFileSync: () => JSON.stringify(command), writeFileSync: (_path, value) => { ack = JSON.parse(value); } },
    setInterval: (fn) => { poll = fn; return 1; }, clearInterval: () => {}, console,
    ipcMain: { on: (name, fn) => { main[name] = fn; } },
    overlayWindow: { isDestroyed: () => false, webContents: { isLoading: () => false,
        send: (name, nonce) => renderer[name]({}, nonce) } },
});
vm.runInContext(payload.main, context);
vm.runInNewContext(payload.overlay, {
    ipcRenderer: { on: (name, fn) => { renderer[name] = fn; }, send: (name, nonce) => main[name]({}, nonce) },
    manager: { spawn: () => { spawnCalls++; count = Math.min(2, count + 1); }, killAll: () => { count = 0; } },
    canvas: { width: 800, height: 600 },
});
vm.runInContext('startCpaControlFile()', context);
for (let nonce of ['one', 'two', 'three']) {
    command = { v: 1, command: 'spawn-one', nonce };
    poll(); poll(); // Unchanged control files must not create another cockroach.
    assert.equal(ack.nonce, nonce);
    assert.equal(ack.ok, true);
}
assert.equal(spawnCalls, 3);
assert.equal(count, 2);
command = { v: 1, command: 'kill-all', nonce: 'kill' };
poll(); assert.equal(count, 0); assert.equal(ack.nonce, 'kill');
command = { v: 1, command: 'shell', nonce: 'invalid' };
poll(); assert.equal(ack.nonce, 'kill');
"""
            subprocess.run(['node', '-e', script], input=json.dumps({
                'main': PREPARE.CONTROL_BLOCK, 'overlay': overlay.read_text(),
            }), text=True, check=True, capture_output=True)


if __name__ == '__main__':
    unittest.main()
