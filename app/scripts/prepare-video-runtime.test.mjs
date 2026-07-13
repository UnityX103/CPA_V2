import {
    chmodSync,
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    statSync,
    utimesSync,
    writeFileSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
    assertRedistributableFfmpegBuild,
    backgroundRemoverSmokeEnvironment,
    createVideoRuntimeLock,
    hostCanRunRuntimeTarget,
    inspectNativeBinary,
    prepareVideoRuntime,
    runSmokeCommand,
    sha256File,
    sha256Tree,
    VIDEO_RUNTIME_SMOKE_TIMEOUTS,
    verifyVideoRuntime,
} from './prepare-video-runtime.mjs';

const tempRoots = [];
const SCRIPT_PATH = join(process.cwd(), 'scripts', 'prepare-video-runtime.mjs');
const BACKGROUND_REMOVER_ENTRY_PATH = join(
    process.cwd(),
    'scripts',
    'packaging',
    'backgroundremover-entry.py',
);
const REQUIRED_LICENSES = [
    'BackgroundRemover-LICENSE.txt',
    'FFmpeg-LICENSE.txt',
    'Python-LICENSE.txt',
    'PyTorch-LICENSE.txt',
    'TorchVision-LICENSE.txt',
    'PyInstaller-COPYING.txt',
    'U2NetP-NOTICE.txt',
    'runtime-NOTICES.txt',
];
const BACKGROUND_REMOVER_PATCH_CONTENT = 'force CPU device selection fixture\n';
const BACKGROUND_REMOVER_PATCHES = [{
    id: 'force-cpu-device-env-v1',
    path: 'scripts/patches/backgroundremover-force-cpu.patch',
    sha256: sha256(BACKGROUND_REMOVER_PATCH_CONTENT),
}];
const TARGET_FIXTURES = {
    'macos-x86_64': {
        architecture: 'x86_64',
        executable: () => machO('x86_64'),
        suffix: '',
    },
    'macos-arm64': {
        architecture: 'arm64',
        executable: () => machO('arm64'),
        suffix: '',
    },
    'windows-x86_64': {
        architecture: 'x86_64',
        executable: () => pe('x86_64'),
        suffix: '.exe',
    },
};

function tempRoot() {
    const root = mkdtempSync(join(tmpdir(), 'cpa-video-runtime-'));
    tempRoots.push(root);
    return root;
}

