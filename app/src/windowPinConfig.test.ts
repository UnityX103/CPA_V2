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

describe('main window pin configuration', () => {
    it('does not default the main Tauri window to always-on-top', () => {
        const conf = JSON.parse(readFileSync(tauriConfPath, 'utf8'));
        const main = conf.app.windows.find((w: { label?: string }) => w.label === 'main');
        expect(main, 'main window config should exist').toBeTruthy();
        expect(main.alwaysOnTop).not.toBe(true);
    });

    it('registers a narrow command that can only pin the main window', () => {
        const source = libRs();
        expect(source).toMatch(/fn set_main_window_pinned\(\s*app:\s*tauri::AppHandle,\s*on_top:\s*bool\s*\)\s*->\s*Result<\(\),\s*String>/);
        expect(source).toMatch(/get_webview_window\("main"\)[\s\S]*set_always_on_top\(on_top\)/);
        expect(source).toMatch(/tauri::generate_handler!\[[\s\S]*set_main_window_pinned/);
        expect(source).not.toMatch(/fn set_always_on_top\(\s*window:\s*WebviewWindow,\s*on_top:\s*bool\s*\)/);
    });

    it('does not force main or settings windows to pinned during startup', () => {
        const source = libRs();
        expect(source).not.toMatch(/get_webview_window\("main"\)\s*\{\s*let _ = window\.set_always_on_top\(true\);/);
        expect(source).not.toMatch(/WebviewWindowBuilder::new\(app,\s*"settings"[\s\S]*?\.always_on_top\(true\)/);
    });

    it('restores the accessibility prompt yield to the previous pin state, not always true', () => {
        const source = accessibilityRs();
        expect(source).toMatch(/let was_main_on_top = main\.is_always_on_top\(\)\.unwrap_or\(false\);/);
        expect(source).toMatch(/main\.set_always_on_top\(was_main_on_top\)/);
        expect(source).not.toMatch(/set_always_on_top\(true\)/);
    });
});
