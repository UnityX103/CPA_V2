import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { Transform } from 'node:stream';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { DEFAULT_CNB_REPO } from './prepare-cnb-release.mjs';

const execFileAsync = promisify(execFile);
const PROGRESS_BYTES = 64 * 1024 * 1024;

export function parseCnbEnvelope(stdout, context, allowedStatuses = []) {
    let envelope;
    try {
        envelope = JSON.parse(stdout);
    } catch {
        throw new Error(`${context} returned invalid JSON`);
    }
    const status = Number(envelope.status);
    if ((!Number.isInteger(status) || status < 200 || status >= 300) && !allowedStatuses.includes(status)) {
        const message = envelope.data?.errmsg ?? envelope.data?.message ?? `HTTP ${envelope.status}`;
        throw new Error(`${context} failed: ${message}`);
    }
    return envelope;
}

export function orderedAssetPaths(paths) {
    const unique = new Map();
    for (const path of paths.map((value) => resolve(value))) {
        const name = basename(path);
        if (unique.has(name)) throw new Error(`Duplicate release asset name: ${name}`);
        unique.set(name, path);
    }
    const priority = (name) => {
        if (name === 'latest.json') return 100;
        if (name.endsWith('-module-index.json')) return 90;
        if (name.endsWith('-module-index.json.sig')) return 80;
        return 10;
    };
    return [...unique.values()].sort((left, right) => {
        const difference = priority(basename(left)) - priority(basename(right));
        return difference || basename(left).localeCompare(basename(right));
    });
}

export function parseVerificationUrl(value) {
    const url = new URL(value);
    const marker = '/asset-upload-confirmation/';
    const offset = url.pathname.indexOf(marker);
    if (offset < 0) throw new Error('CNB upload verification URL is invalid');
    const segments = url.pathname.slice(offset + marker.length).split('/');
    const uploadToken = decodeURIComponent(segments.shift() ?? '');
    const assetPath = segments.map(decodeURIComponent).join('/');
    if (!uploadToken || !assetPath) throw new Error('CNB upload verification URL is incomplete');
    return { uploadToken, assetPath };
}

async function runCnb(args, context, allowedStatuses = []) {
    let stdout = '';
    try {
        ({ stdout } = await execFileAsync('cnb', [...args, '--verbose'], {
            maxBuffer: 8 * 1024 * 1024,
            env: process.env,
        }));
    } catch (error) {
        stdout = error?.stdout ?? '';
        if (!stdout) throw new Error(`${context} failed: ${error?.message ?? error}`);
    }
    return parseCnbEnvelope(stdout, context, allowedStatuses);
}

async function getRelease(repo, tag) {
    const envelope = await runCnb(
        ['releases', 'get-release-by-tag', '--repo', repo, '--tag', tag],
        `Read CNB release ${tag}`,
        [404],
    );
    return Number(envelope.status) === 404 ? null : envelope.data;
}

export function cnbApiUrl(repo, suffix) {
    const encodedRepo = repo.split('/').map(encodeURIComponent).join('/');
    return `https://api.cnb.cool/${encodedRepo}/-/releases${suffix}`;
}

