import { execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, readdir, rm } from 'node:fs/promises';
import {
    dirname,
    isAbsolute,
    join,
    relative,
    resolve,
    sep,
} from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import {
    hostCanRunRuntimeTarget,
    inspectNativeBinary,
    verifyVideoRuntime,
} from './prepare-video-runtime.mjs';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_APP_ROOT = resolve(SCRIPT_DIR, '..');
const execFileAsync = promisify(execFile);

const RUNTIME_TARGETS = Object.freeze({
    'x86_64-apple-darwin': 'macos-x86_64',
    'aarch64-apple-darwin': 'macos-arm64',
    'x86_64-pc-windows-msvc': 'windows-x86_64',
});

export function runtimeTargetForTauriTriple(triple) {
    const runtimeTarget = RUNTIME_TARGETS[triple];
    if (!runtimeTarget) {
        throw new Error(
            `Unsupported self-contained video build target "${triple ?? '<missing>'}". `
            + `Supported targets: ${Object.keys(RUNTIME_TARGETS).join(', ')}`,
        );
    }
    return runtimeTarget;
}

function explicitTarget(argv) {
    for (let index = 0; index < argv.length; index += 1) {
        const token = argv[index];
        if (token === '--target' || token === '-t') return argv[index + 1];
        if (token.startsWith('--target=')) return token.slice('--target='.length);
    }
    return null;
}

export function resolveTauriTargetTriple(argv = [], env = process.env) {
    const platform = env.TAURI_ENV_PLATFORM;
    const architecture = env.TAURI_ENV_ARCH;
    const normalizedArchitecture = architecture === 'arm64' ? 'aarch64' : architecture;
    const hookTriple = platform === 'darwin' && normalizedArchitecture
        ? `${normalizedArchitecture}-apple-darwin`
        : (['windows', 'win32'].includes(platform) && normalizedArchitecture
            ? `${normalizedArchitecture}-pc-windows-msvc`
            : null);
    const triple = explicitTarget(argv) || env.TAURI_ENV_TARGET_TRIPLE || hookTriple;
    if (!triple) {
        throw new Error(
            'A Tauri target triple is required. Pass --target <triple>, or invoke this command '
            + 'from Tauri beforeBuildCommand where TAURI_ENV_PLATFORM and TAURI_ENV_ARCH are set.',
        );
    }
    runtimeTargetForTauriTriple(triple);
    return triple;
}

export function hostCanRunTarget(
    triple,
    platform = process.platform,
    architecture = process.arch,
) {
    return hostCanRunRuntimeTarget(
        runtimeTargetForTauriTriple(triple),
        platform,
        architecture,
    );
}

function isSystemMacPath(path) {
    return path.startsWith('/usr/lib/') || path.startsWith('/System/Library/');
}

function macDependencies(output) {
    return output
        .split(/\r?\n/)
        .slice(1)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => line.replace(/\s+\(compatibility version.*$/, ''));
}

function macRpaths(output) {
    const lines = output.split(/\r?\n/).map((line) => line.trim());
    const rpaths = [];
    for (let index = 0; index < lines.length; index += 1) {
        if (lines[index] !== 'cmd LC_RPATH') continue;
        for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
            if (lines[cursor].startsWith('Load command ')) break;
            const match = lines[cursor].match(/^path (.+) \(offset \d+\)$/);
            if (match) {
                rpaths.push(match[1]);
                break;
            }
        }
    }
    return rpaths;
}

function macSystemVersionParts(version, label) {
    if (typeof version !== 'string' || !/^\d+(?:\.\d+){0,2}$/.test(version)) {
        throw new Error(`${label} is not a valid macOS system version: ${version ?? '<missing>'}`);
    }
    const parts = version.split('.').map(Number);
    while (parts.length < 3) parts.push(0);
    return parts;
}

function compareMacSystemVersions(left, right) {
    const leftParts = macSystemVersionParts(left, 'required minimum');
    const rightParts = macSystemVersionParts(right, 'declared minimum');
    for (let index = 0; index < leftParts.length; index += 1) {
        if (leftParts[index] !== rightParts[index]) {
            return leftParts[index] - rightParts[index];
        }
    }
    return 0;
}

