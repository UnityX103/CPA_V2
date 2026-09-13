import { mkdtemp, mkdir, readFile, writeFile, rm, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath } from 'node:url';
import { githubJson, download } from './github-public.mjs';
import { GITHUB_REPO, INDEX_NAMES, safeAssetName, githubAsset, hashes, verifySignature, moduleComponents, assertUpdater } from './release-integrity.mjs';
import { DEFAULT_CNB_REPO, cnbTaggedAssetUrl, transformUpdaterManifest, transformModuleIndex, transformCockroachModuleIndex } from './prepare-cnb-release.mjs';
import { getRelease, ensureRelease, uploadAsset, verifyUploadedAsset, publishCnbRelease, orderedAssetPaths } from './sync-cnb-release.mjs';
const exec = promisify(execFile);
const RECEIPT = 'github-mirror-receipt.json';
export function releaseFingerprint(release) {
    return createHash('sha256').update(JSON.stringify({ id: release.id, tag: release.tag_name, body: release.body, name: release.name,
        assets: release.assets.map(a => [a.id, a.name, a.size, a.digest, a.updated_at]).sort((a,b) => a[1].localeCompare(b[1])) })).digest('hex');
}
export function validateRelease(release) {
    if (release.draft || release.prerelease || !/^v\d+\.\d+\.\d+$/.test(release.tag_name)) throw new Error('Expected a published stable app release');
    const seen = new Set();
    for (const asset of release.assets) {
        safeAssetName(asset.name);
        const address = githubAsset(asset.browser_download_url);
        if (seen.has(asset.name) || asset.name === RECEIPT || address.name !== asset.name || address.tag !== release.tag_name || asset.state !== 'uploaded' || asset.size <= 0) throw new Error('Invalid release asset inventory');
        seen.add(asset.name);
    }
    if (!seen.has('latest.json')) throw new Error('Release has no updater manifest');
}
async function publicCnbText(repo, tag, name) {
    const response = await fetch(cnbTaggedAssetUrl(repo, tag, name), { signal: AbortSignal.timeout(60000) });
    if (!response.ok) { await response.body?.cancel(); return null; }
    return response.text();
}
async function importTag(tag, work, repo) {
    const cwd = join(work, 'git');
    await mkdir(cwd, { recursive: true });
    // Public GitHub fetch never uses a credential helper or CNB's environment token.
    const cleanEnv = { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_GLOBAL: '/dev/null' };
    delete cleanEnv.CNB_TOKEN;
    delete cleanEnv.GH_TOKEN;
    delete cleanEnv.GITHUB_TOKEN;
    await exec('git', ['init', '--bare', cwd], { env: cleanEnv });
    await exec('git', ['-c','credential.helper=','fetch',`https://github.com/${GITHUB_REPO}.git`, `refs/tags/${tag}:refs/tags/${tag}`], { cwd, env: cleanEnv });
    const { stdout } = await exec('git', ['rev-parse', `${tag}^{commit}`], { cwd, env: cleanEnv });
    // CNB needs tag/source objects to create releases. No main-branch overwrite.
    const askpass = join(work, 'askpass.sh');
    await writeFile(askpass, '#!/bin/sh\ncase "$1" in *Username*) printf "%s" cnb ;; *) printf "%s" "$CNB_TOKEN" ;; esac\n', { mode: 0o700 });
    try {
        await exec('git', ['-c','credential.helper=','push',`https://cnb.cool/${repo}.git`, `refs/tags/${tag}:refs/tags/${tag}`], {
            cwd, env: { ...cleanEnv, CNB_TOKEN: process.env.CNB_TOKEN, GIT_ASKPASS: askpass },
        });
    } catch { throw new Error('CNB tag import failed (check temporary token permissions or tag conflict)'); }
    return stdout.trim();
}
async function uploadVerified(repo, tag, releaseId, path) {
    const expected = { name: path.split('/').at(-1), ...await hashes(path) };
    const existing = await getRelease(repo, tag);
    try { verifyUploadedAsset(existing, expected); return; } catch { /* upload only missing/mismatched bytes */ }
    await uploadAsset({ repo, releaseId, path });
    verifyUploadedAsset(await getRelease(repo, tag), expected);
}
async function latestRelease() {
    const upstream = await githubJson(`/repos/${GITHUB_REPO}/releases/latest`);
    // Release asset listing is paginated separately, to include more than 30 assets.
    upstream.assets = [];
    for (let page=1; ; page++) {
        const assets = await githubJson(`/repos/${GITHUB_REPO}/releases/${upstream.id}/assets?per_page=100&page=${page}`);
        upstream.assets.push(...assets);
        if (assets.length < 100) break;
    }
    validateRelease(upstream);
    return upstream;
}
export async function mirrorLatest({ dryRun = false, repo = DEFAULT_CNB_REPO } = {}) {
    if (repo !== DEFAULT_CNB_REPO) throw new Error('Mirror target is fixed');
    const upstream = await latestRelease();
    const fingerprint = releaseFingerprint(upstream);
    const receiptText = await publicCnbText(repo, upstream.tag_name, RECEIPT);
    if (receiptText) {
        try {
            const receipt = JSON.parse(receiptText);
            const latestResponse = await fetch(`https://cnb.cool/${repo}/-/releases/latest/download/${RECEIPT}`, { signal: AbortSignal.timeout(60000) });
            if (latestResponse.ok && receipt.fingerprint === fingerprint && (await latestResponse.json()).fingerprint === fingerprint) {
                console.log(`Already mirrored ${upstream.tag_name}`); return;
            }
            await latestResponse.body?.cancel().catch(()=>{});
        } catch { /* incomplete receipt is never success */ }
    }
    console.log(`${dryRun ? 'Plan' : 'Mirror'} ${upstream.tag_name}: ${upstream.assets.length} GitHub assets, ${upstream.assets.reduce((n,a)=>n+a.size,0)} bytes`);
    if (dryRun) { console.log('Anonymous GitHub access verified; no remote changes made. Dependencies are discovered during synchronization.'); return; }
    if (!process.env.CNB_TOKEN) throw new Error('CNB_TOKEN is required for writing the CNB mirror only');
    const work = await mkdtemp(join(tmpdir(), 'cpa-mirror-'));
    const stage = join(work, 'assets');
    await mkdir(stage);
    try {
        const config = JSON.parse(await readFile(new URL('../src-tauri/tauri.conf.json', import.meta.url)));
        const key = config.plugins.updater.pubkey;
        for (const asset of upstream.assets) await download(asset.browser_download_url, join(stage, asset.name), asset);
        const manifest = JSON.parse(await readFile(join(stage, 'latest.json')));
        if (`v${manifest.version}` !== upstream.tag_name) throw new Error('Tag/updater mismatch');
        assertUpdater(manifest, upstream.assets.map(a=>a.name));
        for (const entry of Object.values(manifest.platforms)) {
            const { name } = githubAsset(entry.url);
            if ((await readFile(join(stage, `${name}.sig`), 'utf8')).trim() !== entry.signature) throw new Error('Updater signature mismatch');
            await verifySignature(join(stage, name), entry.signature, key);
        }
        const dependencies = new Map();
        for (const name of INDEX_NAMES) {
            const path = join(stage, name);
            const index = JSON.parse(await readFile(path));
            await verifySignature(path, await readFile(`${path}.sig`, 'utf8'), key);
            for (const component of moduleComponents(index)) dependencies.set(component.url, component);
            const transform = name.startsWith('video-') ? transformModuleIndex : transformCockroachModuleIndex;
            const expected = transform(index, { repo });
            const variant = join(stage, name.replace('.json', '.cnb.json'));
            // Legacy releases have no pre-signed variant; reuse a verified existing CNB index only.
            if (!upstream.assets.some(a => a.name === name.replace('.json', '.cnb.json'))) {
                const [old, sig] = await Promise.all([publicCnbText(repo, upstream.tag_name, name), publicCnbText(repo, upstream.tag_name, `${name}.sig`)]);
                if (!old || !sig) throw new Error(`Missing pre-signed CNB index for ${name}; publish using the new GitHub workflow`);
                await writeFile(variant, old); await writeFile(`${variant}.sig`, sig);
            }
            await verifySignature(variant, await readFile(`${variant}.sig`, 'utf8'), key);
            if (!isDeepStrictEqual(JSON.parse(await readFile(variant)), expected)) throw new Error('CNB signed variant does not match the GitHub index');
            await cp(variant, path); await cp(`${variant}.sig`, `${path}.sig`);
        }
        const notesFile = join(work, 'notes.md');
        await writeFile(notesFile, upstream.body ?? '');
        // Complete referenced older-tag packages before exposing the new index.
        for (const [url, component] of dependencies) {
            const { tag, name } = githubAsset(url);
            const old = await getRelease(repo, tag);
            const asset = old?.assets?.find(a => a.name === name);
            if (asset && Number(asset.size) === component.size && String(asset.hash_algo).toLowerCase().replace('-', '') === 'sha256' && asset.hash_value === component.sha256) continue;
            const dir = join(work, tag); await mkdir(dir, { recursive: true });
            const path = join(dir, name);
            await download(url, path, component);
            const target = old ? undefined : await importTag(tag, work, repo);
            const release = old ?? await ensureRelease({ repo, tag, target, title: tag, notesFile });
            await uploadVerified(repo, tag, release.id, path);
            if (release.draft) await publishCnbRelease(repo, release.id, release.name ?? tag, notesFile, false);
            await rm(path);
        }
        const target = await importTag(upstream.tag_name, work, repo);
        const release = await ensureRelease({ repo, tag: upstream.tag_name, target, title: upstream.name ?? upstream.tag_name, notesFile });
        await writeFile(join(stage, 'latest.json'), JSON.stringify(transformUpdaterManifest(manifest, { repo, tag: upstream.tag_name }), null, 2)+'\n');
        const paths = upstream.assets.map(a=>join(stage,a.name));
        for (const path of orderedAssetPaths(paths)) await uploadVerified(repo, upstream.tag_name, release.id, path);
        const current = await latestRelease();
        if (releaseFingerprint(current) !== fingerprint) throw new Error('GitHub Latest changed while copying; next run will retry');
        await publishCnbRelease(repo, release.id, upstream.name ?? upstream.tag_name, notesFile);
        const online = await publicCnbText(repo, upstream.tag_name, 'latest.json');
        if (!online || !isDeepStrictEqual(JSON.parse(online), transformUpdaterManifest(manifest, { repo, tag: upstream.tag_name }))) throw new Error('Public CNB updater verification failed');
        const receiptPath = join(work, RECEIPT);
        await writeFile(receiptPath, JSON.stringify({ githubReleaseId: upstream.id, tag: upstream.tag_name, fingerprint, synchronizedAt: new Date().toISOString() })+'\n');
        await uploadVerified(repo, upstream.tag_name, release.id, receiptPath);
        console.log(`Mirrored ${upstream.tag_name}; all assets and referenced extension packages verified`);
    } finally { await rm(work, { recursive: true, force: true }); }
}
if (fileURLToPath(import.meta.url) === resolve(process.argv[1] ?? '')) {
    if (process.argv.slice(2).some(a=>a!=='--dry-run')) throw new Error('Only --dry-run is supported');
    mirrorLatest({ dryRun: process.argv.includes('--dry-run') }).catch(error => { console.error(error.message); process.exitCode=1; });
}
