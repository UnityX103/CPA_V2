import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const appRoot = path.resolve(import.meta.dirname, '..');

describe('extension pack native boundary', () => {
    it('registers only the unified lifecycle commands', () => {
        const lib = fs.readFileSync(path.join(appRoot, 'src-tauri/src/lib.rs'), 'utf8');

        expect(lib).toContain('extension_packs::install_extension_pack');
        expect(lib).toContain('extension_packs::set_extension_pack_enabled');
        expect(lib).toContain('extension_packs::set_extension_pack_active');
        expect(lib).toContain('extension_packs::uninstall_extension_pack');
        expect(lib).not.toContain('video_editor_module::download_video_editor_module');
        expect(lib).not.toContain('video_editor_module::uninstall_video_editor_module');
        expect(lib).not.toContain('cockroach_module::download_cockroach_module');
        expect(lib).not.toContain('cockroach_module::uninstall_cockroach_module');
    });

    it('guards both feature launchers with extension enablement', () => {
        const video = fs.readFileSync(
            path.join(appRoot, 'src-tauri/src/video_editor_module.rs'),
            'utf8',
        );
        const pet = fs.readFileSync(
            path.join(appRoot, 'src-tauri/src/cockroach_module.rs'),
            'utf8',
        );

        expect(video).toContain('pack_is_enabled(&app, VIDEO_EDITOR_ID)');
        expect(pet).toContain('pack_is_enabled(&app, COCKROACH_ID)');
    });
});