function writeJson(path, value) {
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function sha256(data) {
    return createHash('sha256').update(data).digest('hex');
}

function machO(arch = 'x86_64') {
    const buffer = Buffer.alloc(64);
    buffer.writeUInt32LE(0xfeedfacf, 0);
    buffer.writeUInt32LE(arch === 'x86_64' ? 0x01000007 : 0x0100000c, 4);
    return buffer;
}

function machO32(byteOrder = 'little') {
    const buffer = Buffer.alloc(64);
    const writeUInt32 = byteOrder === 'little'
        ? buffer.writeUInt32LE.bind(buffer)
        : buffer.writeUInt32BE.bind(buffer);
    writeUInt32(0xfeedface, 0);
    writeUInt32(7, 4);
    return buffer;
}

function universalMachO() {
    const buffer = Buffer.alloc(64);
    buffer.writeUInt32BE(0xcafebabe, 0);
    buffer.writeUInt32BE(2, 4);
    return buffer;
}

function pe(arch = 'x86_64') {
    const buffer = Buffer.alloc(256);
    buffer.write('MZ', 0, 'ascii');
    buffer.writeUInt32LE(0x80, 0x3c);
    buffer.write('PE\0\0', 0x80, 'binary');
    buffer.writeUInt16LE(arch === 'x86_64' ? 0x8664 : 0xaa64, 0x84);
    return buffer;
}

function policy(model) {
    return {
        schemaVersion: 1,
        supportedTargets: [
            'macos-x86_64',
            'macos-arm64',
            'windows-x86_64',
        ],
        backgroundRemover: {
            repository: 'https://example.invalid/backgroundremover.git',
            commit: 'fa480627829759b902f8c233388d7aa67ab38099',
            license: 'MIT',
            patches: BACKGROUND_REMOVER_PATCHES,
        },
        u2netp: {
            source: 'https://example.invalid/u2netp-fa480627.pth',
            sha256: sha256(model),
            size: model.length,
        },
        ffmpeg: {
            requiredEncoders: ['libvpx'],
            macosRequiredEncoders: ['hevc_videotoolbox'],
        },
        licenses: { requiredFiles: REQUIRED_LICENSES },
    };
}

async function fixture(target = 'macos-x86_64') {
    const appRoot = tempRoot();
    const model = Buffer.from('small-u2netp-fixture');
    const targetFixture = TARGET_FIXTURES[target];
    if (!targetFixture) throw new Error(`Missing test fixture for ${target}`);
    const executable = targetFixture.executable();
    const suffix = targetFixture.suffix;
    const input = join(appRoot, 'input');
    const backgroundRoot = join(input, 'backgroundremover');
    const licenses = join(input, 'licenses');
    mkdirSync(backgroundRoot, { recursive: true });
    mkdirSync(licenses, { recursive: true });
    for (const [name, data] of [
        [`ffmpeg${suffix}`, executable],
        [`ffprobe${suffix}`, executable],
        [`backgroundremover${suffix}`, executable],
    ]) {
        const base = name.startsWith('background') ? backgroundRoot : input;
        writeFileSync(join(base, name), data);
        chmodSync(join(base, name), 0o755);
    }
    writeFileSync(join(backgroundRoot, 'torch-runtime.dat'), 'torch-runtime');
    writeFileSync(join(input, 'u2netp.pth'), model);
    for (const name of REQUIRED_LICENSES) writeFileSync(join(licenses, name), `${name}\n`);
    const policyPath = join(appRoot, 'src-tauri', 'video-runtime', 'source-policy.json');
    const patchPath = join(appRoot, BACKGROUND_REMOVER_PATCHES[0].path);
    mkdirSync(join(patchPath, '..'), { recursive: true });
    writeFileSync(patchPath, BACKGROUND_REMOVER_PATCH_CONTENT);
    writeJson(policyPath, policy(model));
    const lock = {
        schemaVersion: 1,
        target,
        backgroundRemoverCommit: 'fa480627829759b902f8c233388d7aa67ab38099',
        components: {
            ffmpeg: {
                source: `https://example.invalid/ffmpeg-7.1-${target}`,
                version: '7.1.0-test',
                sha256: await sha256File(join(input, `ffmpeg${suffix}`)),
            },
            ffprobe: {
                source: `https://example.invalid/ffprobe-7.1-${target}`,
                version: '7.1.0-test',
                sha256: await sha256File(join(input, `ffprobe${suffix}`)),
            },
            backgroundRemover: {
                source: `artifact://backgroundremover-fa480627-${target}`,
                patches: BACKGROUND_REMOVER_PATCHES,
                pythonVersion: '3.12.4',
                pythonSource: `https://example.invalid/python-3.12.4-${targetFixture.architecture}`,
                torchVersion: '2.7.1',
                torchSource: `https://example.invalid/torch-2.7.1-${targetFixture.architecture}`,
                packager: 'PyInstaller 6.14 pinned-build-recipe',
                treeSha256: await sha256Tree(backgroundRoot),
            },
            u2netp: {
                source: 'https://example.invalid/u2netp-fa480627.pth',
                sha256: sha256(model),
            },
            licenses: {
                source: 'artifact://cpa-video-runtime-license-pack-v1',
                treeSha256: await sha256Tree(licenses),
            },
        },
    };
    const lockPath = join(appRoot, 'release-lock.json');
    writeJson(lockPath, lock);
    return {
        appRoot,
        backgroundRoot,
        input,
        licenses,
        lock,
        lockPath,
        modelPath: join(input, 'u2netp.pth'),
        policyPath,
        suffix,
    };
}

async function prepare(fx, target) {
    return prepareVideoRuntime({
        appRoot: fx.appRoot,
        target,
        lockPath: fx.lockPath,
        ffmpegPath: join(fx.input, `ffmpeg${fx.suffix}`),
        ffprobePath: join(fx.input, `ffprobe${fx.suffix}`),
        backgroundRoot: fx.backgroundRoot,
        modelPath: fx.modelPath,
        licensesPath: fx.licenses,
    });
}

describe('prepare-video-runtime', () => {
    afterEach(() => {
        while (tempRoots.length) rmSync(tempRoots.pop(), { recursive: true, force: true });
    });

    it.each(Object.entries(TARGET_FIXTURES))(
        'stages and verifies a locked %s payload',
        async (target, targetFixture) => {
            const fx = await fixture(target);
            const result = await prepare(fx, target);
            const manifest = JSON.parse(readFileSync(result.manifestPath, 'utf8'));

            expect(manifest).toMatchObject({
                target,
                architecture: targetFixture.architecture,
                backgroundRemoverCommit: fx.lock.backgroundRemoverCommit,
                components: {
                    ffmpeg: { version: '7.1.0-test' },
                    backgroundRemover: {
                        patches: BACKGROUND_REMOVER_PATCHES,
                        pythonVersion: '3.12.4',
                        pythonSource: `https://example.invalid/python-3.12.4-${targetFixture.architecture}`,
                        torchVersion: '2.7.1',
                        torchSource: `https://example.invalid/torch-2.7.1-${targetFixture.architecture}`,
                    },
                },
            });
            expect(existsSync(result.manifestPath)).toBe(true);
            await expect(verifyVideoRuntime({ appRoot: fx.appRoot, target })).resolves.toMatchObject({
                target,
            });
        },
    );

    it.each(['macos-x86_64', 'macos-arm64'])(
        'verifies a %s payload through the public CLI',
        async (target) => {
            const fx = await fixture(target);
            await prepare(fx, target);

            const output = execFileSync(process.execPath, [
                SCRIPT_PATH,
                'verify',
                '--target',
                target,
                '--app-root',
                fx.appRoot,
            ], { encoding: 'utf8' });

            expect(output).toContain(`Video runtime verify succeeded for ${target}`);
        },
    );

    it('lists every supported thin target in the public CLI usage', () => {
        const output = execFileSync(process.execPath, [SCRIPT_PATH, 'help'], {
            encoding: 'utf8',
        });

        expect(output).toContain('macos-x86_64');
        expect(output).toContain('macos-arm64');
        expect(output).toContain('windows-x86_64');
    });

    it.each([
        ['macos-x86_64', 'darwin', 'arm64', true],
        ['macos-x86_64', 'darwin', 'x64', true],
        ['macos-x86_64', 'darwin', 'x86_64', true],
        ['macos-x86_64', 'win32', 'x64', false],
        ['macos-arm64', 'darwin', 'arm64', true],
        ['macos-arm64', 'darwin', 'aarch64', true],
        ['macos-arm64', 'darwin', 'x64', false],
        ['macos-arm64', 'darwin', 'x86_64', false],
        ['macos-arm64', 'win32', 'arm64', false],
        ['windows-x86_64', 'win32', 'x64', true],
        ['windows-x86_64', 'win32', 'x86_64', true],
        ['windows-x86_64', 'win32', 'arm64', false],
        ['windows-x86_64', 'darwin', 'arm64', false],
    ])(
        'gates %s smoke checks on %s/%s with result %s',
        (target, platform, architecture, expected) => {
            expect(hostCanRunRuntimeTarget(target, platform, architecture)).toBe(expected);
        },
    );

    it('creates a release lock with versions, sources, and deterministic hashes', async () => {
        const fx = await fixture('macos-x86_64');
        const outPath = join(fx.appRoot, 'generated-release-lock.json');

        const result = await createVideoRuntimeLock({
            appRoot: fx.appRoot,
            target: 'macos-x86_64',
            outPath,
            ffmpegPath: join(fx.input, 'ffmpeg'),
            ffprobePath: join(fx.input, 'ffprobe'),
            backgroundRoot: fx.backgroundRoot,
            modelPath: fx.modelPath,
            licensesPath: fx.licenses,
            ffmpegSource: 'https://example.invalid/ffmpeg-7.1-macos-x86_64',
            ffmpegVersion: '7.1.0-test',
            ffprobeSource: 'https://example.invalid/ffprobe-7.1-macos-x86_64',
            ffprobeVersion: '7.1.0-test',
            backgroundRemoverSource: 'artifact://backgroundremover-fa480627-macos-x86_64',
            pythonVersion: '3.12.4',
            pythonSource: 'https://example.invalid/python-3.12.4-x86_64',
            torchVersion: '2.7.1',
            torchSource: 'https://example.invalid/torch-2.7.1-x86_64',
            packager: 'PyInstaller 6.14 pinned-build-recipe',
            licensesSource: 'artifact://cpa-video-runtime-license-pack-v1',
        });
        const lock = JSON.parse(readFileSync(result.lockPath, 'utf8'));

        expect(lock).toMatchObject({
            target: 'macos-x86_64',
            backgroundRemoverCommit: 'fa480627829759b902f8c233388d7aa67ab38099',
            components: {
                ffmpeg: { version: '7.1.0-test' },
                backgroundRemover: {
                    patches: BACKGROUND_REMOVER_PATCHES,
                    pythonVersion: '3.12.4',
                    pythonSource: 'https://example.invalid/python-3.12.4-x86_64',
                    torchVersion: '2.7.1',
                    torchSource: 'https://example.invalid/torch-2.7.1-x86_64',
                },
                u2netp: { sha256: fx.lock.components.u2netp.sha256 },
            },
        });
        expect(lock.components.backgroundRemover.treeSha256).toMatch(/^[a-f0-9]{64}$/);
    });

    it('rejects a release lock that omits a required BackgroundRemover patch', async () => {
        const fx = await fixture('macos-x86_64');
        fx.lock.components.backgroundRemover.patches = [];
        writeJson(fx.lockPath, fx.lock);

        await expect(prepare(fx, 'macos-x86_64')).rejects.toThrow(
            /BackgroundRemover patch provenance/i,
        );
    });

    it('rejects a BackgroundRemover patch file that no longer matches source-policy', async () => {
        const fx = await fixture('macos-x86_64');
        writeFileSync(
            join(fx.appRoot, BACKGROUND_REMOVER_PATCHES[0].path),
            'tampered patch\n',
        );

        await expect(prepare(fx, 'macos-x86_64')).rejects.toThrow(
            /BackgroundRemover patch force-cpu-device-env-v1 SHA-256 mismatch/i,
        );
    });

    it.each([
        ['macos-x86_64', 'arm64'],
        ['macos-arm64', 'x86_64'],
    ])(
        'rejects a wrong-architecture %s executable even when its checksum is locked',
        async (target, wrongArchitecture) => {
            const fx = await fixture(target);
            const ffmpeg = join(fx.input, 'ffmpeg');
            writeFileSync(ffmpeg, machO(wrongArchitecture));
            fx.lock.components.ffmpeg.sha256 = await sha256File(ffmpeg);
            writeJson(fx.lockPath, fx.lock);

            await expect(prepare(fx, target)).rejects.toThrow(
                new RegExp(`thin ${target}.*${wrongArchitecture}`, 'i'),
            );
        },
    );

    it.each(['macos-x86_64', 'macos-arm64'])(
        'rejects a Universal executable for %s even when its checksum is locked',
        async (target) => {
            const fx = await fixture(target);
            const ffmpeg = join(fx.input, 'ffmpeg');
            writeFileSync(ffmpeg, universalMachO());
            fx.lock.components.ffmpeg.sha256 = await sha256File(ffmpeg);
            writeJson(fx.lockPath, fx.lock);

            await expect(prepare(fx, target)).rejects.toThrow(
                new RegExp(`thin ${target}.*universal`, 'i'),
            );
        },
    );

    it('rejects a locked BackgroundRemover tree containing a 32-bit Mach-O helper', async () => {
        const fx = await fixture('macos-x86_64');
        writeFileSync(join(fx.backgroundRoot, 'legacy-helper'), machO32());
        fx.lock.components.backgroundRemover.treeSha256 = await sha256Tree(fx.backgroundRoot);
        writeJson(fx.lockPath, fx.lock);

        await expect(prepare(fx, 'macos-x86_64')).rejects.toThrow(
            /non-macos-x86_64 native file \(mach-o-32\/x86\).*legacy-helper/i,
        );
    });

    it('rejects mutable Python or PyTorch provenance in the release lock', async () => {
        const fx = await fixture('macos-x86_64');
        fx.lock.components.backgroundRemover.pythonSource =
            'https://example.invalid/latest/python-x86_64';
        writeJson(fx.lockPath, fx.lock);

        await expect(prepare(fx, 'macos-x86_64')).rejects.toThrow(/pythonSource is mutable/i);
    });

    it('detects payload tampering after preparation', async () => {
        const fx = await fixture('windows-x86_64');
        const result = await prepare(fx, 'windows-x86_64');
        writeFileSync(join(result.root, 'backgroundremover', 'torch-runtime.dat'), 'tampered');

        await expect(verifyVideoRuntime({
            appRoot: fx.appRoot,
            target: 'windows-x86_64',
        })).rejects.toThrow(/tree SHA-256 mismatch/i);
    });

    it('rejects an ARM or second-platform payload directory that Tauri would also bundle', async () => {
        const fx = await fixture('macos-x86_64');
        await prepare(fx, 'macos-x86_64');
        mkdirSync(join(fx.appRoot, 'src-tauri', 'video-runtime', 'macos-arm64'), { recursive: true });

        await expect(verifyVideoRuntime({
            appRoot: fx.appRoot,
            target: 'macos-x86_64',
        })).rejects.toThrow(/keep only macos-x86_64/i);
    });

    it.each(Object.keys(TARGET_FIXTURES))(
        'removes every other supported payload before publishing %s',
        async (target) => {
            const fx = await fixture(target);
            const runtimeBase = join(fx.appRoot, 'src-tauri', 'video-runtime');
            const otherPayloads = Object.keys(TARGET_FIXTURES)
                .filter((candidate) => candidate !== target)
                .map((candidate) => join(runtimeBase, candidate));
            for (const payload of otherPayloads) {
                mkdirSync(payload, { recursive: true });
                writeFileSync(join(payload, 'stale-runtime.dat'), 'stale');
            }

            const result = await prepare(fx, target);

            expect(result.root).toBe(join(runtimeBase, target));
            for (const payload of otherPayloads) expect(existsSync(payload)).toBe(false);
            await expect(verifyVideoRuntime({
                appRoot: fx.appRoot,
                target,
            })).resolves.toMatchObject({ target });
        },
    );

    it('preserves frozen-worker timestamps so bundled Numba caches stay valid', async () => {
        const fx = await fixture('macos-x86_64');
        const source = join(fx.backgroundRoot, 'torch-runtime.dat');
        const timestamp = new Date('2024-01-02T03:04:05.000Z');
        utimesSync(source, timestamp, timestamp);

        const result = await prepare(fx, 'macos-x86_64');
        const copied = join(result.root, 'backgroundremover', 'torch-runtime.dat');

        expect(Math.floor(statSync(copied).mtimeMs / 1000))
            .toBe(Math.floor(timestamp.getTime() / 1000));
    });

    it.each([
        ['macos-x86_64', 'arm64', 'x86_64'],
        ['macos-arm64', 'x86_64', 'arm64'],
    ])(
        'rejects a %s manifest that declares %s',
        async (target, wrongArchitecture, expectedArchitecture) => {
            const fx = await fixture(target);
            const result = await prepare(fx, target);
            const manifest = JSON.parse(readFileSync(result.manifestPath, 'utf8'));
            manifest.architecture = wrongArchitecture;
            writeJson(result.manifestPath, manifest);

            await expect(verifyVideoRuntime({
                appRoot: fx.appRoot,
                target,
            })).rejects.toThrow(
                new RegExp(`manifest architecture must be ${expectedArchitecture}`, 'i'),
            );
        },
    );

    it('rejects an undeclared file in the runtime target root', async () => {
        const fx = await fixture('macos-x86_64');
        const result = await prepare(fx, 'macos-x86_64');
        writeFileSync(join(result.root, 'unlocked-runtime.dat'), 'not covered by the manifest');

        await expect(verifyVideoRuntime({
            appRoot: fx.appRoot,
            target: 'macos-x86_64',
        })).rejects.toThrow(/payload entries.*not declared.*unlocked-runtime\.dat/i);
    });

    it('rejects an undeclared ARM payload directory inside the runtime target root', async () => {
        const fx = await fixture('macos-x86_64');
        const result = await prepare(fx, 'macos-x86_64');
        const armRoot = join(result.root, 'arm64-payload', 'bin');
        mkdirSync(armRoot, { recursive: true });
        writeFileSync(join(armRoot, 'helper'), machO('arm64'));

        await expect(verifyVideoRuntime({
            appRoot: fx.appRoot,
            target: 'macos-x86_64',
        })).rejects.toThrow(/payload entries.*not declared.*arm64-payload/i);
    });

    it('recognises x64 and ARM native headers without executing them', async () => {
        const root = tempRoot();
        const x64 = join(root, 'x64.exe');
        const arm = join(root, 'arm');
        writeFileSync(x64, pe('x86_64'));
        writeFileSync(arm, machO('arm64'));

        await expect(inspectNativeBinary(x64)).resolves.toEqual({ format: 'pe', arch: 'x86_64' });
        await expect(inspectNativeBinary(arm)).resolves.toEqual({ format: 'mach-o', arch: 'arm64' });
    });

    it('rejects FFmpeg builds whose configure flags forbid redistribution', () => {
        expect(() => assertRedistributableFfmpegBuild(
            'ffmpeg version 6.1.1\nconfiguration: --enable-gpl --enable-version3 --enable-nonfree',
            'FFmpeg',
        )).toThrow(/enable-nonfree.*cannot be redistributed/i);
    });

    it('allows a pinned GPL or LGPL FFmpeg build without nonfree components', () => {
        expect(() => assertRedistributableFfmpegBuild(
            'ffmpeg version 6.1.1\nconfiguration: --enable-gpl --enable-version3 --enable-libvpx',
            'FFmpeg',
        )).not.toThrow();
    });

    it('terminates a hung runtime smoke command at its deadline', async () => {
        const startedAt = Date.now();

        await expect(runSmokeCommand(
            process.execPath,
            ['-e', 'setInterval(() => {}, 1000)'],
            50,
        )).rejects.toBeTruthy();

        expect(Date.now() - startedAt).toBeLessThan(800);
    });

    it('allows frozen BackgroundRemover cold starts without weakening FFmpeg deadlines', () => {
        expect(VIDEO_RUNTIME_SMOKE_TIMEOUTS).toEqual({
            ffmpeg: 10_000,
            backgroundRemover: 240_000,
        });
    });

    it('disables frozen-worker Numba JIT and routes caches outside the read-only payload', () => {
        expect(backgroundRemoverSmokeEnvironment(
            '/runtime/models/u2netp.pth',
            'macos-x86_64',
            { PATH: '/runtime/bin' },
            '/private/tmp',
            '/runtime/bin/ffmpeg',
        )).toEqual({
            PATH: '/runtime/bin',
            BACKGROUNDREMOVER_DEVICE: 'cpu',
            U2NETP_PATH: '/runtime/models/u2netp.pth',
            FFMPEG_BINARY: 'auto-detect',
            IMAGEIO_FFMPEG_EXE: '/runtime/bin/ffmpeg',
            NUMBA_DISABLE_JIT: '1',
            NUMBA_CACHE_DIR: '/private/tmp/cpa-video-runtime-numba-cache-macos-x86_64',
        });
    });

    it('tracks a frozen entry point that handles multiprocessing child arguments', () => {
        const source = readFileSync(BACKGROUND_REMOVER_ENTRY_PATH, 'utf8');
        const freezeSupport = source.indexOf('multiprocessing.freeze_support()');
        const mainCall = source.indexOf('\n    main()');

        expect(freezeSupport).toBeGreaterThan(-1);
        expect(mainCall).toBeGreaterThan(freezeSupport);
    });

    it('rejects a locked FFmpeg binary containing the non-redistributable build flag', async () => {
        const fx = await fixture('macos-x86_64');
        const ffmpeg = join(fx.input, 'ffmpeg');
        writeFileSync(ffmpeg, Buffer.concat([machO('x86_64'), Buffer.from('--enable-nonfree\0')]));
        fx.lock.components.ffmpeg.sha256 = await sha256File(ffmpeg);
        writeJson(fx.lockPath, fx.lock);

        await expect(prepare(fx, 'macos-x86_64')).rejects.toThrow(
            /ffmpeg.*enable-nonfree.*cannot be redistributed/i,
        );
    });

    it('recognises a universal Mach-O header instead of accepting either architecture', async () => {
        const root = tempRoot();
        const binary = join(root, 'universal');
        writeFileSync(binary, universalMachO());

        await expect(inspectNativeBinary(binary)).resolves.toEqual({
            format: 'mach-o-fat',
            arch: 'universal',
        });
    });

    it.each(['little', 'big'])(
        'recognises a %s-endian 32-bit Mach-O header instead of treating it as unknown',
        async (byteOrder) => {
            const root = tempRoot();
            const binary = join(root, `mach-o-32-${byteOrder}`);
            writeFileSync(binary, machO32(byteOrder));

            await expect(inspectNativeBinary(binary)).resolves.toEqual({
                format: 'mach-o-32',
                arch: 'x86',
            });
        },
    );
});
