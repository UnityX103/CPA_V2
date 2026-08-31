import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const appRoot = path.resolve(import.meta.dirname, '..');
const repoRoot = path.resolve(appRoot, '..');

describe('downloadable video editor module packaging boundary', () => {
    it('does not bundle the module UI, models, or runtime in the default app', () => {
        const tauri = fs.readFileSync(path.join(appRoot, 'src-tauri/tauri.conf.json'), 'utf8');
        const packageJson = fs.readFileSync(path.join(appRoot, 'package.json'), 'utf8');
        const moduleRoot = path.join(repoRoot, 'video-editor-module');

        expect(fs.existsSync(moduleRoot)).toBe(true);
        expect(tauri).not.toContain('video-editor-module');
        expect(packageJson).not.toContain('../video-editor-module');
        expect(packageJson).not.toContain('torch');
        expect(packageJson).not.toContain('transformers');
    });

    it('keeps only the installer and launcher shell in the host source tree', () => {
        const host = fs.readFileSync(
            path.join(appRoot, 'src-tauri/src/video_editor_module.rs'),
            'utf8',
        );
        expect(host).toContain('download_video_editor_module');
        expect(host).toContain('launch_video_editor_module');
        expect(host).toContain('verify_index_signature');
        expect(host).toContain('minisign_verify');
        expect(host).not.toContain('AutoModelForImageSegmentation');
        expect(host).not.toContain('build_sam2_video_predictor');
    });
});
