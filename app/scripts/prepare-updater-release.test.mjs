import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { prepareUpdaterRelease } from './prepare-updater-release.mjs';

const tempRoots = [];

function makeTempRoot() {
    const root = mkdtempSync(join(tmpdir(), 'cpa-updater-release-'));
    tempRoots.push(root);
    return root;
}

function writeJson(path, value) {
    writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function fixtureProject(version = '0.1.0') {
    const root = makeTempRoot();
    mkdirSync(join(root, 'src-tauri'), { recursive: true });
    writeJson(join(root, 'package.json'), { version });
    writeJson(join(root, 'src-tauri', 'tauri.conf.json'), { version });
    return root;
}

describe('prepare-updater-release', () => {
    afterEach(() => {
        while (tempRoots.length) {
            rmSync(tempRoots.pop(), { recursive: true, force: true });
        }
    });

    it('copies signed updater artifacts and writes stable latest.json', async () => {
        const appRoot = fixtureProject('0.2.0');
        const bundleDir = join(appRoot, 'src-tauri', 'target', 'release', 'bundle', 'macos');
        const outDir = join(appRoot, 'release');
        mkdirSync(bundleDir, { recursive: true });
        writeFileSync(join(bundleDir, 'deskpet.app.tar.gz'), 'artifact');
        writeFileSync(join(bundleDir, 'deskpet.app.tar.gz.sig'), 'signed-by-tauri');

        const result = await prepareUpdaterRelease({
            appRoot,
            baseUrl: 'https://github.com/UnityX103/CPA_V2/releases/download',
            bundleDir,
            channel: 'stable',
            outDir,
            platform: 'darwin-aarch64',
            notes: 'quiet update',
        });

        const latestPath = join(outDir, 'stable', 'latest.json');
        const latest = JSON.parse(readFileSync(latestPath, 'utf8'));

        expect(result.latestJsonPath).toBe(latestPath);
        expect(existsSync(join(outDir, 'stable', '0.2.0', 'deskpet.app.tar.gz'))).toBe(true);
        expect(existsSync(join(outDir, 'stable', '0.2.0', 'deskpet.app.tar.gz.sig'))).toBe(true);
        expect(latest).toMatchObject({
            version: '0.2.0',
            notes: 'quiet update',
            platforms: {
                'darwin-aarch64': {
                    signature: 'signed-by-tauri',
                    url: 'https://github.com/UnityX103/CPA_V2/releases/download/v0.2.0/deskpet.app.tar.gz',
                },
            },
        });
        expect(latest.pub_date).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('rejects mismatched app and Tauri versions', async () => {
        const appRoot = fixtureProject('0.2.0');
        writeJson(join(appRoot, 'src-tauri', 'tauri.conf.json'), { version: '0.1.0' });
        const bundleDir = join(appRoot, 'src-tauri', 'target', 'release', 'bundle', 'macos');
        mkdirSync(bundleDir, { recursive: true });
        writeFileSync(join(bundleDir, 'deskpet.app.tar.gz'), 'artifact');
        writeFileSync(join(bundleDir, 'deskpet.app.tar.gz.sig'), 'signature');

        await expect(prepareUpdaterRelease({
            appRoot,
            baseUrl: 'https://github.com/UnityX103/CPA_V2/releases/download',
            bundleDir,
            outDir: join(appRoot, 'release'),
            platform: 'darwin-aarch64',
        })).rejects.toThrow(/version mismatch/i);
    });

    it('uses both Tauri updater platform keys for Windows NSIS installers', async () => {
        const appRoot = fixtureProject('0.2.0');
        const bundleDir = join(appRoot, 'src-tauri', 'target', 'release', 'bundle');
        const nsisDir = join(bundleDir, 'nsis');
        const outDir = join(appRoot, 'release');
        mkdirSync(nsisDir, { recursive: true });
        writeFileSync(join(nsisDir, 'CPA_V2_0.1.0_x64-setup.exe'), 'old-artifact');
        writeFileSync(join(nsisDir, 'CPA_V2_0.1.0_x64-setup.exe.sig'), 'old-signature');
        writeFileSync(join(nsisDir, '桌宠番茄钟_0.2.0_x64-setup.exe'), 'artifact');
        writeFileSync(join(nsisDir, '桌宠番茄钟_0.2.0_x64-setup.exe.sig'), 'signed-by-tauri');

        await prepareUpdaterRelease({
            appRoot,
            bundleDir,
            channel: 'stable',
            outDir,
        });

        const latest = JSON.parse(readFileSync(join(outDir, 'stable', 'latest.json'), 'utf8'));
        expect(existsSync(join(outDir, 'stable', '0.2.0', 'CPA_V2_0.2.0_x64-setup.exe'))).toBe(true);
        expect(existsSync(join(outDir, 'stable', '0.2.0', 'CPA_V2_0.2.0_x64-setup.exe.sig'))).toBe(true);
        expect(latest.platforms['windows-x86_64-nsis']).toMatchObject({
            signature: 'signed-by-tauri',
            url: 'https://github.com/UnityX103/CPA_V2/releases/download/v0.2.0/CPA_V2_0.2.0_x64-setup.exe',
        });
        expect(latest.platforms['windows-x86_64']).toEqual(latest.platforms['windows-x86_64-nsis']);
    });

    it('rejects duplicate artifacts for the same platform', async () => {
        const appRoot = fixtureProject('0.2.0');
        const bundleDir = join(appRoot, 'src-tauri', 'target', 'release', 'bundle');
        mkdirSync(join(bundleDir, 'macos'), { recursive: true });
        for (const name of ['one.app.tar.gz', 'two.app.tar.gz']) {
            writeFileSync(join(bundleDir, 'macos', name), 'artifact');
            writeFileSync(join(bundleDir, 'macos', `${name}.sig`), 'signature');
        }

        await expect(prepareUpdaterRelease({
            appRoot,
            baseUrl: 'https://github.com/UnityX103/CPA_V2/releases/download',
            bundleDir,
            outDir: join(appRoot, 'release'),
            platform: 'darwin-aarch64',
        })).rejects.toThrow(/duplicate updater artifact/i);
    });

    it('rejects stale signatures left behind by an older bundle', async () => {
        const appRoot = fixtureProject('0.2.0');
        const bundleDir = join(appRoot, 'src-tauri', 'target', 'release', 'bundle', 'macos');
        mkdirSync(bundleDir, { recursive: true });
        const artifactPath = join(bundleDir, 'deskpet.app.tar.gz');
        const sigPath = join(bundleDir, 'deskpet.app.tar.gz.sig');
        writeFileSync(sigPath, 'old-signature');
        utimesSync(sigPath, new Date('2026-01-01T00:00:00Z'), new Date('2026-01-01T00:00:00Z'));
        writeFileSync(artifactPath, 'new-artifact');

        await expect(prepareUpdaterRelease({
            appRoot,
            bundleDir,
            outDir: join(appRoot, 'release'),
            platform: 'darwin-aarch64',
        })).rejects.toThrow(/signature is older than artifact/i);
    });

    it('uses stable ASCII asset names for GitHub release URLs', async () => {
        const appRoot = fixtureProject('0.2.0');
        const bundleDir = join(appRoot, 'src-tauri', 'target', 'release', 'bundle', 'macos');
        const outDir = join(appRoot, 'release');
        mkdirSync(bundleDir, { recursive: true });
        writeFileSync(join(bundleDir, '桌宠番茄钟.app.tar.gz'), 'artifact');
        writeFileSync(join(bundleDir, '桌宠番茄钟.app.tar.gz.sig'), 'signature');

        await prepareUpdaterRelease({
            appRoot,
            baseUrl: 'https://github.com/UnityX103/CPA_V2/releases/download',
            bundleDir,
            outDir,
            platform: 'darwin-aarch64',
        });

        const latest = JSON.parse(readFileSync(join(outDir, 'stable', 'latest.json'), 'utf8'));
        expect(existsSync(join(outDir, 'stable', '0.2.0', 'app.tar.gz'))).toBe(true);
        expect(existsSync(join(outDir, 'stable', '0.2.0', 'app.tar.gz.sig'))).toBe(true);
        expect(latest.platforms['darwin-aarch64'].url).toBe(
            'https://github.com/UnityX103/CPA_V2/releases/download/v0.2.0/app.tar.gz',
        );
    });
});
