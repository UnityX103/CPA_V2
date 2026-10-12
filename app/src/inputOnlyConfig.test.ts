import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const nativeRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '../src-tauri');
describe('input-only native packaging', () => {
    it('ships without camera permissions', () => {
        const conf = JSON.parse(readFileSync(path.join(nativeRoot, 'tauri.conf.json'), 'utf8'));
        expect(readFileSync(path.join(nativeRoot, 'Info.plist'), 'utf8')).not.toContain('NSCameraUsageDescription');
        expect(readFileSync(path.join(nativeRoot, conf.bundle.macOS.entitlements), 'utf8'))
            .not.toContain('com.apple.security.device.camera');
    });
    it('exposes input sampling without camera command entry points', () => {
        const source = readFileSync(path.join(nativeRoot, 'src/lib.rs'), 'utf8');
        expect(source).toContain('input_activity::sample_input_activity');
        expect(source).not.toContain('presence_detection');
    });
});
