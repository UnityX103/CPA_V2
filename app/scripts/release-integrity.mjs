import { createHash, createPublicKey, verify } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';

export const GITHUB_REPO = 'UnityX103/CPA_V2';
export const INDEX_NAMES = ['video-editor-module-index.json', 'cockroach-module-index.json'];
export function safeAssetName(name) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._+-]*$/.test(name)) throw new Error('Unsafe asset name');
    return name;
}
export function githubAsset(value) {
    const url = new URL(value);
    const match = url.pathname.match(/^\/UnityX103\/CPA_V2\/releases\/download\/(v[A-Za-z0-9._+-]+)\/([^/]+)$/);
    if (url.origin !== 'https://github.com' || url.search || url.hash || !match) throw new Error('Unexpected GitHub asset URL');
    return { tag: match[1], name: safeAssetName(decodeURIComponent(match[2])) };
}
export async function hashes(path) {
    const sha256 = createHash('sha256');
    const md5 = createHash('md5');
    let size = 0;
    for await (const chunk of createReadStream(path)) { size += chunk.length; sha256.update(chunk); md5.update(chunk); }
    return { size, hashes: { sha256: sha256.digest('hex'), md5: md5.digest('hex') } };
}
export async function verifySignature(path, signature, publicKey) {
    const key = Buffer.from(Buffer.from(publicKey.trim(), 'base64').toString().trim().split('\n')[1], 'base64');
    const lines = Buffer.from(signature.trim(), 'base64').toString().trim().split('\n');
    const packet = Buffer.from(lines[1] ?? '', 'base64');
    if (key.length !== 42 || packet.length !== 74 || !key.subarray(2, 10).equals(packet.subarray(2, 10))) throw new Error('Invalid signing key or signature');
    const algorithm = packet.subarray(0, 2).toString();
    let payload;
    if (algorithm === 'ED') {
        const hash = createHash('blake2b512');
        for await (const chunk of createReadStream(path)) hash.update(chunk);
        payload = hash.digest();
    } else if (algorithm === 'Ed') payload = await readFile(path);
    else throw new Error('Unknown signature algorithm');
    const pem = createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), key.subarray(10)]), format: 'der', type: 'spki' });
    const sig = packet.subarray(10);
    const comment = lines[2];
    if (!comment?.startsWith('trusted comment: ') || !verify(null, payload, pem, sig)
        || !verify(null, Buffer.concat([sig, Buffer.from(comment.slice(17))]), pem, Buffer.from(lines[3] ?? '', 'base64'))) {
        throw new Error('Release signature verification failed');
    }
}
export function moduleComponents(index) {
    const found = [];
    function visit(value) {
        if (!value || typeof value !== 'object') return;
        if (value.url && value.sha256 && value.size) { githubAsset(value.url); found.push(value); return; }
        for (const item of Object.values(value)) visit(item);
    }
    visit(index);
    return found;
}
export function assertUpdater(manifest, names) {
    const expected = {
        'darwin-x86_64': 'app.tar.gz', 'darwin-aarch64': 'app-aarch64.tar.gz',
        'windows-x86_64-nsis': `CPA_V2_${manifest.version}_x64-setup.exe`,
        'windows-x86_64': `CPA_V2_${manifest.version}_x64-setup.exe`,
    };
    for (const [key, name] of Object.entries(expected)) {
        const entry = manifest.platforms?.[key];
        if (!entry?.signature || entry.url !== `https://github.com/${GITHUB_REPO}/releases/download/v${manifest.version}/${name}`
            || !names.includes(name) || !names.includes(`${name}.sig`)) throw new Error(`Incomplete updater platform: ${key}`);
    }
    for (const arch of ['x64', 'arm64']) if (!names.includes(`CPA_V2_${manifest.version}_${arch}.dmg`)) throw new Error(`Missing ${arch} DMG`);
}
