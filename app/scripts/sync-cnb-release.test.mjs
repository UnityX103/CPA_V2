import { describe, expect, it } from 'vitest';
import {
    cnbApiUrl,
    orderedAssetPaths,
    parseCnbEnvelope,
    parseVerificationUrl,
} from './sync-cnb-release.mjs';

describe('CNB release synchronization', () => {
    it('uploads signed indexes after packages and latest.json last', () => {
        const result = orderedAssetPaths([
            '/tmp/latest.json',
            '/tmp/video-editor-module-index.json',
            '/tmp/module.zip',
            '/tmp/video-editor-module-index.json.sig',
        ]).map((path) => path.split('/').at(-1));
        expect(result).toEqual([
            'module.zip',
            'video-editor-module-index.json.sig',
            'video-editor-module-index.json',
            'latest.json',
        ]);
    });

    it('extracts upload confirmation parameters without leaking the upload URL', () => {
        expect(
            parseVerificationUrl(
                'https://api.cnb.cool/org/repo/-/releases/id/asset-upload-confirmation/token123/folder%2Fasset.zip',
            ),
        ).toEqual({ uploadToken: 'token123', assetPath: 'folder/asset.zip' });
    });

    it('rejects API error envelopes even when the CLI exits successfully', () => {
        expect(() =>
            parseCnbEnvelope(
                JSON.stringify({ status: 403, data: { errmsg: 'missing scope' } }),
                'Create repository',
            ),
        ).toThrow(/missing scope/);
    });

    it('returns successful API data', () => {
        expect(parseCnbEnvelope(JSON.stringify({ status: 201, data: { id: 'release' } }), 'Create release').data).toEqual(
            { id: 'release' },
        );
    });

    it('builds the official CNB release OpenAPI URL', () => {
        expect(cnbApiUrl('nanzhaigame-xpy/CPA_V2', '/release-id')).toBe(
            'https://api.cnb.cool/nanzhaigame-xpy/CPA_V2/-/releases/release-id',
        );
    });
});
