import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.join(here, '..');
const packageJsonPath = path.join(appRoot, 'package.json');
const cargoTomlPath = path.join(appRoot, 'src-tauri/Cargo.toml');
const tauriConfPath = path.join(appRoot, 'src-tauri/tauri.conf.json');
const capabilitiesPath = path.join(appRoot, 'src-tauri/capabilities/default.json');
const updaterCapabilitiesPath = path.join(appRoot, 'src-tauri/capabilities/updater.json');
const libRsPath = path.join(appRoot, 'src-tauri/src/lib.rs');

function readJson(pathname: string) {
    return JSON.parse(readFileSync(pathname, 'utf8'));
}

function cargoPackageVersion(source: string): string {
    const match = source.match(/\[package\][\s\S]*?\nversion\s*=\s*"([^"]+)"/);
    if (!match) throw new Error('Cargo package version not found');
    return match[1];
}

function updaterAndProcessPermissions(permissions: string[]): string[] {
    return permissions
        .filter((permission) => permission.startsWith('updater:') || permission.startsWith('process:'))
        .sort();
}

describe('updater configuration', () => {
    it('keeps app, cargo, and tauri versions aligned', () => {
        const pkg = readJson(packageJsonPath);
        const conf = readJson(tauriConfPath);
        const cargo = readFileSync(cargoTomlPath, 'utf8');
        expect(pkg.version).toBe(conf.version);
        expect(cargoPackageVersion(cargo)).toBe(conf.version);
    });

    it('creates signed updater artifacts and queries GitHub metadata before CNB fallback', () => {
        const conf = readJson(tauriConfPath);
        expect(conf.bundle?.createUpdaterArtifacts).toBe(true);
        expect(conf.bundle?.macOS?.signingIdentity).toBe('-');
        expect(conf.plugins?.updater?.endpoints).toEqual([
            'https://github.com/UnityX103/CPA_V2/releases/latest/download/latest.json',
            'https://cnb.cool/nanzhaigame-xpy/CPA_V2/-/releases/latest/download/latest.json',
        ]);
        expect(conf.plugins?.updater?.pubkey).toEqual(expect.any(String));
        expect(conf.plugins.updater.pubkey.length).toBeGreaterThan(40);
        expect(conf.plugins.updater.pubkey).not.toContain('PRIVATE');
        expect(Buffer.from(conf.plugins.updater.pubkey, 'base64').toString('utf8')).toMatch(
            /^untrusted comment: minisign public key:/,
        );
        expect(conf.plugins.updater.windows?.installMode).toBe('passive');
    });

    it('cleans only a verified previous Windows installation when the update changes directories', () => {
        const conf = readJson(tauriConfPath);
        const hookPath = conf.bundle?.windows?.nsis?.installerHooks;
        expect(hookPath).toBe('nsis/cleanup-previous-install.nsh');
        const hook = readFileSync(path.join(appRoot, 'src-tauri', hookPath), 'utf8');
        expect(hook).toContain('!macro NSIS_HOOK_PREINSTALL');
        expect(hook).toContain('${If} $UpdateMode = 1');
        expect(hook).toContain('ReadRegStr $R0 SHCTX "${MANUPRODUCTKEY}" ""');
        expect(hook).toContain('ReadRegStr $R1 SHCTX "${UNINSTKEY}" "InstallLocation"');
        expect(hook).toContain('ReadRegStr $R2 SHCTX "${UNINSTKEY}" "UninstallString"');
        expect(hook).toContain('ReadRegStr $R3 SHCTX "${UNINSTKEY}" "MainBinaryName"');
        expect(hook).toContain('${AndIf} $R4 != $R5');
        expect(hook).toContain('${AndIf} $R6 == $R7');
        expect(hook).toContain('${AndIf} $R1 == "$\\"$R0$\\""');
        expect(hook).toContain('${AndIf} $R2 == "$\\"$R0\\uninstall.exe$\\""');
        expect(hook).toContain('${AndIf} $R3 == "${MAINBINARYNAME}.exe"');
        expect(hook).toContain('${FileExists} "$R0\\${MAINBINARYNAME}.exe"');
        expect(hook).toContain('/S /UPDATE _?=$R0');
        expect(hook).toContain('Abort "$(unableToUninstall)"');
        expect(hook).not.toMatch(/RMDir\s+\/r/i);
    });

    it('allows production multiplayer websocket connections in the CSP', () => {
        const conf = readJson(tauriConfPath);
        expect(conf.app?.security?.csp).toContain('ws://113.46.152.120:8039');
    });

    it('initializes updater and process plugins in Rust', () => {
        const source = readFileSync(libRsPath, 'utf8');
        expect(source).toContain('tauri_plugin_updater::Builder::new().build()');
        expect(source).toContain('tauri_plugin_process::init()');
    });

    it('grants only updater/process permissions needed by the frontend', () => {
        const defaultCapabilities = readJson(capabilitiesPath);
        const updaterCapabilities = readJson(updaterCapabilitiesPath);
        const expectedUpdaterPermissions = [
            'process:allow-restart',
            'updater:allow-check',
            'updater:allow-download-and-install',
        ];

        expect(updaterAndProcessPermissions(defaultCapabilities.permissions)).toEqual([]);
        expect(updaterCapabilities.windows).toEqual(['main']);
        expect(updaterAndProcessPermissions(updaterCapabilities.permissions)).toEqual(
            expectedUpdaterPermissions,
        );
        expect([...updaterCapabilities.permissions].sort()).toEqual(expectedUpdaterPermissions);
        expect(defaultCapabilities.permissions).not.toContain('shell:default');
        expect(defaultCapabilities.permissions).not.toContain('fs:default');
        expect(updaterCapabilities.permissions).not.toContain('shell:default');
        expect(updaterCapabilities.permissions).not.toContain('fs:default');
    });
});
