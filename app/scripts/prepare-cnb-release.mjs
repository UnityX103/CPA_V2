import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_CNB_REPO = 'nanzhaigame-xpy/CPA_V2';

function assertSafeRepo(repo) {
    if (!/^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)+$/.test(repo)) {
        throw new Error(`Invalid CNB repository slug: ${repo}`);
    }
}

function assertSafeTag(tag) {
    if (!/^v[A-Za-z0-9][A-Za-z0-9._+-]*$/.test(tag)) {
        throw new Error(`Invalid release tag: ${tag}`);
    }
}

function assetNameFromUrl(value) {
    const url = new URL(value);
    const name = decodeURIComponent(url.pathname.split('/').at(-1) ?? '');
    if (!name || basename(name) !== name) {
        throw new Error(`Invalid release asset URL: ${value}`);
    }
    return name;
}

function releaseTagFromUrl(value) {
    const url = new URL(value);
    const segments = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    const download = segments.lastIndexOf('download');
    const tag = download >= 0 ? segments[download + 1] : undefined;
    assertSafeTag(tag ?? '');
    return tag;
}

export function cnbTaggedAssetUrl(repo, tag, assetName) {
    assertSafeRepo(repo);
    assertSafeTag(tag);
    if (!assetName || basename(assetName) !== assetName) {
        throw new Error(`Invalid release asset name: ${assetName}`);
    }
    return `https://cnb.cool/${repo}/-/releases/download/${tag}/${encodeURIComponent(assetName)}`;
}

export function cnbLatestAssetUrl(repo, assetName) {
    assertSafeRepo(repo);
    if (!assetName || basename(assetName) !== assetName) {
        throw new Error(`Invalid release asset name: ${assetName}`);
    }
    return `https://cnb.cool/${repo}/-/releases/latest/download/${encodeURIComponent(assetName)}`;
}

export function transformUpdaterManifest(manifest, { repo, tag }) {
    if (tag !== `v${manifest.version}`) {
        throw new Error(`Updater version ${manifest.version} does not match ${tag}`);
    }
    const platforms = Object.fromEntries(
        Object.entries(manifest.platforms ?? {}).map(([platform, entry]) => {
            if (!entry?.url || !entry?.signature) {
                throw new Error(`Incomplete updater entry: ${platform}`);
            }
            return [
                platform,
                {
                    ...entry,
                    url: cnbTaggedAssetUrl(repo, tag, assetNameFromUrl(entry.url)),
                },
            ];
        }),
    );
    if (Object.keys(platforms).length === 0) {
        throw new Error('Updater manifest has no platforms');
    }
    return { ...manifest, platforms };
}

function transformReleaseArtifact(entry, label, { repo }) {
    if (!entry?.url || !entry?.sha256 || !entry?.size) {
        throw new Error(`Incomplete module package: ${label}`);
    }
    const mirrors = [entry.url, ...(entry.mirrors ?? [])].filter(
        (url, position, values) => url && values.indexOf(url) === position,
    );
    return {
        ...entry,
        url: cnbTaggedAssetUrl(repo, releaseTagFromUrl(entry.url), assetNameFromUrl(entry.url)),
        mirrors,
    };
}

export function transformModuleIndex(index, options) {
    if (index.schemaVersion === 2) {
        if (!index.logic || !index.models) {
            throw new Error('Layered video module index is missing logic or models');
        }
        const engines = Object.fromEntries(
            Object.entries(index.engines ?? {}).map(([target, entry]) => [
                target,
                transformReleaseArtifact(entry, `video engine ${target}`, options),
            ]),
        );
        if (Object.keys(engines).length === 0) {
            throw new Error('Layered video module index has no engines');
        }
        return {
            ...index,
            logic: transformReleaseArtifact(index.logic, 'video logic', options),
            models: transformReleaseArtifact(index.models, 'video models', options),
            engines,
        };
    }
    const packages = Object.fromEntries(
        Object.entries(index.packages ?? {}).map(([target, entry]) => {
            return [target, transformReleaseArtifact(entry, `video ${target}`, options)];
        }),
    );
    if (Object.keys(packages).length === 0) {
        throw new Error('Video module index has no packages');
    }
    return { ...index, packages };
}