export function macMinimumSystemVersionFromLoadCommands(loadCommands, label = 'Mach-O file') {
    const versions = loadCommands
        .split(/(?=^[ \t]*Load command \d+[ \t]*$)/m)
        .flatMap((block) => {
            const command = block.match(
                /^[ \t]*cmd[ \t]+(LC_BUILD_VERSION|LC_VERSION_MIN_MACOSX)[ \t]*$/m,
            )?.[1];
            if (command === 'LC_BUILD_VERSION') {
                return block.match(/^[ \t]*minos[ \t]+(\d+(?:\.\d+){0,2})[ \t]*$/m)?.[1] ?? [];
            }
            if (command === 'LC_VERSION_MIN_MACOSX') {
                return block.match(/^[ \t]*version[ \t]+(\d+(?:\.\d+){0,2})[ \t]*$/m)?.[1] ?? [];
            }
            return [];
        });
    if (versions.length === 0) {
        throw new Error(`${label} does not declare a macOS minimum system version`);
    }
    return versions.reduce((greatest, version) => (
        compareMacSystemVersions(version, greatest) > 0 ? version : greatest
    ));
}

export function assertMacMinimumSystemVersionCompatible(
    requiredMinimum,
    declaredMinimum,
    label = 'video runtime',
) {
    macSystemVersionParts(requiredMinimum, `${label} required minimum`);
    macSystemVersionParts(declaredMinimum, 'Tauri bundle minimumSystemVersion');
    if (compareMacSystemVersions(requiredMinimum, declaredMinimum) > 0) {
        throw new Error(
            `${label} requires macOS ${requiredMinimum}, but Tauri bundle declares ${declaredMinimum}`,
        );
    }
}

function macroSuffix(path, macro) {
    if (path === macro) return '';
    return path.startsWith(`${macro}/`) ? path.slice(macro.length + 1) : null;
}

function assertInsideRuntime(candidate, context, label, reference) {
    const pathFromRoot = relative(context.runtimeRoot, candidate);
    if (
        pathFromRoot === '..'
        || pathFromRoot.startsWith(`..${sep}`)
        || isAbsolute(pathFromRoot)
    ) {
        throw new Error(
            `${label} dependency escapes the runtime payload: ${reference} -> ${candidate}`,
        );
    }
    return candidate;
}

function macroCandidates(reference, macro, bases, context, label) {
    const suffix = macroSuffix(reference, macro);
    if (suffix === null) return null;
    return bases.map((base) => assertInsideRuntime(
        resolve(base, suffix),
        context,
        label,
        reference,
    ));
}

function assertDependencyPresent(candidates, context, label, reference) {
    const available = new Set(context.availableFiles.map((path) => resolve(path)));
    if (!candidates.some((path) => available.has(resolve(path)) || existsSync(path))) {
        throw new Error(`${label} has missing Mach-O dependency: ${reference}`);
    }
}

function validatedRpathBases(rpaths, context, label) {
    const bases = [];
    for (const rpath of rpaths) {
        if (isSystemMacPath(rpath)) {
            bases.push({ system: true, path: rpath });
            continue;
        }
        const loaderCandidates = macroCandidates(
            rpath,
            '@loader_path',
            [dirname(context.binaryPath)],
            context,
            label,
        );
        if (loaderCandidates) {
            bases.push(...loaderCandidates.map((path) => ({ system: false, path })));
            continue;
        }
        const executableCandidates = macroCandidates(
            rpath,
            '@executable_path',
            context.executablePaths.map(dirname),
            context,
            label,
        );
        if (executableCandidates) {
            bases.push(...executableCandidates.map((path) => ({ system: false, path })));
            continue;
        }
        throw new Error(`${label} has external Mach-O LC_RPATH: ${rpath}`);
    }
    return bases;
}

