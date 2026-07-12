import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const tauriConfPath = path.join(here, '../src-tauri/tauri.conf.json');
const capabilitiesPath = path.join(here, '../src-tauri/capabilities/default.json');
const libRsPath = path.join(here, '../src-tauri/src/lib.rs');
const activeAppRsPath = path.join(here, '../src-tauri/src/active_app.rs');

describe('input counter independent window configuration', () => {
    it('allows the input-counter webview label in capabilities', () => {
        const capabilities = JSON.parse(readFileSync(capabilitiesPath, 'utf8'));
        expect(capabilities.windows).toContain('input-counter');
    });

    it('builds a hidden transparent always-on-top-capable input counter window', () => {
        const source = readFileSync(libRsPath, 'utf8');

        expect(source).toMatch(/build_input_counter_window_hidden/);
        expect(source).toMatch(/WebviewWindowBuilder::new\(app,\s*"input-counter"/);
        expect(source).toMatch(/index\.html\?window=input-counter/);
        expect(source).toMatch(/const INPUT_COUNTER_W:\s*f64\s*=\s*128\.0/);
        expect(source).toMatch(/const INPUT_COUNTER_H:\s*f64\s*=\s*84\.0/);
        expect(source).toMatch(/\.inner_size\(INPUT_COUNTER_W,\s*INPUT_COUNTER_H\)/);
        expect(source).toMatch(/\.transparent\(true\)/);
        expect(source).toMatch(/\.decorations\(false\)/);
        expect(source).toMatch(/\.skip_taskbar\(true\)/);
        expect(source).toMatch(/\.visible\(false\)/);
        expect(source).toMatch(/set_input_counter_window_pinned/);
    });

    it('does not resize the main Pomodoro window for the separate key counter panel', () => {
        const conf = JSON.parse(readFileSync(tauriConfPath, 'utf8'));
        const main = conf.app.windows.find((w: { label?: string }) => w.label === 'main');

        expect(main.width).toBe(233);
        expect(main.height).toBe(155);
    });
});

describe('active app metadata', () => {
    it('exposes title and icon fields with app-name fallback semantics', () => {
        const source = readFileSync(activeAppRsPath, 'utf8');

        expect(source).toMatch(/window_title/);
        expect(source).toMatch(/icon_data_url/);
        expect(source).toMatch(/current_active_app_window_title/);
        expect(source).toMatch(/current_active_app_icon_data_url/);
    });

    it('encodes active app icons as PNG data URLs for webview rendering', () => {
        const source = readFileSync(activeAppRsPath, 'utf8');

        expect(source).toMatch(/data:image\/png;base64/);
        expect(source).toMatch(/NSBitmapImageRep/);
        expect(source).toMatch(/NSBitmapImageFileType::PNG/);
        expect(source).not.toMatch(/data:image\/tiff;base64/);
        expect(source).not.toMatch(/TIFFRepresentation/);
    });
});
