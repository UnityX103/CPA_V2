import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { GITHUB_REPO, hashes, verifySignature } from './release-integrity.mjs';
import { download } from './github-public.mjs';
import { cnbTaggedAssetUrl, DEFAULT_CNB_REPO, transformSignedModuleIndex } from './prepare-cnb-release.mjs';

const name = 'kegel-module-index.json';
const appRoot = resolve(import.meta.dirname, '..');

export function planMissingKegelAssets(release, entries, verifiedSignatures = []) {
    return entries.filter(entry => {
        const existing = release.assets.find(asset => asset.name === entry.name);
        if (!existing) return true;
        if (existing.state !== 'uploaded') throw new Error(`Incomplete existing asset: ${entry.name}`);
        if (verifiedSignatures.includes(entry.name)) return false;
        if (existing.size !== entry.size || existing.digest !== `sha256:${entry.sha256}`) {
            throw new Error(`Refusing to overwrite published asset: ${entry.name}`);
        }
        return false;
    });
}

export function assertKegelReleaseTarget(release, latest, tag) {
    if (!/^v\d+\.\d+\.\d+$/.test(tag) || release.tag_name !== tag || latest.tag_name !== tag
        || release.draft || release.prerelease) throw new Error('Kegel assets must supplement the current published app release');
}

async function packageInfo(directory, tag) {
    const info = JSON.parse(await readFile(join(directory, 'build-info.json')));
    const index = JSON.parse(await readFile(join(directory, name)));
    transformSignedModuleIndex(name, index, { repo: DEFAULT_CNB_REPO });
    if (info.archive !== `kegel-module-${index.version}.zip`
        || index.url !== `https://github.com/${GITHUB_REPO}/releases/download/${tag}/${info.archive}`
        || info.id !== index.id || info.version !== index.version || info.runtimeAbi !== index.runtimeAbi
        || info.manifestSha256 !== index.manifestSha256
        || JSON.stringify(info.targets) !== JSON.stringify(['macos-arm64', 'macos-x86_64', 'windows-x86_64'])) {
        throw new Error('Kegel package/index/host target mismatch');
    }
    const actual = await hashes(join(directory, info.archive));
    if (actual.size !== index.size || actual.hashes.sha256 !== index.sha256
        || info.sha256 !== index.sha256 || info.size !== index.size) throw new Error('Kegel archive integrity mismatch');
    return { info, index };
}

async function publicKey() {
    return JSON.parse(await readFile(join(appRoot, 'src-tauri/tauri.conf.json'))).plugins.updater.pubkey;
}

async function prepare(directory, tag) {
    if (!process.env.TAURI_SIGNING_PRIVATE_KEY) throw new Error('Missing existing updater signing key');
    const { info, index } = await packageInfo(directory, tag);
    index.mirrors = [cnbTaggedAssetUrl(DEFAULT_CNB_REPO, tag, info.archive)];
    const variant = name.replace('.json', '.cnb.json');
    await writeFile(join(directory, name), JSON.stringify(index, null, 2) + '\n');
    await writeFile(join(directory, variant), JSON.stringify(transformSignedModuleIndex(name, index, { repo: DEFAULT_CNB_REPO }), null, 2) + '\n');
    for (const file of [name, variant]) {
        try { execFileSync(process.execPath, [join(appRoot, 'node_modules/@tauri-apps/cli/tauri.js'), 'signer', 'sign', join(directory, file)], { stdio: 'pipe' }); }
        catch { throw new Error('Kegel signing failed; check encrypted updater Secrets'); }
        await verifySignature(join(directory, file), await readFile(join(directory, `${file}.sig`), 'utf8'), await publicKey());
    }
    console.log(`Prepared signed Kegel ${index.version} for ${tag}, supporting all three host targets`);
}

async function githubApi(suffix) {
    if (!process.env.GH_TOKEN) throw new Error('GH_TOKEN is required for GitHub publishing');
    const response = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/${suffix}`, {
        headers: { authorization: `Bearer ${process.env.GH_TOKEN}`, accept: 'application/vnd.github+json' },
        redirect: 'error', signal: AbortSignal.timeout(60000),
    });
    if (!response.ok) throw new Error(`GitHub release API HTTP ${response.status}`);
    return response.json();
}

async function publish(directory, tag) {
    if (process.env.GITHUB_REF !== 'refs/heads/main') throw new Error('Publish Kegel from trusted main only');
    const { info, index } = await packageInfo(directory, tag);
    const release = await githubApi(`tags/${tag}`), latest = await githubApi('latest');
    assertKegelReleaseTarget(release, latest, tag);
    const variant = name.replace('.json', '.cnb.json');
    const expected = transformSignedModuleIndex(name, index, { repo: DEFAULT_CNB_REPO });
    if (!isDeepStrictEqual(JSON.parse(await readFile(join(directory, variant))), expected)) throw new Error('CNB variant mismatch');
    const key = await publicKey();
    for (const file of [name, variant]) await verifySignature(join(directory, file), await readFile(join(directory, `${file}.sig`), 'utf8'), key);
    // Packages precede signatures; the client-visible index is published last.
    const order = [info.archive, `${variant}.sig`, variant, `${name}.sig`, name];
    const entries = await Promise.all(order.map(async file => {
        const actual = await hashes(join(directory, file));
        return { name: file, size: actual.size, sha256: actual.hashes.sha256 };
    }));
    const work = await mkdtemp(join(tmpdir(), 'kegel-public-verify-'));
    try {
        const verified = [];
        // A rerun may create a signature with a newer trusted timestamp. Reuse
        // an existing valid signature instead of replacing public bytes.
        for (const file of [`${name}.sig`, `${variant}.sig`]) {
            const asset = release.assets.find(item => item.name === file);
            if (!asset) continue;
            await download(asset.browser_download_url, join(work, file), asset);
            await verifySignature(join(directory, file.slice(0, -4)), await readFile(join(work, file), 'utf8'), key);
            verified.push(file);
        }
        const missing = planMissingKegelAssets(release, entries, verified);
        for (const entry of missing) {
            execFileSync('gh', ['release', 'upload', tag, join(directory, entry.name), '--repo', GITHUB_REPO], { stdio: 'pipe' });
            console.log(`Uploaded missing Kegel asset: ${entry.name}`);
        }
        const online = await githubApi(`tags/${tag}`);
        for (const file of order) {
            const asset = online.assets.find(item => item.name === file);
            if (!asset?.digest?.startsWith('sha256:')) throw new Error(`Missing public asset digest: ${file}`);
            await rm(join(work, file), { force: true });
            await download(asset.browser_download_url, join(work, file), asset);
            if (!file.endsWith('.sig') && asset.digest !== `sha256:${entries.find(entry => entry.name === file).sha256}`) throw new Error(`Public asset mismatch: ${file}`);
        }
        for (const file of [name, variant]) await verifySignature(join(work, file), await readFile(join(work, `${file}.sig`), 'utf8'), key);
        console.log(`Published and verified Kegel ${index.version} on ${tag}; existing app assets preserved`);
    } finally { await rm(work, { recursive: true, force: true }); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const [command, path, tag] = process.argv.slice(2);
    try {
        if (!path || !/^v\d+\.\d+\.\d+$/.test(tag ?? '')) throw new Error('Expected output directory and exact app release tag');
        if (command === 'prepare') await prepare(resolve(path), tag);
        else if (command === 'publish') await publish(resolve(path), tag);
        else throw new Error('Expected prepare or publish');
    } catch (error) { console.error(error.message); process.exitCode = 1; }
}
