import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { createReadStream } from 'node:fs';
import {
    chmod,
    cp,
    mkdir,
    open,
    readFile,
    readdir,
    rename,
    rm,
    stat,
    writeFile,
} from 'node:fs/promises';
import { delimiter, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_APP_ROOT = resolve(SCRIPT_DIR, '..');
const SCRIPT_VERSION = 1;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
export const VIDEO_RUNTIME_SMOKE_TIMEOUTS = Object.freeze({
    ffmpeg: 10_000,
    backgroundRemover: 240_000,
});
const execFileAsync = promisify(execFile);

const TARGETS = Object.freeze({
    'macos-x86_64': {
        os: 'darwin',
        architecture: 'x86_64',
        hostArchitecture: 'x64',
        nativeFormat: 'mach-o',
        executableNames: {
            ffmpeg: 'ffmpeg',
            ffprobe: 'ffprobe',
            backgroundRemover: 'backgroundremover',
        },
    },
    'macos-arm64': {
        os: 'darwin',
        architecture: 'arm64',
        hostArchitecture: 'arm64',
        nativeFormat: 'mach-o',
        executableNames: {
            ffmpeg: 'ffmpeg',
            ffprobe: 'ffprobe',
            backgroundRemover: 'backgroundremover',
        },
    },
    'windows-x86_64': {
        os: 'win32',
        architecture: 'x86_64',
        hostArchitecture: 'x64',
        nativeFormat: 'pe',
        executableNames: {
            ffmpeg: 'ffmpeg.exe',
            ffprobe: 'ffprobe.exe',
            backgroundRemover: 'backgroundremover.exe',
        },
    },
});

function resolvePath(base, path) {
    if (!path) return null;
    return isAbsolute(path) ? path : resolve(base, path);
}

function slash(path) {
    return path.split(sep).join('/');
}

function assertTarget(target) {
    if (!Object.hasOwn(TARGETS, target)) {
        throw new Error(
            `Unsupported video runtime target "${target}"; allowed targets: ${Object.keys(TARGETS).join(', ')}`,
        );
    }
    return TARGETS[target];
}

export function hostCanRunRuntimeTarget(
    target,
    platform = process.platform,
    architecture = process.arch,
) {
    const targetConfig = assertTarget(target);
    if (platform !== targetConfig.os) return false;
    const normalizedArchitecture = architecture === 'x86_64'
        ? 'x64'
        : (architecture === 'aarch64' ? 'arm64' : architecture);
    if (normalizedArchitecture === targetConfig.hostArchitecture) return true;
    return platform === 'darwin'
        && targetConfig.architecture === 'x86_64'
        && normalizedArchitecture === 'arm64';
}

function assertSha256(value, label) {
    if (!SHA256_PATTERN.test(value ?? '')) {
        throw new Error(`${label} must be a lowercase SHA-256`);
    }
}

function assertImmutableSource(value, label) {
    if (typeof value !== 'string' || value.trim().length < 8) {
        throw new Error(`${label} must name an immutable source or build reference`);
    }
    if (/(?:^|[/_-])(latest|snapshot)(?:$|[/_.-])/i.test(value) || /getrelease/i.test(value)) {
        throw new Error(`${label} is mutable; pin a versioned source or build reference`);
    }
}

async function readJson(path, label = path) {
    try {
        return JSON.parse(await readFile(path, 'utf8'));
    } catch (error) {
        throw new Error(`Cannot read ${label}: ${error.message}`);
    }
}

async function assertFile(path, label) {
    const info = await stat(path).catch(() => null);
    if (!info?.isFile()) throw new Error(`${label} is not a file: ${path}`);
}

async function assertDirectory(path, label) {
    const info = await stat(path).catch(() => null);
    if (!info?.isDirectory()) throw new Error(`${label} is not a directory: ${path}`);
}

async function assertNoUnexpectedPayloadEntries(runtimeBase, target) {
    const entries = await readdir(runtimeBase, { withFileTypes: true }).catch(() => []);
    const allowedFiles = new Set([
        'README.md',
        'release-lock.example.json',
        'source-policy.json',
    ]);
    const unexpected = entries
        .filter((entry) => (
            entry.isSymbolicLink()
            || (entry.isDirectory() ? entry.name !== target : !allowedFiles.has(entry.name))
        ))
        .map((entry) => entry.name);
    if (unexpected.length > 0) {
        throw new Error(
            `Unexpected video-runtime payload entries (${unexpected.join(', ')}). `
            + `Tauri bundles the whole video-runtime directory; keep only ${target} before packaging`,
        );
    }
}

async function assertNoUnknownPayloadDirectories(runtimeBase) {
    const entries = await readdir(runtimeBase, { withFileTypes: true }).catch(() => []);
    const unknown = entries
        .filter((entry) => entry.isDirectory() && !Object.hasOwn(TARGETS, entry.name))
        .map((entry) => entry.name);
    if (unknown.length > 0) {
        throw new Error(
            `Unknown video-runtime payload directories (${unknown.join(', ')}); unsupported/custom payloads must not be bundled`,
        );
    }
}

async function assertDeclaredPayloadEntries(root, target) {
    const names = assertTarget(target).executableNames;
    await assertExactEntries(root, [
        'backgroundremover',
        'bin',
        'licenses',
        'models',
        'runtime-manifest.json',
    ], 'runtime root');
    await assertExactEntries(
        join(root, 'bin'),
        [names.ffmpeg, names.ffprobe],
        'runtime bin directory',
    );
    await assertExactEntries(
        join(root, 'models'),
        ['u2netp.pth'],
        'runtime models directory',
    );
}

async function assertExactEntries(root, expectedNames, label) {
    const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
    const expected = new Set(expectedNames);
    const undeclared = entries
        .filter((entry) => entry.isSymbolicLink() || !expected.has(entry.name))
        .map((entry) => slash(relative(root, join(root, entry.name))));
    if (undeclared.length > 0) {
        throw new Error(
            `${label} payload entries are not declared by runtime-manifest.json: ${undeclared.join(', ')}`,
        );
    }
}

export async function sha256File(path) {
    return new Promise((resolveHash, rejectHash) => {
        const hash = createHash('sha256');
        const stream = createReadStream(path);
        stream.on('data', (chunk) => hash.update(chunk));
        stream.on('error', rejectHash);
        stream.on('end', () => resolveHash(hash.digest('hex')));
    });
}

async function listFiles(root, current = root) {
    const entries = await readdir(current, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
        const path = join(current, entry.name);
        if (entry.isSymbolicLink()) {
            throw new Error(
                `Runtime payload must be flattened and relocatable; symbolic link found: ${relative(root, path)}`,
            );
        }
        if (entry.isDirectory()) files.push(...await listFiles(root, path));
        else if (entry.isFile()) files.push(path);
    }
    return files.sort((a, b) => slash(relative(root, a)).localeCompare(slash(relative(root, b))));
}

export async function sha256Tree(root) {
    const hash = createHash('sha256');
    for (const path of await listFiles(root)) {
        const name = slash(relative(root, path));
        hash.update(name);
        hash.update('\0');
        hash.update(await sha256File(path));
        hash.update('\n');
    }
    return hash.digest('hex');
}

function inspectNativeBuffer(buffer) {
    if (buffer.length >= 8) {
        const leMagic = buffer.readUInt32LE(0);
        const beMagic = buffer.readUInt32BE(0);
        if (leMagic === 0xfeedfacf) {
            return { format: 'mach-o', arch: machCpuName(buffer.readUInt32LE(4)) };
        }
        if (beMagic === 0xfeedfacf) {
            return { format: 'mach-o', arch: machCpuName(buffer.readUInt32BE(4)) };
        }
        if (leMagic === 0xfeedface) {
            return { format: 'mach-o-32', arch: machCpuName(buffer.readUInt32LE(4)) };
        }
        if (beMagic === 0xfeedface) {
            return { format: 'mach-o-32', arch: machCpuName(buffer.readUInt32BE(4)) };
        }
        if ([0xcafebabe, 0xcafebabf, 0xbebafeca, 0xbfbafeca].includes(beMagic)) {
            return { format: 'mach-o-fat', arch: 'universal' };
        }
    }

    if (buffer.length >= 0x40 && buffer[0] === 0x4d && buffer[1] === 0x5a) {
        const peOffset = buffer.readUInt32LE(0x3c);
        if (
            peOffset + 6 <= buffer.length
            && buffer.toString('binary', peOffset, peOffset + 4) === 'PE\0\0'
        ) {
            return { format: 'pe', arch: peMachineName(buffer.readUInt16LE(peOffset + 4)) };
        }
    }
    return { format: 'unknown', arch: 'unknown' };
}

function machCpuName(cpu) {
    if (cpu === 0x01000007) return 'x86_64';
    if (cpu === 0x0100000c) return 'arm64';
    if (cpu === 7) return 'x86';
    return `mach-cpu-0x${cpu.toString(16)}`;
}

function peMachineName(machine) {
    if (machine === 0x8664) return 'x86_64';
    if (machine === 0xaa64) return 'arm64';
    if (machine === 0x014c) return 'x86';
    return `pe-machine-0x${machine.toString(16)}`;
}

export async function inspectNativeBinary(path) {
    const handle = await open(path, 'r');
    try {
        const header = Buffer.alloc(4096);
        const { bytesRead } = await handle.read(header, 0, header.length, 0);
        return inspectNativeBuffer(header.subarray(0, bytesRead));
    } finally {
        await handle.close();
    }
}

async function assertTargetBinary(path, target, label) {
    const targetConfig = assertTarget(target);
    const actual = await inspectNativeBinary(path);
    if (
        actual.format !== targetConfig.nativeFormat
        || actual.arch !== targetConfig.architecture
    ) {
        throw new Error(
            `${label} must be a thin ${target} binary; found ${actual.format}/${actual.arch}: ${path}`,
        );
    }
}

async function assertRedistributableFfmpegBinary(path, label) {
    const bytes = await readFile(path);
    if (bytes.includes(Buffer.from('--enable-nonfree'))) {
        throw new Error(
            `${label} contains --enable-nonfree and cannot be redistributed in the app bundle`,
        );
    }
}

async function assertNativeTree(root, target, label) {
    const targetConfig = assertTarget(target);
    let nativeCount = 0;
    for (const path of await listFiles(root)) {
        const actual = await inspectNativeBinary(path);
        if (actual.format === 'unknown') continue;
        nativeCount += 1;
        if (
            actual.format !== targetConfig.nativeFormat
            || actual.arch !== targetConfig.architecture
        ) {
            throw new Error(
                `${label} contains a non-${target} native file (${actual.format}/${actual.arch}): ${relative(root, path)}`,
            );
        }
    }
    if (nativeCount === 0) {
        throw new Error(
            `${label} contains no verifiable native ${targetConfig.architecture} executable`,
        );
    }
}

function validatePolicy(policy) {
    if (policy.schemaVersion !== 1) throw new Error('Unsupported video runtime source-policy schema');
    if (!Array.isArray(policy.supportedTargets)) throw new Error('source-policy supportedTargets is missing');
    assertSha256(policy.u2netp?.sha256, 'source-policy u2netp.sha256');
    if (!policy.backgroundRemover?.commit) throw new Error('source-policy BackgroundRemover commit is missing');
    const patches = policy.backgroundRemover?.patches;
    if (!Array.isArray(patches) || patches.length === 0) {
        throw new Error('source-policy BackgroundRemover patches are missing');
    }
    const patchIds = new Set();
    for (const patch of patches) {
        if (typeof patch?.id !== 'string' || !patch.id.trim()) {
            throw new Error('source-policy BackgroundRemover patch id is missing');
        }
        if (patchIds.has(patch.id)) {
            throw new Error(`source-policy BackgroundRemover patch id is duplicated: ${patch.id}`);
        }
        patchIds.add(patch.id);
        if (typeof patch.path !== 'string' || !patch.path.trim() || isAbsolute(patch.path)) {
            throw new Error(`source-policy BackgroundRemover patch path must be app-relative: ${patch.path ?? '<missing>'}`);
        }
        assertSha256(patch.sha256, `source-policy BackgroundRemover patch ${patch.id} sha256`);
    }
}

async function assertPolicyPatchFiles(policy, appRoot) {
    for (const patch of policy.backgroundRemover.patches) {
        const path = resolve(appRoot, patch.path);
        await assertFile(path, `BackgroundRemover patch ${patch.id}`);
        await assertHash(path, patch.sha256, `BackgroundRemover patch ${patch.id}`);
    }
}

function validateLock(lock, policy, target) {
    if (lock.schemaVersion !== 1) throw new Error('Unsupported video runtime release-lock schema');
    if (lock.target !== target) {
        throw new Error(`Release lock target ${lock.target ?? '<missing>'} does not match ${target}`);
    }
    if (!policy.supportedTargets.includes(target)) throw new Error(`Target ${target} is not allowed by source-policy`);
    if (lock.backgroundRemoverCommit !== policy.backgroundRemover.commit) {
        throw new Error(
            `BackgroundRemover commit must be ${policy.backgroundRemover.commit}; got ${lock.backgroundRemoverCommit ?? '<missing>'}`,
        );
    }
    for (const name of ['ffmpeg', 'ffprobe', 'backgroundRemover', 'u2netp', 'licenses']) {
        const component = lock.components?.[name];
        if (!component) throw new Error(`Release lock component ${name} is missing`);
        assertImmutableSource(component.source, `${name}.source`);
        assertSha256(
            name === 'backgroundRemover' || name === 'licenses'
                ? component.treeSha256
                : component.sha256,
            `${name}.${name === 'backgroundRemover' || name === 'licenses' ? 'treeSha256' : 'sha256'}`,
        );
    }
    if (lock.components.u2netp.sha256 !== policy.u2netp.sha256) {
        throw new Error(`U2NetP must match the pinned model SHA-256 ${policy.u2netp.sha256}`);
    }
    for (const name of ['ffmpeg', 'ffprobe']) {
        if (typeof lock.components[name].version !== 'string' || !lock.components[name].version.trim()) {
            throw new Error(`${name}.version is required`);
        }
    }
    const worker = lock.components.backgroundRemover;
    const expectedPatches = policy.backgroundRemover.patches;
    if (JSON.stringify(worker.patches) !== JSON.stringify(expectedPatches)) {
        throw new Error(
            'BackgroundRemover patch provenance must exactly match source-policy',
        );
    }
    for (const field of ['pythonVersion', 'pythonSource', 'torchVersion', 'torchSource', 'packager']) {
        if (typeof worker[field] !== 'string' || !worker[field].trim()) {
            throw new Error(`backgroundRemover.${field} is required`);
        }
    }
    assertImmutableSource(worker.pythonSource, 'backgroundRemover.pythonSource');
    assertImmutableSource(worker.torchSource, 'backgroundRemover.torchSource');
}

function payloadPaths(root, target) {
    const names = assertTarget(target).executableNames;
    return {
        root,
        ffmpeg: join(root, 'bin', names.ffmpeg),
        ffprobe: join(root, 'bin', names.ffprobe),
        backgroundRoot: join(root, 'backgroundremover'),
        backgroundRemover: join(root, 'backgroundremover', names.backgroundRemover),
        model: join(root, 'models', 'u2netp.pth'),
        licenses: join(root, 'licenses'),
        manifest: join(root, 'runtime-manifest.json'),
    };
}

function manifestFromLock(lock, target) {
    const targetConfig = assertTarget(target);
    const names = targetConfig.executableNames;
    return {
        schemaVersion: 1,
        scriptVersion: SCRIPT_VERSION,
        target,
        architecture: targetConfig.architecture,
        backgroundRemoverCommit: lock.backgroundRemoverCommit,
        components: {
            ffmpeg: {
                path: `bin/${names.ffmpeg}`,
                source: lock.components.ffmpeg.source,
                version: lock.components.ffmpeg.version,
                sha256: lock.components.ffmpeg.sha256,
            },
            ffprobe: {
                path: `bin/${names.ffprobe}`,
                source: lock.components.ffprobe.source,
                version: lock.components.ffprobe.version,
                sha256: lock.components.ffprobe.sha256,
            },
            backgroundRemover: {
                path: `backgroundremover/${names.backgroundRemover}`,
                source: lock.components.backgroundRemover.source,
                patches: lock.components.backgroundRemover.patches,
                pythonVersion: lock.components.backgroundRemover.pythonVersion,
                pythonSource: lock.components.backgroundRemover.pythonSource,
                torchVersion: lock.components.backgroundRemover.torchVersion,
                torchSource: lock.components.backgroundRemover.torchSource,
                packager: lock.components.backgroundRemover.packager,
                treeSha256: lock.components.backgroundRemover.treeSha256,
            },
            u2netp: {
                path: 'models/u2netp.pth',
                source: lock.components.u2netp.source,
                sha256: lock.components.u2netp.sha256,
            },
            licenses: {
                path: 'licenses',
                source: lock.components.licenses.source,
                treeSha256: lock.components.licenses.treeSha256,
            },
        },
    };
}

async function assertHash(path, expected, label) {
    const actual = await sha256File(path);
    if (actual !== expected) throw new Error(`${label} SHA-256 mismatch: expected ${expected}, got ${actual}`);
}

async function assertTreeHash(path, expected, label) {
    const actual = await sha256Tree(path);
    if (actual !== expected) throw new Error(`${label} tree SHA-256 mismatch: expected ${expected}, got ${actual}`);
}

export function assertRedistributableFfmpegBuild(versionOutput, label = 'FFmpeg') {
    if (/(?:^|\s)--enable-nonfree(?:\s|$)/.test(versionOutput)) {
        throw new Error(
            `${label} was built with --enable-nonfree and cannot be redistributed in the app bundle`,
        );
    }
}

export function runSmokeCommand(command, args, timeoutMs, options = {}) {
    return execFileAsync(command, args, {
        maxBuffer: 16 * 1024 * 1024,
        ...options,
        timeout: timeoutMs,
        killSignal: 'SIGKILL',
    });
}

export function backgroundRemoverSmokeEnvironment(
    modelPath,
    target,
    environment = process.env,
    temporaryRoot = tmpdir(),
    ffmpegPath = null,
) {
    const runtimeBin = ffmpegPath ? dirname(ffmpegPath) : null;
    const path = runtimeBin && environment.PATH !== runtimeBin
        && !environment.PATH?.startsWith(`${runtimeBin}${delimiter}`)
        ? [runtimeBin, environment.PATH].filter(Boolean).join(delimiter)
        : environment.PATH;
    return {
        ...environment,
        ...(path ? { PATH: path } : {}),
        BACKGROUNDREMOVER_DEVICE: 'cpu',
        U2NETP_PATH: modelPath,
        FFMPEG_BINARY: 'auto-detect',
        ...(ffmpegPath ? { IMAGEIO_FFMPEG_EXE: ffmpegPath } : {}),
        NUMBA_DISABLE_JIT: '1',
        NUMBA_CACHE_DIR: join(temporaryRoot, `cpa-video-runtime-numba-cache-${target}`),
    };
}

async function smokeRuntime(paths, target, policy, manifest) {
    const targetConfig = assertTarget(target);
    if (!hostCanRunRuntimeTarget(target)) {
        throw new Error(
            `--smoke requires a ${targetConfig.architecture} ${targetConfig.os} host; `
            + `current host is ${process.platform}/${process.arch}`,
        );
    }
    const ffmpegVersion = await runSmokeCommand(
        paths.ffmpeg,
        ['-version'],
        VIDEO_RUNTIME_SMOKE_TIMEOUTS.ffmpeg,
    );
    assertRedistributableFfmpegBuild(ffmpegVersion.stdout, 'FFmpeg');
    if (!ffmpegVersion.stdout.includes(manifest.components.ffmpeg.version)) {
        throw new Error(
            `FFmpeg version output does not match release lock ${manifest.components.ffmpeg.version}`,
        );
    }
    const ffprobeVersion = await runSmokeCommand(
        paths.ffprobe,
        ['-version'],
        VIDEO_RUNTIME_SMOKE_TIMEOUTS.ffmpeg,
    );
    assertRedistributableFfmpegBuild(ffprobeVersion.stdout, 'ffprobe');
    if (!ffprobeVersion.stdout.includes(manifest.components.ffprobe.version)) {
        throw new Error(
            `ffprobe version output does not match release lock ${manifest.components.ffprobe.version}`,
        );
    }
    const encoders = await runSmokeCommand(
        paths.ffmpeg,
        ['-hide_banner', '-encoders'],
        VIDEO_RUNTIME_SMOKE_TIMEOUTS.ffmpeg,
    );
    for (const encoder of policy.ffmpeg.requiredEncoders) {
        if (!encoders.stdout.includes(encoder)) throw new Error(`FFmpeg is missing required encoder ${encoder}`);
    }
    if (targetConfig.os === 'darwin') {
        for (const encoder of policy.ffmpeg.macosRequiredEncoders) {
            if (!encoders.stdout.includes(encoder)) throw new Error(`FFmpeg is missing required encoder ${encoder}`);
        }
    }
    await runSmokeCommand(
        paths.backgroundRemover,
        ['--help'],
        VIDEO_RUNTIME_SMOKE_TIMEOUTS.backgroundRemover,
        {
            env: backgroundRemoverSmokeEnvironment(
                paths.model,
                target,
                process.env,
                tmpdir(),
                paths.ffmpeg,
            ),
        },
    );
}

function resolveRuntimeInputs(appRoot, options) {
    return {
        ffmpeg: resolvePath(appRoot, options.ffmpegPath),
        ffprobe: resolvePath(appRoot, options.ffprobePath),
        backgroundRoot: resolvePath(appRoot, options.backgroundRoot),
        model: resolvePath(appRoot, options.modelPath),
        licenses: resolvePath(appRoot, options.licensesPath),
    };
}

async function validateRuntimeInputs(inputs, target, policy) {
    const names = assertTarget(target).executableNames;
    for (const [name, path] of Object.entries(inputs)) {
        if (!path) throw new Error(`Missing ${name} input`);
    }
    await Promise.all([
        assertFile(inputs.ffmpeg, 'ffmpeg input'),
        assertFile(inputs.ffprobe, 'ffprobe input'),
        assertFile(inputs.model, 'U2NetP input'),
        assertDirectory(inputs.backgroundRoot, 'BackgroundRemover input'),
        assertDirectory(inputs.licenses, 'runtime licenses input'),
    ]);
    const sourceLauncher = join(inputs.backgroundRoot, names.backgroundRemover);
    await assertFile(sourceLauncher, 'BackgroundRemover launcher input');
    await assertTargetBinary(inputs.ffmpeg, target, 'ffmpeg');
    await assertTargetBinary(inputs.ffprobe, target, 'ffprobe');
    await assertRedistributableFfmpegBinary(inputs.ffmpeg, 'ffmpeg');
    await assertRedistributableFfmpegBinary(inputs.ffprobe, 'ffprobe');
    await assertTargetBinary(sourceLauncher, target, 'BackgroundRemover launcher');
    await assertNativeTree(inputs.backgroundRoot, target, 'BackgroundRemover runtime');
    for (const filename of policy.licenses.requiredFiles) {
        await assertFile(join(inputs.licenses, filename), `required license ${filename}`);
    }
    const modelInfo = await stat(inputs.model);
    const modelSha256 = await sha256File(inputs.model);
    if (modelInfo.size !== policy.u2netp.size || modelSha256 !== policy.u2netp.sha256) {
        throw new Error(
            `U2NetP does not match source-policy (expected ${policy.u2netp.size} bytes / ${policy.u2netp.sha256})`,
        );
    }
    return { sourceLauncher };
}

export async function createVideoRuntimeLock(options = {}) {
    const appRoot = resolve(options.appRoot ?? DEFAULT_APP_ROOT);
    const target = options.target;
    assertTarget(target);
    const policyPath = resolvePath(
        appRoot,
        options.policyPath ?? 'src-tauri/video-runtime/source-policy.json',
    );
    const policy = await readJson(policyPath, 'video runtime source-policy');
    validatePolicy(policy);
    await assertPolicyPatchFiles(policy, appRoot);
    const inputs = resolveRuntimeInputs(appRoot, options);
    await validateRuntimeInputs(inputs, target, policy);
    const lock = {
        schemaVersion: 1,
        target,
        backgroundRemoverCommit: policy.backgroundRemover.commit,
        components: {
            ffmpeg: {
                source: options.ffmpegSource,
                version: options.ffmpegVersion,
                sha256: await sha256File(inputs.ffmpeg),
            },
            ffprobe: {
                source: options.ffprobeSource,
                version: options.ffprobeVersion,
                sha256: await sha256File(inputs.ffprobe),
            },
            backgroundRemover: {
                source: options.backgroundRemoverSource,
                patches: policy.backgroundRemover.patches,
                pythonVersion: options.pythonVersion,
                pythonSource: options.pythonSource,
                torchVersion: options.torchVersion,
                torchSource: options.torchSource,
                packager: options.packager,
                treeSha256: await sha256Tree(inputs.backgroundRoot),
            },
            u2netp: {
                source: policy.u2netp.source,
                sha256: policy.u2netp.sha256,
            },
            licenses: {
                source: options.licensesSource,
                treeSha256: await sha256Tree(inputs.licenses),
            },
        },
    };
    validateLock(lock, policy, target);
    const outPath = resolvePath(appRoot, options.outPath);
    if (!outPath) throw new Error('--out is required');
    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, `${JSON.stringify(lock, null, 2)}\n`);
    return { target, lockPath: outPath };
}

