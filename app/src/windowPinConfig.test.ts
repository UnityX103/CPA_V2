import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const tauriConfPath = path.join(here, '../src-tauri/tauri.conf.json');
const libRsPath = path.join(here, '../src-tauri/src/lib.rs');
const accessibilityRsPath = path.join(here, '../src-tauri/src/accessibility/mod.rs');

function libRs(): string {
    return readFileSync(libRsPath, 'utf8');
}

function accessibilityRs(): string {
    return readFileSync(accessibilityRsPath, 'utf8');
}

function rustFunction(source: string, name: string): { signature: string; body: string } | null {
    const signatureStart = source.search(new RegExp(`(?:pub(?:\\([^)]*\\))?\\s+)?(?:async\\s+)?fn\\s+${name}\\s*\\(`));
    if (signatureStart < 0) {
        return null;
    }

    const bodyStart = source.indexOf('{', signatureStart);
    if (bodyStart < 0) {
        return null;
    }

    let depth = 0;
    for (let i = bodyStart; i < source.length; i += 1) {
        if (source[i] === '{') {
            depth += 1;
        } else if (source[i] === '}') {
            depth -= 1;
            if (depth === 0) {
                return {
                    signature: source.slice(signatureStart, bodyStart),
                    body: source.slice(bodyStart + 1, i),
                };
            }
        }
    }

    return null;
}

function blockAfter(source: string, anchor: string): string | null {
    const anchorIndex = source.indexOf(anchor);
    if (anchorIndex < 0) {
        return null;
    }

    const blockStart = source.indexOf('{', anchorIndex);
    if (blockStart < 0) {
        return null;
    }

    let depth = 0;
    for (let i = blockStart; i < source.length; i += 1) {
        if (source[i] === '{') {
            depth += 1;
        } else if (source[i] === '}') {
            depth -= 1;
            if (depth === 0) {
                return source.slice(blockStart + 1, i);
            }
        }
    }

    return null;
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

describe('main window pin configuration', () => {
    it('does not default the main Tauri window to always-on-top', () => {
        const conf = JSON.parse(readFileSync(tauriConfPath, 'utf8'));
        expect(Array.isArray(conf.app?.windows), 'app.windows should be an array').toBe(true);
        if (!Array.isArray(conf.app?.windows)) {
            return;
        }

        const main = conf.app.windows.find((w: { label?: string }) => w.label === 'main');
        expect(main, 'main window config should exist').toBeTruthy();
        expect(main.alwaysOnTop).not.toBe(true);
    });

    it('registers a narrow command that can only pin the main window', () => {
        const source = libRs();
        const command = rustFunction(source, 'set_main_window_pinned');
        expect(command, 'set_main_window_pinned command should exist').not.toBeNull();
        if (!command) {
            return;
        }

        expect(command.signature).toMatch(/(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+set_main_window_pinned\s*\([\s\S]*\)\s*->\s*Result\s*<\s*\(\s*\)\s*,\s*String\s*>/);
        expect(command.signature).toMatch(/\b\w+\s*:\s*(?:tauri\s*::\s*)?AppHandle\b/);
        const boolParam = command.signature.match(/\b([A-Za-z_]\w*)\s*:\s*bool\b/);
        expect(boolParam, 'set_main_window_pinned should accept a bool parameter').not.toBeNull();
        if (!boolParam) {
            return;
        }

        expect(command.body).toMatch(/get_webview_window\("main"\)/);
        expect(command.body).toMatch(new RegExp(`\\.set_always_on_top\\(\\s*${escapeRegExp(boolParam[1])}\\s*\\)`));
        expect(source).toMatch(/tauri::generate_handler!\[[\s\S]*set_main_window_pinned/);
        expect(source).not.toMatch(/fn set_always_on_top\(\s*window:\s*WebviewWindow,\s*on_top:\s*bool\s*\)/);
    });

    it('does not force main or settings windows to pinned during startup', () => {
        const source = libRs();
        const run = rustFunction(source, 'run');
        const settingsBuilder = rustFunction(source, 'build_settings_window_hidden');
        expect(run, 'run function should exist').not.toBeNull();
        expect(settingsBuilder, 'settings window builder should exist').not.toBeNull();
        if (!run || !settingsBuilder) {
            return;
        }

        const setupBlock = blockAfter(run.body, '.setup(move |app|');
        expect(setupBlock, 'setup block should exist').not.toBeNull();
        if (!setupBlock) {
            return;
        }

        expect(setupBlock).not.toMatch(/get_webview_window\("main"\)[\s\S]{0,160}\.\s*set_always_on_top\(\s*true\s*\)/);
        expect(settingsBuilder.body).not.toMatch(/WebviewWindowBuilder::new\(app,\s*"settings"[\s\S]*?\.always_on_top\(\s*true\s*\)/);
    });

    it('restores permission-window pin states without overwriting a newer main choice', () => {
        const source = accessibilityRs();
        const yieldWindows = rustFunction(source, 'yield_permission_windows');
        const restoreWindows = rustFunction(source, 'restore_permission_windows');
        const request = rustFunction(source, 'request_accessibility_permission');
        expect(yieldWindows, 'yield_permission_windows should exist').not.toBeNull();
        expect(restoreWindows, 'restore_permission_windows should exist').not.toBeNull();
        expect(request, 'request_accessibility_permission should exist').not.toBeNull();
        if (!yieldWindows || !restoreWindows || !request) {
            return;
        }

        expect(source).toMatch(/PERMISSION_UI_WINDOW_LABELS[^=]*=\s*&\["main",\s*"settings"\]/);
        expect(yieldWindows.body).toMatch(/is_always_on_top\(\)/);
        expect(yieldWindows.body).toMatch(/\.set_always_on_top\(false\)/);
        expect(yieldWindows.body).toMatch(/macos::deactivate_app\(\)/);
        expect(restoreWindows.body).toMatch(/should_restore_main\([\s\S]*main_pin_generation\(\)/);
        expect(restoreWindows.body).toMatch(/state\.label\s*==\s*"main"\s*&&\s*!restore_main/);
        expect(restoreWindows.body).toMatch(/\.set_always_on_top\(state\.always_on_top\)/);
        expect(restoreWindows.body).not.toMatch(/\.set_always_on_top\(\s*(?:true|false)\s*\)/);
        expect(request.body).toMatch(/yield_permission_windows\(\s*&app\s*\)/);
        const restoreBlock = blockAfter(request.body, 'tauri::async_runtime::spawn(async move');
        expect(restoreBlock, 'accessibility prompt should restore state from its async restore task').not.toBeNull();
        if (!restoreBlock) {
            return;
        }

        expect(restoreBlock).toMatch(/restore_permission_windows\(\s*&restore_app,\s*snapshot\s*\)/);
    });
});
