import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const tauriRoot = path.join(here, '../src-tauri');
const tauriConfPath = path.join(tauriRoot, 'tauri.conf.json');
const infoPlistPath = path.join(tauriRoot, 'Info.plist');
const presenceDetectionPath = path.join(tauriRoot, 'src/presence_detection/mod.rs');

function rustFunction(source: string, name: string): string | null {
    const signatureStart = source.search(new RegExp(`(?:pub(?:\\([^)]*\\))?\\s+)?(?:async\\s+)?fn\\s+${name}\\s*\\(`));
    if (signatureStart < 0) return null;

    const bodyStart = source.indexOf('{', signatureStart);
    if (bodyStart < 0) return null;

    let depth = 0;
    for (let i = bodyStart; i < source.length; i += 1) {
        if (source[i] === '{') depth += 1;
        if (source[i] === '}') {
            depth -= 1;
            if (depth === 0) return source.slice(bodyStart + 1, i);
        }
    }
    return null;
}

describe('macOS camera permission packaging', () => {
    it('ships both the camera usage description and hardened-runtime entitlement', () => {
        const conf = JSON.parse(readFileSync(tauriConfPath, 'utf8'));
        const infoPlist = readFileSync(infoPlistPath, 'utf8');
        const entitlementsSetting = conf.bundle?.macOS?.entitlements;

        expect(infoPlist).toMatch(/<key>NSCameraUsageDescription<\/key>\s*<string>[^<]+<\/string>/);
        expect(entitlementsSetting).toEqual(expect.any(String));
        if (typeof entitlementsSetting !== 'string') return;

        const entitlementsPath = path.resolve(tauriRoot, entitlementsSetting);
        expect(existsSync(entitlementsPath), `${entitlementsPath} should exist`).toBe(true);
        if (!existsSync(entitlementsPath)) return;

        const entitlements = readFileSync(entitlementsPath, 'utf8');
        expect(entitlements).toMatch(/<key>com\.apple\.security\.device\.camera<\/key>\s*<true\s*\/>/);
    });

    it('requests the camera prompt without deactivating the app first', () => {
        const source = readFileSync(presenceDetectionPath, 'utf8');
        const requestAccess = rustFunction(source, 'request_camera_presence_access');

        expect(requestAccess, 'request_camera_presence_access should exist').not.toBeNull();
        expect(requestAccess).toMatch(/lower_permission_windows_for_camera_prompt\(\s*&app_for_prompt,?\s*\)/);
        expect(requestAccess).not.toMatch(/yield_permission_windows\(&app_for_prompt\)/);
    });
});