export function assertRelocatableMacDependencyMetadata(
    label,
    dependencies,
    loadCommands,
    context,
) {
    if (!context?.runtimeRoot || !context?.binaryPath || !Array.isArray(context.availableFiles)) {
        throw new Error(`${label} Mach-O dependency verification context is incomplete`);
    }
    const rpaths = macRpaths(loadCommands);
    const rpathBases = validatedRpathBases(rpaths, context, label);
    for (const dependency of macDependencies(dependencies)) {
        if (isSystemMacPath(dependency)) continue;

        const loaderCandidates = macroCandidates(
            dependency,
            '@loader_path',
            [dirname(context.binaryPath)],
            context,
            label,
        );
        if (loaderCandidates) {
            assertDependencyPresent(loaderCandidates, context, label, dependency);
            continue;
        }
        const executableCandidates = macroCandidates(
            dependency,
            '@executable_path',
            context.executablePaths.map(dirname),
            context,
            label,
        );
        if (executableCandidates) {
            assertDependencyPresent(executableCandidates, context, label, dependency);
            continue;
        }
        const rpathSuffix = macroSuffix(dependency, '@rpath');
        if (rpathSuffix !== null) {
            if (rpathSuffix.split('/').includes('..')) {
                throw new Error(`${label} dependency escapes the runtime payload: ${dependency}`);
            }
            const candidates = rpathBases
                .map((base) => (base.system
                    ? resolve(base.path, rpathSuffix)
                    : assertInsideRuntime(
                        resolve(base.path, rpathSuffix),
                        context,
                        label,
                        dependency,
                    )));
            const suffix = `${sep}${rpathSuffix.split('/').join(sep)}`;
            candidates.push(...context.availableFiles.filter((path) => path.endsWith(suffix)));
            assertDependencyPresent(candidates, context, label, dependency);
            continue;
        }
        throw new Error(`${label} has external Mach-O dependency: ${dependency}`);
    }
}

async function listTreeFiles(root) {
    const entries = await readdir(root, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
        const path = join(root, entry.name);
        if (entry.isDirectory()) files.push(...await listTreeFiles(path));
        else if (entry.isFile()) files.push(path);
    }
    return files;
}

async function verifyMacRuntimeDependencyClosure(root, declaredMinimumSystemVersion) {
    const availableFiles = await listTreeFiles(root);
    const executablePaths = [
        join(root, 'bin', 'ffmpeg'),
        join(root, 'bin', 'ffprobe'),
        join(root, 'backgroundremover', 'backgroundremover'),
    ].filter((path) => existsSync(path));
    let nativeFileCount = 0;
    let requiredMinimumSystemVersion = null;
    for (const path of availableFiles) {
        const native = await inspectNativeBinary(path);
        if (native.format !== 'mach-o') continue;
        nativeFileCount += 1;
        const [dependencies, loadCommands] = await Promise.all([
            execFileAsync('/usr/bin/otool', ['-L', path], { maxBuffer: 16 * 1024 * 1024 }),
            execFileAsync('/usr/bin/otool', ['-l', path], { maxBuffer: 16 * 1024 * 1024 }),
        ]);
        assertRelocatableMacDependencyMetadata(
            path.slice(root.length + 1),
            dependencies.stdout,
            loadCommands.stdout,
            {
                runtimeRoot: root,
                binaryPath: path,
                executablePaths,
                availableFiles,
            },
        );
        const label = path.slice(root.length + 1);
        const fileMinimumSystemVersion = macMinimumSystemVersionFromLoadCommands(
            loadCommands.stdout,
            label,
        );
        if (
            requiredMinimumSystemVersion === null
            || compareMacSystemVersions(
                fileMinimumSystemVersion,
                requiredMinimumSystemVersion,
            ) > 0
        ) {
            requiredMinimumSystemVersion = fileMinimumSystemVersion;
        }
    }
    if (nativeFileCount === 0) {
        throw new Error(`No Mach-O files found in macOS runtime payload: ${root}`);
    }
    assertMacMinimumSystemVersionCompatible(
        requiredMinimumSystemVersion,
        declaredMinimumSystemVersion,
        'Embedded video runtime',
    );
    return { nativeFileCount, requiredMinimumSystemVersion };
}