export async function verifyVideoRuntime(options = {}) {
    const appRoot = resolve(options.appRoot ?? DEFAULT_APP_ROOT);
    const target = options.target;
    assertTarget(target);
    const policyPath = resolvePath(
        appRoot,
        options.policyPath ?? 'src-tauri/video-runtime/source-policy.json',
    );
    const policy = await readJson(policyPath, 'video runtime source-policy');
    validatePolicy(policy);
    await assertPolicyPatchFiles(policy, appRoot);
    const root = resolvePath(
        appRoot,
        options.runtimeRoot ?? `src-tauri/video-runtime/${target}`,
    );
    if (!options.allowOtherTargets) {
        await assertNoUnexpectedPayloadEntries(dirname(root), target);
    }
    const paths = payloadPaths(root, target);
    await assertDeclaredPayloadEntries(root, target);
    const manifest = await readJson(paths.manifest, `${target} runtime-manifest`);
    validateLock({
        ...manifest,
        components: manifest.components,
    }, policy, target);
    const targetConfig = assertTarget(target);
    if (manifest.architecture !== targetConfig.architecture) {
        throw new Error(
            `Runtime manifest architecture must be ${targetConfig.architecture}`,
        );
    }

    await Promise.all([
        assertFile(paths.ffmpeg, 'ffmpeg'),
        assertFile(paths.ffprobe, 'ffprobe'),
        assertFile(paths.backgroundRemover, 'BackgroundRemover launcher'),
        assertFile(paths.model, 'U2NetP model'),
        assertDirectory(paths.backgroundRoot, 'BackgroundRemover runtime'),
        assertDirectory(paths.licenses, 'runtime licenses'),
    ]);
    for (const filename of policy.licenses.requiredFiles) {
        await assertFile(join(paths.licenses, filename), `required license ${filename}`);
    }
    await assertTargetBinary(paths.ffmpeg, target, 'ffmpeg');
    await assertTargetBinary(paths.ffprobe, target, 'ffprobe');
    await assertRedistributableFfmpegBinary(paths.ffmpeg, 'ffmpeg');
    await assertRedistributableFfmpegBinary(paths.ffprobe, 'ffprobe');
    await assertTargetBinary(paths.backgroundRemover, target, 'BackgroundRemover launcher');
    await assertNativeTree(paths.backgroundRoot, target, 'BackgroundRemover runtime');
    await Promise.all([
        assertHash(paths.ffmpeg, manifest.components.ffmpeg.sha256, 'ffmpeg'),
        assertHash(paths.ffprobe, manifest.components.ffprobe.sha256, 'ffprobe'),
        assertTreeHash(
            paths.backgroundRoot,
            manifest.components.backgroundRemover.treeSha256,
            'BackgroundRemover runtime',
        ),
        assertHash(paths.model, manifest.components.u2netp.sha256, 'U2NetP'),
        assertTreeHash(paths.licenses, manifest.components.licenses.treeSha256, 'runtime licenses'),
    ]);
    const modelInfo = await stat(paths.model);
    if (modelInfo.size !== policy.u2netp.size) {
        throw new Error(`U2NetP size mismatch: expected ${policy.u2netp.size}, got ${modelInfo.size}`);
    }
    if (options.smoke) await smokeRuntime(paths, target, policy, manifest);
    return { target, root, manifestPath: paths.manifest };
}

