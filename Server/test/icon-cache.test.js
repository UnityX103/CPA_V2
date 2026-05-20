import assert from 'node:assert/strict';
import test from 'node:test';
import { IconCache } from '../src/IconCache.js';

test('set + has + get basic', () =>
{
    const cache = new IconCache({ maxEntries: 3, maxBase64Bytes: 1024 });
    cache.set('a', 'AAAA');
    assert.equal(cache.has('a'), true);
    assert.equal(cache.get('a'), 'AAAA');
});

test('LRU evicts oldest when over cap', () =>
{
    const cache = new IconCache({ maxEntries: 2, maxBase64Bytes: 1024 });
    cache.set('a', 'A');
    cache.set('b', 'B');
    cache.set('c', 'C');
    assert.equal(cache.has('a'), false);
    assert.equal(cache.has('b'), true);
    assert.equal(cache.has('c'), true);
});

test('accessing an entry promotes it in LRU', () =>
{
    const cache = new IconCache({ maxEntries: 2, maxBase64Bytes: 1024 });
    cache.set('a', 'A');
    cache.set('b', 'B');
    cache.get('a');         // 提升 a
    cache.set('c', 'C');    // 应淘汰 b
    assert.equal(cache.has('a'), true);
    assert.equal(cache.has('b'), false);
    assert.equal(cache.has('c'), true);
});

test('set rejects oversize base64', () =>
{
    const cache = new IconCache({ maxEntries: 2, maxBase64Bytes: 4 });
    assert.throws(() => cache.set('a', 'AAAAA'), /ICON_TOO_LARGE/);
});