export async function verifySelfContainedVideoRuntime({
    appRoot = DEFAULT_APP_ROOT,
    triple,
    smoke = false,
    runtimeRoot,
    policyPath,
} = {}) {
    const runtimeTarget = runtimeTargetForTauriTriple(triple);
    const result = await verifyVideoRuntime({
        appRoot,
        target: runtimeTarget,
        runtimeRoot,
        policyPath,
        smoke,
    });
    let macVerification = null;
    if (process.platform === 'darwin' && runtimeTarget.startsWith('macos-')) {
        const tauriConfig = JSON.parse(await readFile(
            join(appRoot, 'src-tauri', 'tauri.conf.json'),
            'utf8',
        ));
        const declaredMinimumSystemVersion = tauriConfig.bundle?.macOS?.minimumSystemVersion;
        macVerification = await verifyMacRuntimeDependencyClosure(
            result.root,
            declaredMinimumSystemVersion,
        );
    }
    return {
        ...result,
        nativeDependencyCount: macVerification?.nativeFileCount ?? null,
        runtimeMinimumSystemVersion: macVerification?.requiredMinimumSystemVersion ?? null,
    };
}

export function macAppBundlePath(appRoot, triple, productName) {
    return join(
        appRoot,
        'src-tauri',
        'target',
        triple,
        'release',
        'bundle',
        'macos',
        `${productName}.app`,
    );
}

export function assertReleaseBuildArguments(argv) {
    if (argv.includes('--debug') || argv.includes('-d')) {
        throw new Error('Self-contained video package verification supports release builds only');
    }
}

async function tauriProductName(appRoot) {
    const config = JSON.parse(await readFile(
        join(appRoot, 'src-tauri', 'tauri.conf.json'),
        'utf8',
    ));
    if (typeof config.productName !== 'string' || !config.productName.trim()) {
        throw new Error('Tauri productName is required for packaged runtime verification');
    }
    return config.productName;
}

async function verifyMacAppBundle(appRoot, triple, smoke) {
    if (!triple.endsWith('-apple-darwin')) return null;
    const runtimeTarget = runtimeTargetForTauriTriple(triple);
    const productName = await tauriProductName(appRoot);
    const appBundle = macAppBundlePath(appRoot, triple, productName);
    const runtimeRoot = join(
        appBundle,
        'Contents',
        'Resources',
        'video-runtime',
        runtimeTarget,
    );
    const policyPath = join(dirname(runtimeRoot), 'source-policy.json');
    return verifySelfContainedVideoRuntime({ appRoot, triple, runtimeRoot, policyPath, smoke });
}

function spawnInherited(command, args, cwd, env = process.env) {
    return new Promise((resolveCommand, rejectCommand) => {
        const child = spawn(command, args, { cwd, env, stdio: 'inherit' });
        child.on('error', rejectCommand);
        child.on('exit', (code, signal) => {
            if (code === 0) resolveCommand();
            else rejectCommand(new Error(
                `${command} exited with ${signal ? `signal ${signal}` : `code ${code}`}`,
            ));
        });
    });
}

function stripBuildOnlyFlags(argv) {
    return argv.filter((token) => token !== '--smoke' && token !== '--no-smoke');
}

async function runBuild(argv) {
    assertReleaseBuildArguments(argv);
    const triple = resolveTauriTargetTriple(argv);
    const forceSmoke = argv.includes('--smoke');
    const disableSmoke = argv.includes('--no-smoke');
    const smoke = forceSmoke || (!disableSmoke && hostCanRunTarget(triple));
    await verifySelfContainedVideoRuntime({ triple, smoke });

    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    await rm(
        join(DEFAULT_APP_ROOT, 'src-tauri', 'target', triple, 'release', 'bundle'),
        { recursive: true, force: true },
    );
    await spawnInherited(
        npm,
        ['run', 'tauri', '--', 'build', ...stripBuildOnlyFlags(argv)],
        DEFAULT_APP_ROOT,
    );
    await verifyMacAppBundle(DEFAULT_APP_ROOT, triple, smoke);
}

async function runVerify(argv) {
    const triple = resolveTauriTargetTriple(argv);
    const smoke = argv.includes('--smoke')
        || (!argv.includes('--no-smoke') && hostCanRunTarget(triple));
    const result = await verifySelfContainedVideoRuntime({ triple, smoke });
    process.stdout.write(`Verified self-contained video runtime: ${result.target}\n`);
}

async function main(argv) {
    const [command = 'verify', ...rest] = argv;
    if (command === 'build') return runBuild(rest);
    if (command === 'verify') return runVerify(rest);
    throw new Error(`Unknown self-contained video build command: ${command}`);
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
    main(process.argv.slice(2)).catch((error) => {
        process.stderr.write(`${error.message}\n`);
        process.exitCode = 1;
    });
}
