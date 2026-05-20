import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const capabilitiesPath = path.join(here, '../src-tauri/capabilities/default.json');
const libRsPath = path.join(here, '../src-tauri/src/lib.rs');
const mainTsxPath = path.join(here, 'main.tsx');
const globalCssPath = path.join(here, 'styles/global.css');
const checkinWindowTsPath = path.join(here, 'domain/checkinWindow.ts');
const checkinEditorAppPath = path.join(here, 'CheckinEditorApp.tsx');

describe('daily check-in window configuration', () => {
    it('allows both check-in webview labels in capabilities', () => {
        const capabilities = JSON.parse(readFileSync(capabilitiesPath, 'utf8'));

        expect(capabilities.windows).toContain('today-checkin');
        expect(capabilities.windows).toContain('checkin-editor');
    });

    it('routes querystring windows to the check-in React roots', () => {
        const source = readFileSync(mainTsxPath, 'utf8');

        expect(source).toMatch(/import TodayCheckinApp from "\.\/TodayCheckinApp"/);
        expect(source).toMatch(/import CheckinEditorApp from "\.\/CheckinEditorApp"/);
        expect(source).toMatch(/which === "today-checkin"\s*\?\s*TodayCheckinApp/);
        expect(source).toMatch(/which === "checkin-editor"\s*\?\s*CheckinEditorApp/);
    });

    it('builds hidden Tauri windows and exposes commands for check-in panels', () => {
        const source = readFileSync(libRsPath, 'utf8');

        expect(source).toMatch(/build_today_checkin_window_hidden/);
        expect(source).toMatch(/build_checkin_editor_window_hidden/);
        expect(source).toMatch(/WebviewWindowBuilder::new\(app,\s*"today-checkin"/);
        expect(source).toMatch(/WebviewWindowBuilder::new\(app,\s*"checkin-editor"/);
        expect(source).toMatch(/index\.html\?window=today-checkin/);
        expect(source).toMatch(/index\.html\?window=checkin-editor/);
        expect(source).toMatch(/const TODAY_CHECKIN_W:\s*f64\s*=\s*278\.0/);
        expect(source).toMatch(/const CHECKIN_EDITOR_W:\s*f64\s*=\s*460\.0/);
        expect(source).toMatch(/open_today_checkin_window/);
        expect(source).toMatch(/open_checkin_editor_window/);
        expect(source).toMatch(/async fn close_today_checkin_window/);
        expect(source).toMatch(/async fn close_checkin_editor_window/);
        expect(source).toMatch(/close_today_checkin_window,\s*close_checkin_editor_window/s);
    });

    it('declares transparent scaled roots for both check-in windows', () => {
        const css = readFileSync(globalCssPath, 'utf8');

        expect(css).toMatch(/\.today-checkin-window-root\s*\{[^}]*--app-ui-scale:\s*1/);
        expect(css).toMatch(/\.today-checkin-window-root\s*\{[^}]*background:\s*transparent/);
        expect(css).toMatch(/\.today-checkin-window-root\s*\{[^}]*zoom:\s*var\(--app-ui-scale\)/);
        expect(css).toMatch(/\.checkin-editor-window-root\s*\{[^}]*--app-ui-scale:\s*1/);
        expect(css).toMatch(/\.checkin-editor-window-root\s*\{[^}]*background:\s*transparent/);
        expect(css).toMatch(/\.checkin-editor-window-root\s*\{[^}]*zoom:\s*var\(--app-ui-scale\)/);
    });

    it('resizes the editor webview through the scaled-window bridge', () => {
        const checkinWindowSource = readFileSync(checkinWindowTsPath, 'utf8');
        const editorSource = readFileSync(checkinEditorAppPath, 'utf8');

        expect(checkinWindowSource).toMatch(/CHECKIN_EDITOR_BASE_WIDTH\s*=\s*460/);
        expect(checkinWindowSource).toMatch(/CHECKIN_EDITOR_BASE_HEIGHT\s*=\s*898/);
        expect(checkinWindowSource).toMatch(/CHECKIN_EDITOR_MIN_WIDTH\s*=\s*360/);
        expect(checkinWindowSource).toMatch(/CHECKIN_EDITOR_MIN_HEIGHT\s*=\s*420/);
        expect(checkinWindowSource).toMatch(/useCheckinEditorWindowSize/);
        expect(checkinWindowSource).toMatch(/label:\s*'checkin-editor'[\s\S]*baseWidth:\s*CHECKIN_EDITOR_BASE_WIDTH[\s\S]*baseHeight:\s*CHECKIN_EDITOR_BASE_HEIGHT[\s\S]*minWidth:\s*CHECKIN_EDITOR_MIN_WIDTH[\s\S]*minHeight:\s*CHECKIN_EDITOR_MIN_HEIGHT[\s\S]*center:\s*true/);
        expect(editorSource).toMatch(/useCheckinEditorWindowSize\(\)/);
    });
});
