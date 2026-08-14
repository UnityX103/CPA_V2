import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const tauriConfPath = path.join(here, '../src-tauri/tauri.conf.json');
const globalCssPath = path.join(here, 'styles/global.css');
const libRsPath = path.join(here, '../src-tauri/src/lib.rs');
const windowHelpersPath = path.join(here, '../src-tauri/src/window_helpers/mod.rs');
const macosWindowHelpersPath = path.join(here, '../src-tauri/src/window_helpers/macos.rs');
const windowsWindowHelpersPath = path.join(here, '../src-tauri/src/window_helpers/windows.rs');

function blockAfter(source: string, selector: string): string {
    const index = source.indexOf(selector);
    expect(index, `${selector} should exist`).toBeGreaterThanOrEqual(0);
    const start = source.indexOf('{', index);
    expect(start, `${selector} should have a block`).toBeGreaterThanOrEqual(0);
    let depth = 0;
    for (let i = start; i < source.length; i += 1) {
        if (source[i] === '{') depth += 1;
        if (source[i] === '}') {
            depth -= 1;
            if (depth === 0) return source.slice(start + 1, i);
        }
    }
    throw new Error(`${selector} block did not close`);
}

describe('main window fit-panel layout', () => {
    it('sizes the main Tauri window to the Pomodoro panel host', () => {
        const conf = JSON.parse(readFileSync(tauriConfPath, 'utf8'));
        const main = conf.app.windows.find((w: { label?: string }) => w.label === 'main');

        expect(main).toBeTruthy();
        expect(main.width).toBe(233);
        expect(main.height).toBe(155);
        expect(main.minWidth).toBe(233);
        expect(main.minHeight).toBe(155);
        expect(main.resizable).toBe(false);
    });

    it('does not force the root layout to fill a large transparent viewport', () => {
        const css = readFileSync(globalCssPath, 'utf8');
        const rootBlock = blockAfter(css, 'html, body, #root');
        const appRootBlock = blockAfter(css, '.app-root');

        expect(rootBlock).toMatch(/\bheight\s*:\s*100%\s*;/);
        expect(appRootBlock).not.toMatch(/\bwidth\s*:\s*100vw\s*;/);
        expect(appRootBlock).not.toMatch(/\bheight\s*:\s*100vh\s*;/);
        expect(appRootBlock).toMatch(/\bwidth\s*:\s*fit-content\s*;/);
        expect(appRootBlock).toMatch(/\bheight\s*:\s*fit-content\s*;/);
        expect(appRootBlock).toMatch(/\bpadding\s*:\s*0\s*;/);
    });

    it('does not expose obsolete hit-region commands in the Tauri invoke surface', () => {
        const source = readFileSync(libRsPath, 'utf8');

        expect(source).not.toMatch(/\bset_click_through\b/);
        expect(source).not.toMatch(/\bregister_hit_region\b/);
        expect(source).not.toMatch(/\bunregister_hit_region\b/);
        expect(source).not.toMatch(/\bclear_hit_regions\b/);
    });

    it('installs rounded native hit testing for the main panel on macOS and Windows', () => {
        const libSource = readFileSync(libRsPath, 'utf8');
        const sharedSource = readFileSync(windowHelpersPath, 'utf8');
        const macosSource = readFileSync(macosWindowHelpersPath, 'utf8');
        const windowsSource = readFileSync(windowsWindowHelpersPath, 'utf8');

        expect(libSource).toMatch(/install_main_panel_hit_test\(&window\)/);
        expect(sharedSource).toMatch(/pub fn install_main_panel_hit_test/);
        expect(sharedSource).toMatch(/fn point_in_rounded_rect/);
        expect(macosSource).toMatch(/method_id\(hitTest:\)/);
        expect(macosSource).toMatch(/point_in_rounded_rect/);
        expect(windowsSource).toMatch(/WM_NCHITTEST/);
        expect(windowsSource).toMatch(/HTTRANSPARENT/);
        expect(windowsSource).toMatch(/point_in_rounded_rect/);
    });

    it('defines native minimum sizes for persisted window layout restore', () => {
        const source = readFileSync(libRsPath, 'utf8');

        expect(source).toMatch(/const MAIN_W:\s*f64\s*=\s*window_helpers::MAIN_PANEL_BASE_WIDTH/);
        expect(source).toMatch(/const MAIN_H:\s*f64\s*=\s*window_helpers::MAIN_PANEL_BASE_HEIGHT/);
        expect(source).toMatch(/const SETTINGS_MIN_W:\s*f64\s*=\s*360\.0/);
        expect(source).toMatch(/const SETTINGS_MIN_H:\s*f64\s*=\s*320\.0/);
    });
});