export async function prepareVideoRuntime(options = {}) {
    const appRoot = resolve(options.appRoot ?? DEFAULT_APP_ROOT);
    const target = options.target;
    assertTarget(target);
    const policyPath = resolvePath(
        appRoot,
        options.policyPath ?? 'src-tauri/video-runtime/source-policy.json',
    );
    const lockPath = resolvePath(appRoot, options.lockPath);
    if (!lockPath) throw new Error('--lock is required');
    const policy = await readJson(policyPath, 'video runtime source-policy');
    const lock = await readJson(lockPath, 'video runtime release lock');
    validatePolicy(policy);
    await assertPolicyPatchFiles(policy, appRoot);
    validateLock(lock, policy, target);

    const inputs = resolveRuntimeInputs(appRoot, options);
    await validateRuntimeInputs(inputs, target, policy);

    const finalRoot = resolvePath(
        appRoot,
        options.runtimeRoot ?? `src-tauri/video-runtime/${target}`,
    );
    await assertNoUnknownPayloadDirectories(dirname(finalRoot));
    const tempRoot = `${finalRoot}.preparing-${process.pid}`;
    const staged = payloadPaths(tempRoot, target);
    await rm(tempRoot, { recursive: true, force: true });
    await mkdir(join(tempRoot, 'bin'), { recursive: true });
    await mkdir(join(tempRoot, 'models'), { recursive: true });
    try {
        await cp(inputs.ffmpeg, staged.ffmpeg);
        await cp(inputs.ffprobe, staged.ffprobe);
        await cp(inputs.backgroundRoot, staged.backgroundRoot, {
            recursive: true,
            dereference: true,
            preserveTimestamps: true,
        });
        await cp(inputs.model, staged.model);
        await cp(inputs.licenses, staged.licenses, { recursive: true, dereference: true });
        if (assertTarget(target).os === 'darwin') {
            await Promise.all([
                chmod(staged.ffmpeg, 0o755),
                chmod(staged.ffprobe, 0o755),
                chmod(staged.backgroundRemover, 0o755),
            ]);
        }
        await Promise.all([
            assertTargetBinary(staged.ffmpeg, target, 'ffmpeg'),
            assertTargetBinary(staged.ffprobe, target, 'ffprobe'),
            assertTargetBinary(staged.backgroundRemover, target, 'BackgroundRemover launcher'),
            assertNativeTree(staged.backgroundRoot, target, 'BackgroundRemover runtime'),
            assertHash(staged.ffmpeg, lock.components.ffmpeg.sha256, 'ffmpeg'),
            assertHash(staged.ffprobe, lock.components.ffprobe.sha256, 'ffprobe'),
            assertTreeHash(
                staged.backgroundRoot,
                lock.components.backgroundRemover.treeSha256,
                'BackgroundRemover runtime',
            ),
            assertHash(staged.model, lock.components.u2netp.sha256, 'U2NetP'),
            assertTreeHash(staged.licenses, lock.components.licenses.treeSha256, 'runtime licenses'),
        ]);
        for (const filename of policy.licenses.requiredFiles) {
            await assertFile(join(staged.licenses, filename), `required license ${filename}`);
        }
        const modelInfo = await stat(staged.model);
        if (modelInfo.size !== policy.u2netp.size) {
            throw new Error(`U2NetP size mismatch: expected ${policy.u2netp.size}, got ${modelInfo.size}`);
        }
        await writeFile(staged.manifest, `${JSON.stringify(manifestFromLock(lock, target), null, 2)}\n`);
        await verifyVideoRuntime({
            appRoot,
            target,
            policyPath,
            runtimeRoot: tempRoot,
            smoke: options.smoke,
            allowOtherTargets: true,
        });
        const runtimeBase = dirname(finalRoot);
        for (const otherTarget of Object.keys(TARGETS).filter((name) => name !== target)) {
            await rm(join(runtimeBase, otherTarget), { recursive: true, force: true });
        }
        await rm(finalRoot, { recursive: true, force: true });
        await mkdir(dirname(finalRoot), { recursive: true });
        await rename(tempRoot, finalRoot);
        await verifyVideoRuntime({ appRoot, target, policyPath, runtimeRoot: finalRoot });
        return { target, root: finalRoot, manifestPath: join(finalRoot, 'runtime-manifest.json') };
    } catch (error) {
        await rm(tempRoot, { recursive: true, force: true });
        throw error;
    }
}

