import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildCloudInstaller } from './build-cloud-installer.mjs';

const dmgFailure = { code: 1, output: 'Error failed to bundle project error running bundle_dmg.sh: failed to run script' };
const success = { code: 0, output: 'Disk image done' };

function harness(results, options = {}) {
    const run = vi.fn();
    for (const result of results) run.mockResolvedValueOnce(result);
    const sleep = vi.fn().mockResolvedValue(undefined);
    const log = vi.fn();
    return { run, sleep, log, execute: () => buildCloudInstaller({
        target: 'x86_64-apple-darwin', bundles: 'app,dmg', publish: false,
        run, sleep, log, ...options,
    }) };
}

afterEach(() => vi.unstubAllEnvs());

describe('cloud installer DMG recovery', () => {
    it('retries only packaging after the observed DMG script failure', async () => {
        const h = harness([dmgFailure, success]);
        expect(await h.execute()).toBe(0);
        expect(h.run.mock.calls.map(([args]) => args[0])).toEqual(['build', 'bundle']);
        expect(h.run.mock.calls[1][0]).toEqual([
            'bundle', '--verbose', '--target', 'x86_64-apple-darwin', '--bundles', 'app,dmg',
            '--config', '{"bundle":{"createUpdaterArtifacts":false}}',
        ]);
        expect(h.sleep).toHaveBeenCalledWith(10_000);
    });

    it('stops after two packaging retries and preserves failure', async () => {
        const h = harness([dmgFailure, dmgFailure, dmgFailure]);
        expect(await h.execute()).toBe(1);
        expect(h.run).toHaveBeenCalledTimes(3);
        expect(h.sleep.mock.calls).toEqual([[10_000], [20_000]]);
    });

    it.each([
        'error: could not compile app',
        'error: codesign failed',
        'Running bundle_dmg.sh\nError updater signing failed',
    ])('does not retry unrelated errors: %s', async output => {
        const h = harness([{ code: 7, output }]);
        expect(await h.execute()).toBe(7);
        expect(h.run).toHaveBeenCalledTimes(1);
        expect(h.sleep).not.toHaveBeenCalled();
    });

    it('does not hide a new signing error during recovery', async () => {
        const h = harness([dmgFailure, { code: 8, output: 'Error codesign failed' }]);
        expect(await h.execute()).toBe(8);
        expect(h.run).toHaveBeenCalledTimes(2);
    });

    it('does not retry Windows or build twice on success', async () => {
        const windows = harness([dmgFailure], { target: 'x86_64-pc-windows-msvc', bundles: 'nsis' });
        expect(await windows.execute()).toBe(1);
        expect(windows.run).toHaveBeenCalledTimes(1);
        const mac = harness([success]);
        expect(await mac.execute()).toBe(0);
        expect(mac.run).toHaveBeenCalledTimes(1);
    });

    it('preserves updater generation during publishing and rejects a missing key', async () => {
        vi.stubEnv('TAURI_SIGNING_PRIVATE_KEY', '');
        const h = harness([dmgFailure, success], { publish: true });
        await expect(h.execute()).rejects.toThrow('Missing updater signing secret');
        expect(h.run).not.toHaveBeenCalled();
        vi.stubEnv('TAURI_SIGNING_PRIVATE_KEY', 'test-key');
        expect(await h.execute()).toBe(0);
        for (const [args] of h.run.mock.calls) {
            expect(args).not.toContain('--config');
            expect(args).not.toContain('--no-sign');
            expect(args).not.toContain('test-key');
        }
    });
});