async function requestCnbApi(method, url, body, context) {
    const token = process.env.CNB_TOKEN;
    if (!token) throw new Error(`${context} requires CNB_TOKEN`);
    const response = await fetch(url, {
        method,
        headers: {
            accept: 'application/vnd.cnb.api+json',
            authorization: `Bearer ${token}`,
            'content-type': 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    if (!response.ok) {
        throw new Error(`${context} failed: HTTP ${response.status} ${text.slice(0, 500)}`);
    }
    return text ? JSON.parse(text) : null;
}

async function ensureRelease({ repo, tag, target, title, notesFile }) {
    const existing = await getRelease(repo, tag);
    if (existing) return existing;
    const body = await readFile(notesFile, 'utf8');
    const created = await requestCnbApi(
        'POST',
        cnbApiUrl(repo, ''),
        {
            body,
            draft: true,
            make_latest: 'false',
            name: title,
            prerelease: false,
            tag_name: tag,
            target_commitish: target,
        },
        `Create CNB release ${tag}`,
    );
    return created ?? await getRelease(repo, tag);
}

function progressTransform(name, size, hashes) {
    let uploaded = 0;
    let announced = 0;
    return new Transform({
        transform(chunk, _encoding, callback) {
            uploaded += chunk.length;
            hashes.forEach((hash) => hash.update(chunk));
            if (uploaded - announced >= PROGRESS_BYTES || uploaded === size) {
                announced = uploaded;
                console.log(`Uploading ${name}: ${uploaded}/${size}`);
            }
            callback(null, chunk);
        },
    });
}

async function uploadAsset({ repo, releaseId, path }) {
    const name = basename(path);
    const info = await stat(path);
    if (!info.isFile() || info.size <= 0) throw new Error(`Release asset is invalid: ${path}`);
    const upload = await runCnb(
        [
            'releases',
            'post-release-asset-upload-url',
            '--repo',
            repo,
            '--release-id',
            releaseId,
            '--asset-name',
            name,
            '--size',
            String(info.size),
            '--ttl',
            '0',
            '--overwrite',
        ],
        `Create upload URL for ${name}`,
    );
    const { upload_url: uploadUrl, verify_url: verifyUrl } = upload.data ?? {};
    if (!uploadUrl || !verifyUrl) throw new Error(`CNB did not return upload URLs for ${name}`);

    const sha256 = createHash('sha256');
    const md5 = createHash('md5');
    const source = createReadStream(path);
    const body = source.pipe(progressTransform(name, info.size, [sha256, md5]));
    const response = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'content-length': String(info.size) },
        body,
        duplex: 'half',
    });
    if (!response.ok) {
        const detail = (await response.text()).slice(0, 500);
        throw new Error(`Upload ${name} failed: HTTP ${response.status} ${detail}`);
    }
    const hashes = { sha256: sha256.digest('hex'), md5: md5.digest('hex') };
    const verification = parseVerificationUrl(verifyUrl);
    await runCnb(
        [
            'releases',
            'post-release-asset-upload-confirmation',
            '--repo',
            repo,
            '--release-id',
            releaseId,
            '--upload-token',
            verification.uploadToken,
            '--asset-path',
            verification.assetPath,
            '--ttl',
            '0',
        ],
        `Confirm upload for ${name}`,
    );
    return { name, size: info.size, hashes };
}

function verifyUploadedAsset(release, expected) {
    const asset = release.assets?.find((candidate) => candidate.name === expected.name);
    if (!asset) throw new Error(`CNB release is missing ${expected.name}`);
    if (Number(asset.size) !== expected.size) {
        throw new Error(`CNB release size mismatch for ${expected.name}`);
    }
    const algorithm = String(asset.hash_algo ?? '').toLowerCase().replace('-', '');
    const remoteHash = String(asset.hash_value ?? '').toLowerCase();
    if (remoteHash && expected.hashes[algorithm] && remoteHash !== expected.hashes[algorithm]) {
        throw new Error(`CNB release hash mismatch for ${expected.name}`);
    }
}

export async function publishCnbRelease(repo, releaseId, title, notesFile) {
    const body = await readFile(notesFile, 'utf8');
    await requestCnbApi(
        'PATCH',
        cnbApiUrl(repo, `/${encodeURIComponent(releaseId)}`),
        {
            body,
            draft: false,
            make_latest: 'true',
            name: title,
            prerelease: false,
        },
        `Publish CNB release ${releaseId}`,
    );
}

export async function syncCnbRelease({
    repo = DEFAULT_CNB_REPO,
    tag,
    target,
    title,
    notesFile,
    assets,
}) {
    const release = await ensureRelease({ repo, tag, target, title, notesFile });
    if (!release?.id) throw new Error('CNB release has no id');
    for (const path of orderedAssetPaths(assets)) {
        const uploaded = await uploadAsset({ repo, releaseId: release.id, path });
        const refreshed = await getRelease(repo, tag);
        verifyUploadedAsset(refreshed, uploaded);
        console.log(`Verified ${uploaded.name}`);
    }
    await publishCnbRelease(repo, release.id, title, notesFile);
    return `https://cnb.cool/${repo}/-/releases/tag/${tag}`;
}

function parseArgs(argv) {
    const options = { repo: DEFAULT_CNB_REPO, assets: [] };
    for (let index = 0; index < argv.length; index += 1) {
        const argument = argv[index];
        const next = () => {
            const value = argv[index + 1];
            if (!value || value.startsWith('--')) throw new Error(`Missing value for ${argument}`);
            index += 1;
            return value;
        };
        if (argument === '--repo') options.repo = next();
        else if (argument === '--tag') options.tag = next();
        else if (argument === '--target') options.target = next();
        else if (argument === '--title') options.title = next();
        else if (argument === '--notes-file') options.notesFile = next();
        else if (argument === '--asset') options.assets.push(next());
        else throw new Error(`Unknown option: ${argument}`);
    }
    for (const required of ['tag', 'target', 'title', 'notesFile']) {
        if (!options[required]) throw new Error(`Missing required option: ${required}`);
    }
    if (options.assets.length === 0) throw new Error('At least one --asset is required');
    return options;
}

if (fileURLToPath(import.meta.url) === resolve(process.argv[1] ?? '')) {
    try {
        const url = await syncCnbRelease(parseArgs(process.argv.slice(2)));
        console.log(`Published ${url}`);
    } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
    }
}
