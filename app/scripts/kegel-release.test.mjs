// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { assertExtensionIndexAssets } from './release-integrity.mjs';
import { transformSignedModuleIndex } from './prepare-cnb-release.mjs';
import { validateRelease } from './mirror-github-release.mjs';
import { assertKegelReleaseTarget, planMissingKegelAssets } from './kegel-cloud-release.mjs';

const index = {
    schemaVersion: 1, id: 'wellness.kegel', version: '1.0.0',
    runtimeAbi: 'cpa-webview-break-activity-v1', distribution: 'project-owned',
    url: 'https://github.com/UnityX103/CPA_V2/releases/download/v0.2.9/kegel-module-1.0.0.zip',
    mirrors: [], size: 123, sha256: 'a'.repeat(64), manifestSha256: 'b'.repeat(64),
};

describe('Kegel release discovery and mirror contract', () => {
    it('keeps legacy mirror compatibility while requiring Kegel for hosts starting at 0.2.9', () => {
        const names = ['latest.json', 'video-editor-module-index.json', 'video-editor-module-index.json.sig',
            'cockroach-module-index.json', 'cockroach-module-index.json.sig'];
        const release = tag => ({ tag_name: tag, draft: false, prerelease: false, assets: names.map(name => ({
            name, size: 1, state: 'uploaded', browser_download_url: `https://github.com/UnityX103/CPA_V2/releases/download/${tag}/${name}`,
        })) });
        expect(() => validateRelease(release('v0.2.8'))).not.toThrow();
        expect(() => validateRelease(release('v0.2.9'))).toThrow('kegel-module-index.json');
    });
    it('rejects the published inventory that caused client installation to return 404', () => {
        const old = ['video-editor-module-index', 'cockroach-module-index'].flatMap(name =>
            [name + '.json', name + '.json.sig', name + '.cnb.json', name + '.cnb.json.sig']);
        expect(() => assertExtensionIndexAssets(old)).toThrow('kegel-module-index.json');
        expect(() => assertExtensionIndexAssets([...old,
            'kegel-module-index.json', 'kegel-module-index.json.sig',
            'kegel-module-index.cnb.json', 'kegel-module-index.cnb.json.sig',
        ])).not.toThrow();
    });

    it('prepares a CNB-first signed-index variant with an exact GitHub fallback', () => {
        const result = transformSignedModuleIndex('kegel-module-index.json', index, { repo: 'nanzhaigame-xpy/CPA_V2' });
        expect(result.url).toBe('https://cnb.cool/nanzhaigame-xpy/CPA_V2/-/releases/download/v0.2.9/kegel-module-1.0.0.zip');
        expect(result.mirrors).toEqual([index.url]);
        expect(result.sha256).toBe(index.sha256);
        expect(result.manifestSha256).toBe(index.manifestSha256);
        expect(index.mirrors).toEqual([]);
    });

    it.each([
        { id: 'unknown.feature' }, { runtimeAbi: 'wrong' }, { schemaVersion: 2 },
        { distribution: 'unknown' }, { size: 0 }, { sha256: 'invalid' },
        { url: 'https://github.com/other/repo/releases/download/v0.2.9/kegel-module-1.0.0.zip' },
    ])('rejects incompatible or unapproved index metadata: %j', changed => {
        expect(() => transformSignedModuleIndex('kegel-module-index.json', { ...index, ...changed },
            { repo: 'nanzhaigame-xpy/CPA_V2' })).toThrow();
    });
});

describe('supplementing a published release without replacing public bytes', () => {
    const entry = { name: 'kegel-module-1.0.0.zip', size: 10, sha256: 'a'.repeat(64) };
    it('adds the missing module while preserving unrelated existing installers', () => {
        expect(planMissingKegelAssets({ assets: [{ name: 'app.tar.gz', size: 9 }] }, [entry])).toEqual([entry]);
        const existing = { ...entry, state: 'uploaded', digest: 'sha256:' + entry.sha256 };
        expect(planMissingKegelAssets({ assets: [existing] }, [entry])).toEqual([]);
        expect(() => planMissingKegelAssets({ assets: [{ ...existing, digest: 'sha256:' + 'b'.repeat(64) }] }, [entry])).toThrow('Refusing to overwrite');
    });
    it('allows resuming with an existing verified signature, and rejects an unverified one', () => {
        const sig = { name: 'kegel-module-index.json.sig', size: 416, sha256: 'a'.repeat(64) };
        const release = { assets: [{ name: sig.name, size: 420, state: 'uploaded', digest: 'sha256:' + 'b'.repeat(64) }] };
        expect(() => planMissingKegelAssets(release, [sig])).toThrow();
        expect(planMissingKegelAssets(release, [sig], [sig.name])).toEqual([]);
    });
    it('rejects a stale, draft or prerelease host instead of silently updating another version', () => {
        const release = { tag_name: 'v0.2.9', draft: false, prerelease: false };
        expect(() => assertKegelReleaseTarget(release, release, 'v0.2.9')).not.toThrow();
        expect(() => assertKegelReleaseTarget(release, { ...release, tag_name: 'v0.2.10' }, 'v0.2.9')).toThrow();
        expect(() => assertKegelReleaseTarget({ ...release, draft: true }, release, 'v0.2.9')).toThrow();
        expect(() => assertKegelReleaseTarget({ ...release, prerelease: true }, release, 'v0.2.9')).toThrow();
    });
});