function parseArgs(argv) {
    const [command, ...rest] = argv;
    const values = {};
    for (let index = 0; index < rest.length; index += 1) {
        const token = rest[index];
        if (!token.startsWith('--')) throw new Error(`Unexpected argument: ${token}`);
        const key = token.slice(2);
        if (key === 'smoke') {
            values.smoke = true;
            continue;
        }
        const value = rest[index + 1];
        if (!value || value.startsWith('--')) throw new Error(`Missing value for ${token}`);
        values[key] = value;
        index += 1;
    }
    return { command, values };
}

function printUsage() {
    const targetUsage = Object.keys(TARGETS).join('|');
    process.stdout.write(`Usage:
  node scripts/prepare-video-runtime.mjs lock \\
    --target ${targetUsage} --out /path/release-lock.json \\
    --ffmpeg /path/ffmpeg --ffprobe /path/ffprobe \\
    --background-remover-root /path/relocatable-worker \\
    --u2netp /path/u2netp.pth --licenses /path/licenses \\
    --ffmpeg-source REF --ffmpeg-version VERSION \\
    --ffprobe-source REF --ffprobe-version VERSION \\
    --background-remover-source REF --python-version VERSION \\
    --python-source REF --torch-version VERSION --torch-source REF \\
    --packager REF --licenses-source REF

  node scripts/prepare-video-runtime.mjs prepare \\
    --target ${targetUsage} --lock /path/release-lock.json \\
    --ffmpeg /path/ffmpeg --ffprobe /path/ffprobe \\
    --background-remover-root /path/relocatable-worker \\
    --u2netp /path/u2netp.pth --licenses /path/licenses [--smoke]

  node scripts/prepare-video-runtime.mjs verify \\
    --target ${targetUsage} [--smoke]
`);
}

