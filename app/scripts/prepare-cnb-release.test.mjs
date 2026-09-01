import { describe, expect, it } from 'vitest';
import {
    cnbLatestAssetUrl,
    cnbTaggedAssetUrl,
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
