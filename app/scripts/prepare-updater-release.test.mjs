import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
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
            baseUrl: 'https://updates.nanzhai.com/cpa',
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
                    url: 'https://updates.nanzhai.com/cpa/stable/0.2.0/deskpet.app.tar.gz',
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
            baseUrl: 'https://updates.nanzhai.com/cpa',
            bundleDir,
            outDir: join(appRoot, 'release'),
            platform: 'darwin-aarch64',
        })).rejects.toThrow(/version mismatch/i);
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
            baseUrl: 'https://updates.nanzhai.com/cpa',
            bundleDir,
            outDir: join(appRoot, 'release'),
            platform: 'darwin-aarch64',
        })).rejects.toThrow(/duplicate updater artifact/i);
    });
});
