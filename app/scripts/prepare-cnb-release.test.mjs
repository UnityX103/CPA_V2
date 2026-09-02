import { describe, expect, it } from 'vitest';
import {
    cnbLatestAssetUrl,
    cnbTaggedAssetUrl,
    transformCockroachModuleIndex,
    transformModuleIndex,
    transformUpdaterManifest,
} from './prepare-cnb-release.mjs';

const repo = 'nanzhaigame-xpy/CPA_V2';
const tag = 'v0.1.23';

describe('CNB release manifest preparation', () => {
    it('rewrites updater artifacts while preserving signatures', () => {
        const result = transformUpdaterManifest(
            {
                version: '0.1.23',
                platforms: {
                    'darwin-aarch64': {
                        signature: 'signed-arm',
                        url: 'https://github.com/UnityX103/CPA_V2/releases/download/v0.1.23/app-aarch64.tar.gz',
                    },
                },
            },
            { repo, tag },
        );
        expect(result.platforms['darwin-aarch64']).toEqual({
            signature: 'signed-arm',
            url: 'https://cnb.cool/nanzhaigame-xpy/CPA_V2/-/releases/download/v0.1.23/app-aarch64.tar.gz',
        });
    });

    it('rewrites module packages without changing hashes or sizes', () => {
        const result = transformModuleIndex(
            {
                version: '1.1.0-noncommercial.1',
                packages: {
                    'windows-x86_64': {
                        url: 'https://github.com/UnityX103/CPA_V2/releases/download/v0.1.23/video.zip',
                        sha256: 'a'.repeat(64),
                        size: 42,
                    },
                },
            },
            { repo, tag },
        );
        expect(result.packages['windows-x86_64']).toEqual({
            url: 'https://cnb.cool/nanzhaigame-xpy/CPA_V2/-/releases/download/v0.1.23/video.zip',
            mirrors: ['https://github.com/UnityX103/CPA_V2/releases/download/v0.1.23/video.zip'],
            sha256: 'a'.repeat(64),
            size: 42,
        });
    });

    it('rewrites every layered module component and keeps GitHub as a mirror', () => {
        const artifact = (name, marker, releaseTag = 'v0.1.23') => ({
            version: '1.0.0',
            url: `https://github.com/UnityX103/CPA_V2/releases/download/${releaseTag}/${name}.zip`,
            sha256: marker.repeat(64),
            size: 42,
        });
        const result = transformModuleIndex(
            {
                schemaVersion: 2,
                version: '1.3.0',
                logic: { ...artifact('logic', 'a'), version: '1.3.0' },
                models: artifact('models', 'b'),
                engines: {
                    'macos-arm64': artifact('engine-arm64', 'c', 'v0.1.22'),
                    'macos-x86_64': artifact('engine-x64', 'd'),
                    'windows-x86_64': artifact('engine-windows', 'e'),
                },
            },
            { repo, tag },
        );
        for (const entry of [result.logic, result.models, ...Object.values(result.engines)]) {
            expect(entry.url).toMatch(/^https:\/\/cnb\.cool\//);
            expect(entry.mirrors).toHaveLength(1);
            expect(entry.mirrors[0]).toMatch(/^https:\/\/github\.com\//);
        }
        expect(result.logic.version).toBe('1.3.0');
        expect(result.models.version).toBe('1.0.0');
        expect(result.engines['macos-arm64'].url).toContain('/download/v0.1.22/');
    });

    it('rewrites layered cockroach runtime and logic components with GitHub mirrors', () => {
        const artifact = (name, marker, releaseTag = 'v0.1.24') => ({
            version: name === 'logic' ? '1.1.0-noncommercial.1' : '40.8.0',
            runtimeAbi: 'cpa-cockroach-electron-40-control-v1',
            manifestSha256: marker.repeat(64),
            url: `https://github.com/UnityX103/CPA_V2/releases/download/${releaseTag}/cockroach-${name}.zip`,
            sha256: marker.repeat(64),
            size: 42,
        });
        const result = transformCockroachModuleIndex(
            {
                schemaVersion: 2,
                version: '1.1.0-noncommercial.1',
                distribution: 'noncommercial-open-source',
                logic: { ...artifact('logic', 'a', 'v0.1.25'), dependencySet: 'cockroach-js-test' },
                dependencies: {
                    ...artifact('dependencies', 'e'),
                    dependencySet: 'cockroach-js-test',
                },
                runtimes: {
                    'macos-arm64': artifact('runtime-arm64', 'b'),
                    'macos-x86_64': artifact('runtime-x64', 'c'),
                    'windows-x86_64': artifact('runtime-windows', 'd'),
                },
            },
            { repo, tag: 'v0.1.25' },
        );
        for (const entry of [result.logic, result.dependencies, ...Object.values(result.runtimes)]) {
            expect(entry.url).toMatch(/^https:\/\/cnb\.cool\//);
            expect(entry.mirrors[0]).toMatch(/^https:\/\/github\.com\//);
        }
        expect(result.runtimes['macos-arm64'].url).toContain('/download/v0.1.24/');
        expect(result.distribution).toBe('noncommercial-open-source');
    });

    it('provides stable tagged and latest URLs', () => {
        expect(cnbTaggedAssetUrl(repo, tag, 'latest.json')).toContain('/download/v0.1.23/latest.json');
        expect(cnbLatestAssetUrl(repo, 'latest.json')).toBe(
            'https://cnb.cool/nanzhaigame-xpy/CPA_V2/-/releases/latest/download/latest.json',
        );
    });

    it('rejects an updater manifest from a different version', () => {
        expect(() => transformUpdaterManifest({ version: '0.1.22', platforms: {} }, { repo, tag })).toThrow(
            /does not match/,
        );
    });
});
