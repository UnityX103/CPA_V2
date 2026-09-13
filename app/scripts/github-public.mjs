import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { hashes, githubAsset } from './release-integrity.mjs';

// Deliberately no Authorization header, even when CNB_TOKEN exists in the process.
export async function githubJson(path) {
    if (!path.startsWith('/repos/UnityX103/CPA_V2/')) throw new Error('Unexpected GitHub API path');
    const response = await fetch(`https://api.github.com${path}`, {
        headers: { accept: 'application/vnd.github+json', 'user-agent': 'CPA-V2-public-mirror' },
        signal: AbortSignal.timeout(60000),
    });
    if (!response.ok) throw new Error(`GitHub public API HTTP ${response.status}; retry on next scheduled run`);
    return response.json();
}
export async function download(url, path, expected = {}) {
    githubAsset(url);
    const response = await fetch(url, { signal: AbortSignal.timeout(30 * 60 * 1000) });
    if (!response.ok) throw new Error(`Public asset download HTTP ${response.status}`);
    await pipeline(Readable.fromWeb(response.body), createWriteStream(path, { flags: 'wx' }));
    const actual = await hashes(path);
    const digest = expected.sha256 ?? expected.digest?.replace(/^sha256:/, '');
    if ((expected.size != null && actual.size !== expected.size) || (digest && digest !== actual.hashes.sha256)) throw new Error('Downloaded asset integrity mismatch');
    return actual;
}
