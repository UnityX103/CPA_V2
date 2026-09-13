// @vitest-environment node
import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateKeyPairSync, randomBytes, sign, createHash } from 'node:crypto';
import { verifySignature, githubAsset, assertUpdater } from './release-integrity.mjs';
import { githubJson } from './github-public.mjs';
import { validateRelease, releaseFingerprint } from './mirror-github-release.mjs';
import { requestCnbApi, getRelease, uploadAsset, verifyUploadedAsset } from './sync-cnb-release.mjs';

afterEach(()=>{vi.unstubAllGlobals(); vi.unstubAllEnvs();});
function signed(data) {
    const { publicKey, privateKey }=generateKeyPairSync('ed25519');
    const id=randomBytes(8);
    const pub=Buffer.concat([Buffer.from('Ed'),id,publicKey.export({type:'spki',format:'der'}).subarray(-32)]);
    const signature=sign(null,createHash('blake2b512').update(data).digest(),privateKey);
    const packet=Buffer.concat([Buffer.from('ED'),id,signature]);
    const comment='timestamp:123\tfile:test';
    const global=sign(null,Buffer.concat([signature,Buffer.from(comment)]),privateKey);
    return { key:Buffer.from(`untrusted comment: public key\n${pub.toString('base64')}\n`).toString('base64'),
        sig:Buffer.from(`untrusted comment: signature\n${packet.toString('base64')}\ntrusted comment: ${comment}\n${global.toString('base64')}\n`).toString('base64') };
}
describe('cloud release trust boundaries',()=>{
    it('verifies a signed file and rejects tampered bytes, wrong key and trusted comment',async()=>{
        const dir=await mkdtemp(join(tmpdir(),'release-test-')); const path=join(dir,'asset');
        try {
            await writeFile(path,'original'); const s=signed('original');
            await verifySignature(path,s.sig,s.key);
            await expect(verifySignature(path,s.sig,signed('original').key)).rejects.toThrow();
            const changed=Buffer.from(Buffer.from(s.sig,'base64').toString().replace('timestamp:123','timestamp:999')).toString('base64');
            await expect(verifySignature(path,changed,s.key)).rejects.toThrow();
            await writeFile(path,'tampered'); await expect(verifySignature(path,s.sig,s.key)).rejects.toThrow();
        } finally {await rm(dir,{recursive:true,force:true});}
    });
    it('never sends environment credentials to public GitHub',async()=>{
        vi.stubEnv('CNB_TOKEN','secret-cnb'); vi.stubEnv('GH_TOKEN','secret-gh');
        const fetch=vi.fn().mockResolvedValue(new Response('{}')); vi.stubGlobal('fetch',fetch);
        await githubJson('/repos/UnityX103/CPA_V2/releases/latest');
        expect(fetch.mock.calls[0][1].headers).not.toHaveProperty('authorization');
        expect(JSON.stringify(fetch.mock.calls)).not.toContain('secret-');
    });
    it('limits GitHub URLs to this repository and rejects path traversal',()=>{
        expect(githubAsset('https://github.com/UnityX103/CPA_V2/releases/download/v1.2.3/app.tar.gz')).toEqual({tag:'v1.2.3',name:'app.tar.gz'});
        for(const url of ['https://evil.test/UnityX103/CPA_V2/releases/download/v1/a.zip','https://github.com/other/repo/releases/download/v1/a.zip','https://github.com/UnityX103/CPA_V2/releases/download/v1/%2e%2e%2ffile']) expect(()=>githubAsset(url)).toThrow();
    });
    it('detects changed assets in an existing upstream version',()=>{
        const r={id:1,tag_name:'v1.0.0',assets:[{id:2,name:'latest.json',size:10,updated_at:'a'}]};
        expect(releaseFingerprint(r)).not.toBe(releaseFingerprint({...r,assets:[{...r.assets[0],updated_at:'b'}]}));
        expect(()=>validateRelease({...r,draft:true})).toThrow();
        expect(()=>assertUpdater({version:'1.0.0',platforms:{}},[])).toThrow();
    });
    it('does not transmit a CNB token to another origin or follow API redirects',async()=>{
        vi.stubEnv('CNB_TOKEN','secret-cnb'); const fetch=vi.fn(); vi.stubGlobal('fetch',fetch);
        await expect(requestCnbApi('GET','https://evil.test',undefined,'test')).rejects.toThrow();
        expect(fetch).not.toHaveBeenCalled();
        fetch.mockResolvedValue(new Response('{}'));
        await getRelease('nanzhaigame-xpy/CPA_V2','v1.0.0');
        expect(fetch.mock.calls[0][1].redirect).toBe('error');
    });
    it('requires a matching remote digest, not just size',()=>{
        const expected={name:'asset.zip',size:10,hashes:{sha256:'abc'}};
        const release={assets:[{name:'asset.zip',size:10,hash_algo:'sha256',hash_value:'abc'}]};
        expect(()=>verifyUploadedAsset(release,expected)).not.toThrow();
        expect(()=>verifyUploadedAsset({assets:[{name:'asset.zip',size:10}]},expected)).toThrow();
        expect(()=>verifyUploadedAsset(release,{...expected,hashes:{sha256:'def'}})).toThrow();
    });
    it('uses CNB OpenAPI for upload and confirmation without sending CNB auth to object storage',async()=>{
        const dir=await mkdtemp(join(tmpdir(),'upload-test-')); const path=join(dir,'asset.zip'); await writeFile(path,'bytes');
        vi.stubEnv('CNB_TOKEN','secret-cnb');
        const fetch=vi.fn(async(url,options)=>{
            if(url.endsWith('asset-upload-url')) return new Response(JSON.stringify({upload_url:'https://storage.example/upload',verify_url:'https://api.cnb.cool/org/repo/-/releases/id/asset-upload-confirmation/token/folder%2Fasset.zip'}));
            if(url.startsWith('https://storage.example')) { for await(const chunk of options.body) void chunk; return new Response(''); }
            return new Response('{}');
        }); vi.stubGlobal('fetch',fetch);
        try {
            const uploaded=await uploadAsset({repo:'org/repo',releaseId:'id',path});
            expect(uploaded.size).toBe(5);
            expect(fetch.mock.calls[1][1].headers).not.toHaveProperty('authorization');
            expect(fetch.mock.calls[2][0]).toContain('/asset-upload-confirmation/token/folder/asset.zip?ttl=0');
        } finally {await rm(dir,{recursive:true,force:true});}
    });
});
