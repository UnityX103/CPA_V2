import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { AuthStore, AuthStoreError } from '../src/AuthStore.js';

async function createTempStore(t)
{
    const dir = await mkdtemp(join(tmpdir(), 'cpa-auth-'));
    const path = join(dir, 'accounts.json');
    t.after(async () =>
    {
        await rm(dir, { recursive: true, force: true });
    });
    return {
        path,
        store: new AuthStore({ filePath: path })
    };
}

test('AuthStore creates an account, hashes the password, and returns a session', async (t) =>
{
    const { path, store } = await createTempStore(t);

    const result = await store.createAccount({ username: ' Alice ', password: 'secret' });
    const raw = JSON.parse(await readFile(path, 'utf8'));
    const saved = raw.users.alice;

    assert.equal(result.user.username, 'Alice');
    assert.equal(result.user.userId.length > 0, true);
    assert.equal(result.token.length > 40, true);
    assert.equal(saved.username, 'Alice');
    assert.notEqual(saved.passwordHash, 'secret');
    assert.equal(Object.hasOwn(saved, 'password'), false);
});

test('AuthStore rejects duplicate usernames case-insensitively', async (t) =>
{
    const { store } = await createTempStore(t);
    await store.createAccount({ username: 'Alice', password: 'secret' });

    await assert.rejects(
        () => store.createAccount({ username: ' alice ', password: 'other' }),
        (error) => error instanceof AuthStoreError && error.code === 'USERNAME_TAKEN'
    );
});

test('AuthStore logs in with correct credentials and rejects wrong credentials', async (t) =>
{
    const { store } = await createTempStore(t);
    await store.createAccount({ username: 'Alice', password: 'secret' });

    const login = await store.login({ username: 'alice', password: 'secret' });
    assert.equal(login.user.username, 'Alice');
    assert.equal(login.token.length > 40, true);

    await assert.rejects(
        () => store.login({ username: 'Alice', password: 'wrong' }),
        (error) => error instanceof AuthStoreError && error.code === 'INVALID_CREDENTIALS'
    );
});

test('AuthStore restores and logs out sessions', async (t) =>
{
    const { store } = await createTempStore(t);
    const created = await store.createAccount({ username: 'Alice', password: 'secret' });

    const restored = await store.restoreSession({ token: created.token });
    assert.deepEqual(restored.user, created.user);

    await store.logout({ token: created.token });
    await assert.rejects(
        () => store.restoreSession({ token: created.token }),
        (error) => error instanceof AuthStoreError && error.code === 'INVALID_SESSION'
    );
});

test('AuthStore rejects empty or oversized account input', async (t) =>
{
    const { store } = await createTempStore(t);

    await assert.rejects(
        () => store.createAccount({ username: '', password: 'secret' }),
        (error) => error instanceof AuthStoreError && error.code === 'INVALID_ACCOUNT_INPUT'
    );
    await assert.rejects(
        () => store.createAccount({ username: 'a'.repeat(33), password: 'secret' }),
        (error) => error instanceof AuthStoreError && error.code === 'INVALID_ACCOUNT_INPUT'
    );
    await assert.rejects(
        () => store.createAccount({ username: 'Alice', password: '' }),
        (error) => error instanceof AuthStoreError && error.code === 'INVALID_ACCOUNT_INPUT'
    );
    await assert.rejects(
        () => store.createAccount({ username: 'Alice', password: 'x'.repeat(129) }),
        (error) => error instanceof AuthStoreError && error.code === 'INVALID_ACCOUNT_INPUT'
    );
});