export function transformCockroachModuleIndex(index, options) {
    if (
        index.schemaVersion !== 2
        || index.distribution !== 'noncommercial-open-source'
        || !index.logic
        || !index.dependencies
    ) {
        throw new Error('Layered cockroach module index is incomplete or not noncommercial');
    }
    const runtimes = Object.fromEntries(
        Object.entries(index.runtimes ?? {}).map(([target, entry]) => [
            target,
            transformReleaseArtifact(entry, `cockroach runtime ${target}`, options),
        ]),
    );
    const requiredTargets = ['macos-arm64', 'macos-x86_64', 'windows-x86_64'];
    const missingTargets = requiredTargets.filter((target) => !runtimes[target]);
    if (missingTargets.length > 0) {
        throw new Error(`Layered cockroach module index is missing runtimes: ${missingTargets.join(', ')}`);
    }
    return {
        ...index,
        logic: transformReleaseArtifact(index.logic, 'cockroach logic', options),
        dependencies: transformReleaseArtifact(index.dependencies, 'cockroach dependencies', options),
        runtimes,
    };
}

export async function prepareCnbRelease({
    updaterManifestPath,
    moduleIndexPath,
    cockroachModuleIndexPath,
    outputDirectory,
    repo = DEFAULT_CNB_REPO,
    tag,
}) {
    if (!cockroachModuleIndexPath) {
        throw new Error('Missing required option: cockroachModuleIndexPath');
    }
    const [updaterManifest, moduleIndex, cockroachModuleIndex] = await Promise.all([
        readFile(updaterManifestPath, 'utf8').then(JSON.parse),
        readFile(moduleIndexPath, 'utf8').then(JSON.parse),
        readFile(cockroachModuleIndexPath, 'utf8').then(JSON.parse),
    ]);
    const output = resolve(outputDirectory);
    await mkdir(output, { recursive: true });
    const latestPath = resolve(output, 'latest.json');
    const mirroredModuleIndexPath = resolve(output, 'video-editor-module-index.json');
    const mirroredCockroachModuleIndexPath = resolve(output, 'cockroach-module-index.json');
    await Promise.all([
        writeFile(
            latestPath,
            `${JSON.stringify(transformUpdaterManifest(updaterManifest, { repo, tag }), null, 2)}\n`,
        ),
        writeFile(
            mirroredModuleIndexPath,
            `${JSON.stringify(transformModuleIndex(moduleIndex, { repo, tag }), null, 2)}\n`,
        ),
    ]);
    await writeFile(
        mirroredCockroachModuleIndexPath,
        `${JSON.stringify(transformCockroachModuleIndex(cockroachModuleIndex, { repo, tag }), null, 2)}\n`,
    );
    return {
        latestPath,
        moduleIndexPath: mirroredModuleIndexPath,
        cockroachModuleIndexPath: mirroredCockroachModuleIndexPath,
    };
}

function parseArgs(argv) {
    const options = { repo: DEFAULT_CNB_REPO };
    for (let index = 0; index < argv.length; index += 1) {
        const argument = argv[index];
        const next = () => {
            const value = argv[index + 1];
            if (!value || value.startsWith('--')) throw new Error(`Missing value for ${argument}`);
            index += 1;
            return value;
        };
        if (argument === '--latest') options.updaterManifestPath = next();
        else if (argument === '--module-index') options.moduleIndexPath = next();
        else if (argument === '--cockroach-module-index') options.cockroachModuleIndexPath = next();
        else if (argument === '--out-dir') options.outputDirectory = next();
        else if (argument === '--repo') options.repo = next();
        else if (argument === '--tag') options.tag = next();
        else throw new Error(`Unknown option: ${argument}`);
    }
    for (const required of [
        'updaterManifestPath',
        'moduleIndexPath',
        'cockroachModuleIndexPath',
        'outputDirectory',
        'tag',
    ]) {
        if (!options[required]) throw new Error(`Missing required option: ${required}`);
    }
    return options;
}

if (fileURLToPath(import.meta.url) === resolve(process.argv[1] ?? '')) {
    try {
        const result = await prepareCnbRelease(parseArgs(process.argv.slice(2)));
        console.log(`Wrote ${result.latestPath}`);
        console.log(`Wrote ${result.moduleIndexPath}`);
        if (result.cockroachModuleIndexPath) {
            console.log(`Wrote ${result.cockroachModuleIndexPath}`);
        }
        console.log('Sign every generated module index before publishing it to CNB.');
    } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
    }
}
