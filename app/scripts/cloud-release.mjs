import { cp, mkdir, readdir, readFile, writeFile, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { prepareUpdaterRelease } from './prepare-updater-release.mjs';
import { transformModuleIndex, transformCockroachModuleIndex, DEFAULT_CNB_REPO } from './prepare-cnb-release.mjs';
import { INDEX_NAMES, assertUpdater, verifySignature } from './release-integrity.mjs';
import { githubJson, download } from './github-public.mjs';
const appRoot = resolve(import.meta.dirname, '..');
const config = JSON.parse(await readFile(join(appRoot, 'src-tauri/tauri.conf.json')));
const version = config.version;
const command = process.argv[2];
const output = resolve(process.argv[3] ?? 'release-stage');
if (command === 'stage') {
    const target = process.env.RELEASE_TARGET;
    const platform = process.env.RELEASE_PLATFORM;
    const bundle = join(appRoot, 'src-tauri/target', target, 'release/bundle');
    // Build already produced detached signatures. Do not sign a second time.
    delete process.env.TAURI_SIGNING_PRIVATE_KEY;
    delete process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD;
    const staged = await prepareUpdaterRelease({ bundleDir: join(bundle, platform.startsWith('darwin') ? 'macos' : 'nsis'), platform, outDir: output });
    const assets = join(output, 'assets');
    await cp(staged.artifactOutDir, assets, { recursive: true });
    await cp(staged.latestJsonPath, join(output, 'latest.json'));
    if (platform.startsWith('darwin')) {
        const dmgs = (await readdir(join(bundle, 'dmg'))).filter(name => name.endsWith('.dmg'));
        if (dmgs.length !== 1) throw new Error('Expected exactly one DMG');
        await cp(join(bundle, 'dmg', dmgs[0]), join(assets, `CPA_V2_${version}_${platform === 'darwin-aarch64' ? 'arm64' : 'x64'}.dmg`));
    }
    await rm(join(output, 'stable'), { recursive: true, force: true });
} else if (command === 'assemble') {
    const input = resolve(process.argv[4]);
    await mkdir(output, { recursive: true });
    const platforms = {};
    for (const dir of await readdir(input)) {
        const root = join(input, dir);
        const manifest = JSON.parse(await readFile(join(root, 'latest.json')));
        if (manifest.version !== version) throw new Error('Mismatched build version');
        for (const [key, entry] of Object.entries(manifest.platforms)) {
            if (platforms[key]) throw new Error('Duplicate build platform');
            platforms[key] = entry;
        }
        for (const name of await readdir(join(root, 'assets'))) {
            await cp(join(root, 'assets', name), join(output, name), { errorOnExist: true, force: false });
        }
    }
    const latest = { version, notes: `CPA_V2 ${version}`, pub_date: new Date().toISOString(), platforms };
    assertUpdater(latest, await readdir(output));
    for (const entry of Object.values(platforms)) {
        const name = new URL(entry.url).pathname.split('/').at(-1);
        if ((await readFile(join(output, `${name}.sig`), 'utf8')).trim() !== entry.signature) throw new Error('Signature file mismatch');
        await verifySignature(join(output, name), entry.signature, config.plugins.updater.pubkey);
    }
    await writeFile(join(output, 'latest.json'), JSON.stringify(latest, null, 2)+'\n');
    // Preserve the last published extension versions; do not rebuild their large runtimes.
    const previous = await githubJson('/repos/UnityX103/CPA_V2/releases/latest');
    for (const name of INDEX_NAMES) {
        for (const filename of [name, `${name}.sig`]) {
            const asset = previous.assets.find(a => a.name === filename);
            if (!asset) throw new Error(`Previous release is missing ${filename}`);
            await download(asset.browser_download_url, join(output, filename), asset);
        }
        await verifySignature(join(output, name), await readFile(join(output, `${name}.sig`), 'utf8'), config.plugins.updater.pubkey);
        const index = JSON.parse(await readFile(join(output, name)));
        const transform = name.startsWith('video-') ? transformModuleIndex : transformCockroachModuleIndex;
        const variant = join(output, name.replace('.json', '.cnb.json'));
        await writeFile(variant, JSON.stringify(transform(index, { repo: DEFAULT_CNB_REPO }), null, 2)+'\n');
        execFileSync(join(appRoot, 'node_modules/.bin/tauri'), ['signer', 'sign', variant], { stdio: 'pipe' });
        await verifySignature(variant, await readFile(`${variant}.sig`, 'utf8'), config.plugins.updater.pubkey);
    }
    console.log(`Assembled and verified ${version}`);
} else throw new Error('Expected stage or assemble');