async function main(argv) {
    const { command, values } = parseArgs(argv);
    if (!command || command === 'help' || values.help) {
        printUsage();
        return;
    }
    const common = {
        appRoot: values['app-root'],
        target: values.target,
        policyPath: values.policy,
        runtimeRoot: values['runtime-root'],
        smoke: values.smoke,
    };
    const inputOptions = {
        ...common,
        ffmpegPath: values.ffmpeg,
        ffprobePath: values.ffprobe,
        backgroundRoot: values['background-remover-root'],
        modelPath: values.u2netp,
        licensesPath: values.licenses,
    };
    const result = command === 'lock'
        ? await createVideoRuntimeLock({
            ...inputOptions,
            outPath: values.out,
            ffmpegSource: values['ffmpeg-source'],
            ffmpegVersion: values['ffmpeg-version'],
            ffprobeSource: values['ffprobe-source'],
            ffprobeVersion: values['ffprobe-version'],
            backgroundRemoverSource: values['background-remover-source'],
            pythonVersion: values['python-version'],
            pythonSource: values['python-source'],
            torchVersion: values['torch-version'],
            torchSource: values['torch-source'],
            packager: values.packager,
            licensesSource: values['licenses-source'],
        })
        : command === 'prepare'
            ? await prepareVideoRuntime({
                ...inputOptions,
                lockPath: values.lock,
            })
            : command === 'verify'
                ? await verifyVideoRuntime(common)
                : (() => { throw new Error(`Unknown command: ${command}`); })();
    process.stdout.write(
        `Video runtime ${command} succeeded for ${result.target}: ${result.root ?? result.lockPath}\n`,
    );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main(process.argv.slice(2)).catch((error) => {
        process.stderr.write(`${error.message}\n`);
        process.exitCode = 1;
    });
}
