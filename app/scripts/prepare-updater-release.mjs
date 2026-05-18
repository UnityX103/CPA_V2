import { cp, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_APP_ROOT = resolve(SCRIPT_DIR, '..');
const DEFAULT_BASE_URL = 'https://github.com/UnityX103/CPA_V2/releases/download';
const DEFAULT_CHANNEL = 'stable';

function resolveFromAppRoot(appRoot, path) {
    return isAbsolute(path) ? path : resolve(appRoot, path);
}

function normalizeBaseUrl(url) {
    return url.replace(/\/+$/, '');
}

function urlJoin(...parts) {
    const [first, ...rest] = parts;
    return [
        normalizeBaseUrl(first),
        ...rest.map((part) => encodeURIComponent(part).replace(/%2F/g, '/')),
    ].join('/');
}

function isGithubReleaseDownloadBase(url) {
    return /github\.com\/[^/]+\/[^/]+\/releases\/download$/i.test(normalizeBaseUrl(url));
}

function artifactUrl(baseUrl, channel, version, artifactName) {
    if (isGithubReleaseDownloadBase(baseUrl)) {
        return urlJoin(baseUrl, `v${version}`, artifactName);
    }
    return urlJoin(baseUrl, channel, version, artifactName);
}

async function readJson(path) {
    return JSON.parse(await readFile(path, 'utf8'));
}

function platformArch() {
    if (process.arch === 'arm64') return 'aarch64';
    if (process.arch === 'x64') return 'x86_64';
    if (process.arch === 'ia32') return 'i686';
    if (process.arch === 'arm') return 'armv7';
    return process.arch;
}

function platformOsFromArtifact(path) {
    const normalized = path.split(sep).join('/').toLowerCase();
    if (normalized.includes('/macos/') || normalized.includes('/dmg/') || normalized.endsWith('.app.tar.gz')) {
        return 'darwin';
    }
    if (
        normalized.includes('/nsis/') ||
        normalized.includes('/msi/') ||
        normalized.endsWith('.msi.zip') ||
        normalized.endsWith('.nsis.zip') ||
        normalized.endsWith('.exe') ||
        normalized.endsWith('.msi')
    ) {
        return 'windows';
    }
    if (
        normalized.includes('/appimage/') ||
        normalized.includes('/deb/') ||
        normalized.includes('/rpm/') ||
        normalized.endsWith('.appimage.tar.gz')
    ) {
        return 'linux';
    }
    return null;
}

function inferPlatform(artifactPath, forcedPlatform) {
    if (forcedPlatform) return forcedPlatform;
    const os = platformOsFromArtifact(artifactPath);
    if (!os) {
        throw new Error(`Cannot infer updater platform for ${artifactPath}; pass --platform OS-ARCH`);
    }
    return `${os}-${platformArch()}`;
}

async function listSignatureFiles(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    const found = [];
    for (const entry of entries) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
            found.push(...await listSignatureFiles(path));
        } else if (entry.isFile() && entry.name.endsWith('.sig')) {
            found.push(path);
        }
    }
    return found.sort();
}

async function copyIfExists(from, to) {
    if (!existsSync(from)) return;
    await mkdir(dirname(to), { recursive: true });
    await cp(from, to);
}

async function assertVersion(appRoot, versionOverride) {
    const packageJson = await readJson(join(appRoot, 'package.json'));
    const tauriConfig = await readJson(join(appRoot, 'src-tauri', 'tauri.conf.json'));
    const packageVersion = packageJson.version;
    const tauriVersion = tauriConfig.version;
    const version = versionOverride ?? packageVersion;

    if (!version) throw new Error('Missing package version');
    if (packageVersion !== tauriVersion) {
        throw new Error(`Version mismatch: package.json=${packageVersion}, tauri.conf.json=${tauriVersion}`);
    }
    if (versionOverride && versionOverride !== packageVersion) {
        throw new Error(`Version mismatch: requested=${versionOverride}, package.json=${packageVersion}`);
    }
    return version;
}

export async function prepareUpdaterRelease(options = {}) {
    const appRoot = resolve(options.appRoot ?? DEFAULT_APP_ROOT);
    const channel = options.channel ?? DEFAULT_CHANNEL;
    const baseUrl = normalizeBaseUrl(options.baseUrl ?? DEFAULT_BASE_URL);
    const version = await assertVersion(appRoot, options.version);
    const bundleDir = resolveFromAppRoot(
        appRoot,
        options.bundleDir ?? 'src-tauri/target/release/bundle',
    );
    const outDir = resolveFromAppRoot(appRoot, options.outDir ?? 'release-updates');
    const artifactOutDir = join(outDir, channel, version);
    const latestJsonPath = join(outDir, channel, 'latest.json');
    const notes = options.notes ?? '';
    const pubDate = options.pubDate ?? new Date().toISOString();

    const bundleInfo = await stat(bundleDir).catch(() => null);
    if (!bundleInfo?.isDirectory()) {
        throw new Error(`Bundle directory not found: ${bundleDir}`);
    }

    const sigFiles = await listSignatureFiles(bundleDir);
    if (sigFiles.length === 0) {
        throw new Error(`No signed updater artifacts found in ${bundleDir}`);
    }

    const platforms = {};
    for (const sigPath of sigFiles) {
        const artifactPath = sigPath.slice(0, -'.sig'.length);
        if (!existsSync(artifactPath)) {
            throw new Error(`Signature has no matching artifact: ${sigPath}`);
        }
        const platform = inferPlatform(artifactPath, options.platform);
        if (platforms[platform]) {
            throw new Error(`Duplicate updater artifact for ${platform}`);
        }

        const artifactName = basename(artifactPath);
        const signatureName = basename(sigPath);
        const targetArtifact = join(artifactOutDir, artifactName);
        const targetSignature = join(artifactOutDir, signatureName);
        const signature = (await readFile(sigPath, 'utf8')).trim();

        await copyIfExists(artifactPath, targetArtifact);
        await copyIfExists(sigPath, targetSignature);

        platforms[platform] = {
            signature,
            url: artifactUrl(baseUrl, channel, version, artifactName),
        };
    }

    await mkdir(dirname(latestJsonPath), { recursive: true });
    const latest = { version, notes, pub_date: pubDate, platforms };
    await writeFile(latestJsonPath, `${JSON.stringify(latest, null, 2)}\n`);

    return {
        latestJsonPath,
        artifactOutDir,
        platforms,
        copiedArtifacts: Object.keys(platforms).length,
    };
}

function parseArgs(argv) {
    const options = {};
    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        const readValue = () => {
            const value = argv[i + 1];
            if (!value || value.startsWith('--')) throw new Error(`Missing value for ${arg}`);
            i += 1;
            return value;
        };

        if (arg === '--app-root') options.appRoot = readValue();
        else if (arg === '--base-url') options.baseUrl = readValue();
        else if (arg === '--bundle-dir') options.bundleDir = readValue();
        else if (arg === '--channel') options.channel = readValue();
        else if (arg === '--notes') options.notes = readValue();
        else if (arg === '--out-dir') options.outDir = readValue();
        else if (arg === '--platform') options.platform = readValue();
        else if (arg === '--pub-date') options.pubDate = readValue();
        else if (arg === '--version') options.version = readValue();
        else if (arg === '--help' || arg === '-h') options.help = true;
        else throw new Error(`Unknown option: ${arg}`);
    }
    return options;
}

function usage() {
    return [
        'Usage: npm run release:updater -- --base-url https://updates.example.com/cpa [options]',
        '',
        'Options:',
        '  --base-url URL       Public base URL that will host the channel folder',
        '  --bundle-dir PATH    Tauri bundle directory (default: src-tauri/target/release/bundle)',
        '  --channel NAME       Release channel (default: stable)',
        '  --notes TEXT         Release notes written into latest.json',
        '  --out-dir PATH       Output directory (default: release-updates)',
        '  --platform OS-ARCH   Force platform key, e.g. darwin-aarch64',
        '  --version VERSION    Assert and publish this version',
    ].join('\n');
}

if (fileURLToPath(import.meta.url) === resolve(process.argv[1] ?? '')) {
    try {
        const options = parseArgs(process.argv.slice(2));
        if (options.help) {
            console.log(usage());
        } else {
            const result = await prepareUpdaterRelease(options);
            console.log(`Wrote ${relative(process.cwd(), result.latestJsonPath)}`);
            console.log(`Copied ${result.copiedArtifacts} updater artifact(s) to ${relative(process.cwd(), result.artifactOutDir)}`);
            for (const [platform, entry] of Object.entries(result.platforms)) {
                console.log(`${platform}: ${entry.url}`);
            }
        }
    } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        process.exitCode = 1;
    }
}
