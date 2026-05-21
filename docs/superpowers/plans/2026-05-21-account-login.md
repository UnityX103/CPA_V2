# Account Login Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a minimal username/password account system for the Settings > 联机 tab while keeping local pomodoro and check-in plan features usable without login or networking.

**Architecture:** Extend the existing WebSocket protocol with auth messages and keep account state inside the existing `network` domain. The Server gets a focused file-backed `AuthStore` using salted `scrypt` hashes and session tokens; room creation/join requires an authenticated WebSocket connection, while local app stores remain independent from auth.

**Tech Stack:** Node.js ESM, `node:test`, `ws`, React, TypeScript, Zustand, Vitest, Testing Library, Tauri plugin-store.

---

## File Structure

- Create `Server/src/AuthStore.js`: file-backed user/session store with username normalization, password hashing, login, session restore, logout, and atomic saves.
- Create `Server/test/auth-store.test.js`: unit tests for account creation, duplicate usernames, password hashing, login, sessions, and logout.
- Modify `Server/src/protocol.js`: parse auth client messages and encode auth server messages.
- Modify `Server/test/protocol.test.js`: protocol coverage for auth message normalization and auth response encoding.
- Modify `Server/src/index.js`: instantiate `AuthStore`, handle auth messages, attach auth identity to connections, and require auth for `create_room`/`join_room`.
- Modify `Server/test/integration.test.js`: authenticate test clients before room flows and add auth-required integration coverage.
- Create `app/src/domain/accountPersistence.ts`: load/save/clear persisted account sessions via Tauri plugin-store.
- Create `app/src/domain/accountPersistence.test.ts`: persistence validation and malformed snapshot coverage.
- Modify `app/src/domain/network.ts`: add account state/actions, auth message handling, session restore, token persistence, and room auth guards.
- Modify `app/src/domain/network.test.ts`: auth action serialization, state transitions, token clearing, settings-window dispatch, and room guard coverage.
- Modify `app/src/ui/SettingsPanel.tsx`: add the account card in `OnlineTab`, disable room controls while logged out, and keep room flow unchanged when logged in.
- Modify `app/src/ui/SettingsPanel.test.tsx`: account UI and disabled-room-control tests.
- Verify existing `app/src/domain/pomodoro.test.ts`, `app/src/domain/checkin.test.ts`, and UI tests still run without account setup.

### Task 1: Server AuthStore Tests

**Files:**
- Create: `Server/test/auth-store.test.js`
- Create later: `Server/src/AuthStore.js`

- [ ] **Step 1: Write failing AuthStore tests**

Create `Server/test/auth-store.test.js`:

```js
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { AuthStore, AuthStoreError } from '../src/AuthStore.js';

async function createTempStore(t)
{
    const dir = await mkdtemp(join(tmpdir(), 'cpa-auth-'));
    t.after(async () => {
        await rm(dir, { recursive: true, force: true });
    });
    return {
        path: join(dir, 'accounts.json'),
        store: new AuthStore({ filePath: join(dir, 'accounts.json') })
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
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
cd Server
node --test test/auth-store.test.js
```

Expected: FAIL because `Server/src/AuthStore.js` does not exist.

### Task 2: Implement AuthStore

**Files:**
- Create: `Server/src/AuthStore.js`
- Test: `Server/test/auth-store.test.js`

- [ ] **Step 1: Add AuthStore implementation**

Create `Server/src/AuthStore.js`:

```js
import { randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);
const DEFAULT_FILE_PATH = join(process.cwd(), 'data', 'accounts.json');
const PASSWORD_KEY_BYTES = 64;
const MAX_USERNAME_CHARS = 32;
const MAX_PASSWORD_CHARS = 128;

export class AuthStoreError extends Error
{
    constructor(code, message)
    {
        super(message);
        this.code = code;
    }
}

export class AuthStore
{
    constructor(options = {})
    {
        this._filePath = options.filePath ?? DEFAULT_FILE_PATH;
        this._now = options.now ?? (() => Date.now());
        this._data = null;
        this._writeChain = Promise.resolve();
    }

    async createAccount({ username, password })
    {
        const normalized = normalizeAccountInput({ username, password });
        const data = await this._load();
        if (data.users[normalized.key])
        {
            throw new AuthStoreError('USERNAME_TAKEN', '用户名已存在');
        }

        const salt = randomBytes(16);
        const hash = await hashPassword(normalized.password, salt);
        const user = {
            userId: randomUUID(),
            username: normalized.username,
            passwordHash: hash.toString('base64'),
            passwordSalt: salt.toString('base64'),
            createdAt: this._now()
        };
        data.users[normalized.key] = user;
        const token = createSessionToken();
        data.sessions[token] = createSession(user, this._now());
        await this._save(data);
        return { user: publicUser(user), token };
    }

    async login({ username, password })
    {
        const normalized = normalizeAccountInput({ username, password });
        const data = await this._load();
        const user = data.users[normalized.key];
        if (!user)
        {
            throw new AuthStoreError('INVALID_CREDENTIALS', '用户名或密码错误');
        }

        const expected = Buffer.from(user.passwordHash, 'base64');
        const actual = await hashPassword(normalized.password, Buffer.from(user.passwordSalt, 'base64'));
        if (expected.length !== actual.length || !timingSafeEqual(expected, actual))
        {
            throw new AuthStoreError('INVALID_CREDENTIALS', '用户名或密码错误');
        }

        const token = createSessionToken();
        data.sessions[token] = createSession(user, this._now());
        await this._save(data);
        return { user: publicUser(user), token };
    }

    async restoreSession({ token })
    {
        const normalizedToken = normalizeToken(token);
        const data = await this._load();
        const session = data.sessions[normalizedToken];
        if (!session)
        {
            throw new AuthStoreError('INVALID_SESSION', '登录已失效');
        }
        return { user: { userId: session.userId, username: session.username }, token: normalizedToken };
    }

    async logout({ token })
    {
        const normalizedToken = normalizeToken(token);
        const data = await this._load();
        delete data.sessions[normalizedToken];
        await this._save(data);
    }

    async _load()
    {
        if (this._data) return this._data;
        try
        {
            const parsed = JSON.parse(await readFile(this._filePath, 'utf8'));
            this._data = normalizeDataFile(parsed);
        }
        catch
        {
            this._data = { users: {}, sessions: {} };
        }
        return this._data;
    }

    async _save(data)
    {
        this._writeChain = this._writeChain.then(async () =>
        {
            await mkdir(dirname(this._filePath), { recursive: true });
            const tempPath = `${this._filePath}.${process.pid}.${Date.now()}.tmp`;
            await writeFile(tempPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
            await rename(tempPath, this._filePath);
        });
        await this._writeChain;
    }
}

function normalizeAccountInput({ username, password })
{
    const normalizedUsername = typeof username === 'string' ? username.trim() : '';
    const normalizedPassword = typeof password === 'string' ? password : '';
    if (
        Array.from(normalizedUsername).length < 1 ||
        Array.from(normalizedUsername).length > MAX_USERNAME_CHARS ||
        Array.from(normalizedPassword).length < 1 ||
        Array.from(normalizedPassword).length > MAX_PASSWORD_CHARS
    )
    {
        throw new AuthStoreError('INVALID_ACCOUNT_INPUT', '账号或密码格式不正确');
    }
    return {
        username: normalizedUsername,
        password: normalizedPassword,
        key: normalizedUsername.toLocaleLowerCase()
    };
}

function normalizeToken(token)
{
    if (typeof token !== 'string' || !token.trim())
    {
        throw new AuthStoreError('INVALID_SESSION', '登录已失效');
    }
    return token.trim();
}

function normalizeDataFile(value)
{
    if (!value || typeof value !== 'object')
    {
        return { users: {}, sessions: {} };
    }
    return {
        users: value.users && typeof value.users === 'object' ? value.users : {},
        sessions: value.sessions && typeof value.sessions === 'object' ? value.sessions : {}
    };
}

function createSession(user, now)
{
    return {
        userId: user.userId,
        username: user.username,
        createdAt: now
    };
}

function publicUser(user)
{
    return {
        userId: user.userId,
        username: user.username
    };
}

function createSessionToken()
{
    return randomBytes(32).toString('base64url');
}

async function hashPassword(password, salt)
{
    return scrypt(password, salt, PASSWORD_KEY_BYTES);
}
```

- [ ] **Step 2: Run AuthStore tests**

Run:

```bash
cd Server
node --test test/auth-store.test.js
```

Expected: PASS.

- [ ] **Step 3: Commit**

Run:

```bash
git add Server/src/AuthStore.js Server/test/auth-store.test.js
git commit -m "feat(server): add file backed auth store"
```

### Task 3: Protocol Auth Messages

**Files:**
- Modify: `Server/src/protocol.js`
- Modify: `Server/test/protocol.test.js`

- [ ] **Step 1: Add failing protocol tests**

Append to `Server/test/protocol.test.js`:

```js
test('parseClientMessage normalizes account auth messages', () =>
{
    assert.deepEqual(parseClientMessage(JSON.stringify({
        v: PROTOCOL_VERSION,
        type: 'auth_create',
        username: ' Alice ',
        password: 'secret'
    })), {
        v: PROTOCOL_VERSION,
        type: 'auth_create',
        username: 'Alice',
        password: 'secret'
    });

    assert.deepEqual(parseClientMessage(JSON.stringify({
        v: PROTOCOL_VERSION,
        type: 'auth_login',
        username: 'Alice',
        password: 'secret'
    })), {
        v: PROTOCOL_VERSION,
        type: 'auth_login',
        username: 'Alice',
        password: 'secret'
    });

    assert.deepEqual(parseClientMessage(JSON.stringify({
        v: PROTOCOL_VERSION,
        type: 'auth_session',
        token: ' token '
    })), {
        v: PROTOCOL_VERSION,
        type: 'auth_session',
        token: 'token'
    });

    assert.deepEqual(parseClientMessage(JSON.stringify({
        v: PROTOCOL_VERSION,
        type: 'auth_logout',
        token: ' token '
    })), {
        v: PROTOCOL_VERSION,
        type: 'auth_logout',
        token: 'token'
    });
});

test('parseClientMessage rejects malformed account input', () =>
{
    for (const payload of [
        { type: 'auth_create', username: '', password: 'secret' },
        { type: 'auth_create', username: 'a'.repeat(33), password: 'secret' },
        { type: 'auth_login', username: 'Alice', password: '' },
        { type: 'auth_login', username: 'Alice', password: 'x'.repeat(129) },
        { type: 'auth_session', token: '' },
        { type: 'auth_logout', token: '' }
    ])
    {
        assert.throws(
            () => parseClientMessage(JSON.stringify({ v: PROTOCOL_VERSION, ...payload })),
            (error) => error instanceof ProtocolError && error.code === 'INVALID_MESSAGE'
        );
    }
});

test('auth response helpers encode auth_ok and auth_logged_out', async () =>
{
    const { createAuthOkMessage, createAuthLoggedOutMessage } = await import('../src/protocol.js');
    assert.deepEqual(JSON.parse(encodeMessage(createAuthOkMessage({
        user: { userId: 'u1', username: 'Alice' },
        token: 'token'
    }))), {
        v: PROTOCOL_VERSION,
        type: 'auth_ok',
        user: { userId: 'u1', username: 'Alice' },
        token: 'token'
    });
    assert.deepEqual(JSON.parse(encodeMessage(createAuthLoggedOutMessage())), {
        v: PROTOCOL_VERSION,
        type: 'auth_logged_out'
    });
});
```

- [ ] **Step 2: Run protocol tests and verify failure**

Run:

```bash
cd Server
node --test test/protocol.test.js
```

Expected: FAIL because auth message types are unsupported.

- [ ] **Step 3: Implement protocol support**

In `Server/src/protocol.js`, add auth types to `SUPPORTED_CLIENT_MESSAGE_TYPES`:

```js
'auth_create',
'auth_login',
'auth_session',
'auth_logout',
```

Add switch cases before `create_room`:

```js
case 'auth_create':
    return {
        v: PROTOCOL_VERSION,
        type: 'auth_create',
        ...normalizeAccountCredentials(parsedMessage)
    };

case 'auth_login':
    return {
        v: PROTOCOL_VERSION,
        type: 'auth_login',
        ...normalizeAccountCredentials(parsedMessage)
    };

case 'auth_session':
    return {
        v: PROTOCOL_VERSION,
        type: 'auth_session',
        token: normalizeAuthToken(parsedMessage.token)
    };

case 'auth_logout':
    return {
        v: PROTOCOL_VERSION,
        type: 'auth_logout',
        token: normalizeAuthToken(parsedMessage.token)
    };
```

Add helpers near `normalizePlayerName`:

```js
function normalizeAccountCredentials(message)
{
    const username = typeof message.username === 'string' ? message.username.trim() : '';
    const password = typeof message.password === 'string' ? message.password : '';
    if (
        Array.from(username).length < 1 ||
        Array.from(username).length > 32 ||
        Array.from(password).length < 1 ||
        Array.from(password).length > 128
    )
    {
        throw new ProtocolError('INVALID_MESSAGE', '账号或密码格式不正确');
    }
    return { username, password };
}

function normalizeAuthToken(token)
{
    const normalizedToken = typeof token === 'string' ? token.trim() : '';
    if (!normalizedToken)
    {
        throw new ProtocolError('INVALID_MESSAGE', 'token 不能为空');
    }
    return normalizedToken;
}
```

Add exported server-message helpers after `createErrorMessage`:

```js
export function createAuthOkMessage({ user, token })
{
    return {
        type: 'auth_ok',
        user: {
            userId: String(user.userId),
            username: String(user.username)
        },
        token: String(token)
    };
}

export function createAuthLoggedOutMessage()
{
    return { type: 'auth_logged_out' };
}
```

- [ ] **Step 4: Run protocol tests**

Run:

```bash
cd Server
node --test test/protocol.test.js
```

Expected: PASS.

### Task 4: Server WebSocket Auth Integration

**Files:**
- Modify: `Server/src/index.js`
- Modify: `Server/test/integration.test.js`
- Test: `Server/test/integration.test.js`

- [ ] **Step 1: Add integration test helpers and auth-required test**

In `Server/test/integration.test.js`, add:

```js
async function authClient(socket, inbox, username)
{
    sendJson(socket, {
        type: 'auth_create',
        username,
        password: 'secret'
    });
    return inbox.waitFor('auth_ok');
}
```

Append:

```js
test('room creation and join require an authenticated account', async (t) =>
{
    const app = await createPomodoroServer({
        port: 0,
        heartbeatIntervalMs: 5000,
        initTimeoutMs: 1000
    });
    t.after(async () => { await app.close(); });

    const client = await openClient(app.url);
    const inbox = createMessageCollector(client);
    t.after(() => { client.close(); });

    sendJson(client, { type: 'create_room', playerName: 'Guest' });
    const error = await inbox.waitFor('error');
    assert.equal(error.error, 'AUTH_REQUIRED');

    sendJson(client, { type: 'join_room', roomCode: 'ABCDEF', playerName: 'Guest' });
    const joinError = await inbox.waitFor('error');
    assert.equal(joinError.error, 'AUTH_REQUIRED');
});
```

Then update existing integration tests so each client authenticates before room messages. Example:

```js
await authClient(clientA, inboxA, 'host-a');
await authClient(clientB, inboxB, 'guest-b');
```

Use unique usernames per test to avoid file-backed collisions.

- [ ] **Step 2: Run integration tests and verify failure**

Run:

```bash
cd Server
node --test test/integration.test.js
```

Expected: FAIL because auth messages are not handled and room auth is not enforced.

- [ ] **Step 3: Wire AuthStore into the server**

In `Server/src/index.js`, add imports:

```js
import { AuthStore, AuthStoreError } from './AuthStore.js';
```

Extend protocol imports:

```js
createAuthLoggedOutMessage,
createAuthOkMessage,
```

Inside `createPomodoroServer`, create the auth store:

```js
const authStore = options.authStore ?? new AuthStore({
    filePath: options.authFilePath
});
```

Add auth fields to each connection:

```js
userId: null,
username: null,
authToken: null,
```

Pass `authStore` into `handleMessage`.

Add cases in `handleMessage` before room cases:

```js
case 'auth_create':
    handleAuthCreate(message, context);
    return;

case 'auth_login':
    handleAuthLogin(message, context);
    return;

case 'auth_session':
    handleAuthSession(message, context);
    return;

case 'auth_logout':
    handleAuthLogout(message, context);
    return;
```

Add handlers:

```js
async function authenticateConnection(connection, result)
{
    connection.userId = result.user.userId;
    connection.username = result.user.username;
    connection.authToken = result.token;
}

function sendAuthOk(connection, result)
{
    authenticateConnection(connection, result);
    clearConnectionInitTimeout(connection);
    safeSend(connection.socket, createAuthOkMessage(result));
}

function handleAuthCreate(message, context)
{
    context.authStore.createAccount(message)
        .then((result) => sendAuthOk(context.connection, result))
        .catch((error) => handleKnownError(context.connection.socket, error, context.logger));
}

function handleAuthLogin(message, context)
{
    context.authStore.login(message)
        .then((result) => sendAuthOk(context.connection, result))
        .catch((error) => handleKnownError(context.connection.socket, error, context.logger));
}

function handleAuthSession(message, context)
{
    context.authStore.restoreSession(message)
        .then((result) => sendAuthOk(context.connection, result))
        .catch((error) => handleKnownError(context.connection.socket, error, context.logger));
}

function handleAuthLogout(message, context)
{
    context.authStore.logout(message)
        .then(() =>
        {
            leaveCurrentRoom({ connection: context.connection, roomManager: context.roomManager, notifyOthers: true });
            context.connection.userId = null;
            context.connection.username = null;
            context.connection.authToken = null;
            safeSend(context.connection.socket, createAuthLoggedOutMessage());
        })
        .catch((error) => handleKnownError(context.connection.socket, error, context.logger));
}
```

Add an auth guard and call it at the top of `handleCreateRoom` and `handleJoinRoom`:

```js
function ensureAuthenticated(connection)
{
    if (!connection.userId)
    {
        throw new ProtocolError('AUTH_REQUIRED', '请先登录');
    }
}
```

Add known error handling:

```js
if (error instanceof AuthStoreError)
{
    safeSend(socket, createErrorMessage(error.code));
    return;
}
```

- [ ] **Step 4: Run server tests**

Run:

```bash
cd Server
npm test
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add Server/src/index.js Server/src/protocol.js Server/test/protocol.test.js Server/test/integration.test.js
git commit -m "feat(server): require accounts for room sessions"
```

### Task 5: Client Account Persistence

**Files:**
- Create: `app/src/domain/accountPersistence.ts`
- Create: `app/src/domain/accountPersistence.test.ts`

- [ ] **Step 1: Write failing persistence tests**

Create `app/src/domain/accountPersistence.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const store = {
    get: vi.fn(),
    set: vi.fn(),
    delete: vi.fn(),
    save: vi.fn(),
};

vi.mock('@tauri-apps/plugin-store', () => ({
    load: vi.fn(() => Promise.resolve(store)),
}));

describe('accountPersistence', () => {
    beforeEach(() => {
        store.get.mockReset();
        store.set.mockReset();
        store.delete.mockReset();
        store.save.mockReset();
    });

    it('loads a persisted account session', async () => {
        store.get.mockResolvedValue({ v: 1, token: 'abc', username: 'Alice' });
        const { loadPersistedAccountSession } = await import('./accountPersistence');

        await expect(loadPersistedAccountSession()).resolves.toEqual({ token: 'abc', username: 'Alice' });
    });

    it('ignores malformed sessions', async () => {
        store.get.mockResolvedValue({ v: 1, token: '', username: 'Alice' });
        const { loadPersistedAccountSession } = await import('./accountPersistence');

        await expect(loadPersistedAccountSession()).resolves.toBeNull();
    });

    it('saves and clears account sessions', async () => {
        const { savePersistedAccountSession, clearPersistedAccountSession } = await import('./accountPersistence');

        await savePersistedAccountSession({ token: 'abc', username: 'Alice' });
        expect(store.set).toHaveBeenCalledWith('account', { v: 1, token: 'abc', username: 'Alice' });
        expect(store.save).toHaveBeenCalledTimes(1);

        await clearPersistedAccountSession();
        expect(store.delete).toHaveBeenCalledWith('account');
        expect(store.save).toHaveBeenCalledTimes(2);
    });
});
```

- [ ] **Step 2: Run failing persistence tests**

Run:

```bash
cd app
npx vitest run src/domain/accountPersistence.test.ts
```

Expected: FAIL because `accountPersistence.ts` does not exist.

- [ ] **Step 3: Implement account persistence**

Create `app/src/domain/accountPersistence.ts`:

```ts
import { load } from '@tauri-apps/plugin-store';

const STORE_PATH = 'account.json';
const STORE_KEY = 'account';

export interface PersistedAccountSession {
    token: string;
    username: string;
}

interface PersistedAccountSessionV1 {
    v: 1;
    token: string;
    username: string;
}

function isPersistedAccountSessionV1(value: unknown): value is PersistedAccountSessionV1 {
    if (!value || typeof value !== 'object') return false;
    const candidate = value as Partial<PersistedAccountSessionV1>;
    return candidate.v === 1
        && typeof candidate.token === 'string'
        && candidate.token.trim().length > 0
        && typeof candidate.username === 'string'
        && candidate.username.trim().length > 0;
}

async function openStore() {
    return load(STORE_PATH, { defaults: {}, autoSave: false });
}

export async function loadPersistedAccountSession(): Promise<PersistedAccountSession | null> {
    try {
        const store = await openStore();
        const value = await store.get<unknown>(STORE_KEY);
        if (!isPersistedAccountSessionV1(value)) return null;
        return { token: value.token.trim(), username: value.username.trim() };
    } catch (err) {
        console.warn('[accountPersistence] load failed', err);
        return null;
    }
}

export async function savePersistedAccountSession(session: PersistedAccountSession): Promise<void> {
    try {
        const store = await openStore();
        await store.set(STORE_KEY, {
            v: 1,
            token: session.token,
            username: session.username,
        } satisfies PersistedAccountSessionV1);
        await store.save();
    } catch (err) {
        console.warn('[accountPersistence] save failed', err);
    }
}

export async function clearPersistedAccountSession(): Promise<void> {
    try {
        const store = await openStore();
        await store.delete(STORE_KEY);
        await store.save();
    } catch (err) {
        console.warn('[accountPersistence] clear failed', err);
    }
}
```

- [ ] **Step 4: Run persistence tests**

Run:

```bash
cd app
npx vitest run src/domain/accountPersistence.test.ts
```

Expected: PASS.

### Task 6: Client Network Auth Domain

**Files:**
- Modify: `app/src/domain/network.ts`
- Modify: `app/src/domain/network.test.ts`
- Test: `app/src/domain/network.test.ts`

- [ ] **Step 1: Add failing network tests**

In `app/src/domain/network.test.ts`, update the reset state to include account fields:

```ts
accountStatus: 'guest',
accountUser: null,
accountToken: null,
accountError: null,
```

Append tests:

```ts
describe('NetworkSystem account auth', () => {
    it('createAccount sends auth_create and stores auth_ok', async () => {
        const promise = useNetworkStore.getState().createAccount('Alice', 'secret');
        await promise;
        await new Promise((r) => setTimeout(r, 5));

        const socket = latestSocket();
        expect(JSON.parse(socket?.sent[0] ?? '{}')).toEqual({
            v: 1,
            type: 'auth_create',
            username: 'Alice',
            password: 'secret',
        });

        socket?.onmessage?.({
            data: JSON.stringify({
                type: 'auth_ok',
                user: { userId: 'u1', username: 'Alice' },
                token: 'token-1',
            }),
        } as MessageEvent);

        expect(useNetworkStore.getState().accountStatus).toBe('loggedIn');
        expect(useNetworkStore.getState().accountUser).toEqual({ userId: 'u1', username: 'Alice' });
        expect(useNetworkStore.getState().accountToken).toBe('token-1');
        expect(useNetworkStore.getState().playerName).toBe('Alice');
    });

    it('login sends auth_login and invalid session clears account state', async () => {
        await useNetworkStore.getState().login('Alice', 'secret');
        await new Promise((r) => setTimeout(r, 5));
        expect(JSON.parse(latestSocket()?.sent[0] ?? '{}').type).toBe('auth_login');

        latestSocket()?.onmessage?.({
            data: JSON.stringify({ type: 'error', error: 'INVALID_SESSION' }),
        } as MessageEvent);

        expect(useNetworkStore.getState().accountStatus).toBe('guest');
        expect(useNetworkStore.getState().accountToken).toBeNull();
    });

    it('does not send room messages while logged out', async () => {
        await useNetworkStore.getState().createRoom('ABCDEF');
        await new Promise((r) => setTimeout(r, 5));

        expect(useNetworkStore.getState().lastError).toBe('AUTH_REQUIRED');
        expect(latestSocket()).toBeUndefined();
    });

    it('settings-window account actions dispatch to main', async () => {
        const spy = vi.spyOn(dispatchMod, 'dispatch').mockResolvedValue();
        const store = createNetworkStore({ isSettingsWindow: true });

        await store.getState().createAccount('Alice', 'secret');
        await store.getState().login('Alice', 'secret');
        await store.getState().restoreAccountSession();
        store.getState().logout();

        expect(spy).toHaveBeenCalledWith(expect.objectContaining({ store: 'network', action: 'createAccount', args: ['Alice', 'secret'] }));
        expect(spy).toHaveBeenCalledWith(expect.objectContaining({ store: 'network', action: 'login', args: ['Alice', 'secret'] }));
        expect(spy).toHaveBeenCalledWith(expect.objectContaining({ store: 'network', action: 'restoreAccountSession', args: [] }));
        expect(spy).toHaveBeenCalledWith(expect.objectContaining({ store: 'network', action: 'logout', args: [] }));
        spy.mockRestore();
    });
});
```

- [ ] **Step 2: Run network tests and verify failure**

Run:

```bash
cd app
npx vitest run src/domain/network.test.ts
```

Expected: FAIL because account actions and fields do not exist.

- [ ] **Step 3: Add account types and actions**

In `app/src/domain/network.ts`, import persistence:

```ts
import {
    clearPersistedAccountSession,
    loadPersistedAccountSession,
    savePersistedAccountSession,
} from './accountPersistence';
```

Add types:

```ts
export type AccountStatus = 'guest' | 'checking' | 'creating' | 'loggingIn' | 'loggedIn' | 'error';

export interface AccountUser {
    userId: string;
    username: string;
}
```

Extend `NetworkStateShape`:

```ts
accountStatus: AccountStatus;
accountUser: AccountUser | null;
accountToken: string | null;
accountError: string | null;
```

Extend `NetworkActions`:

```ts
createAccount: (username: string, password: string) => Promise<void>;
login: (username: string, password: string) => Promise<void>;
restoreAccountSession: () => Promise<void>;
logout: () => void;
```

Extend `INITIAL_STATE`:

```ts
accountStatus: 'guest',
accountUser: null,
accountToken: null,
accountError: null,
```

- [ ] **Step 4: Implement settings-window dispatches**

Inside the settings-window store returned by `createNetworkStore`, add:

```ts
createAccount: async (username, password) => {
    void dispatch({ v: BRIDGE_VERSION, store: 'network', action: 'createAccount', args: [username, password] });
},
login: async (username, password) => {
    void dispatch({ v: BRIDGE_VERSION, store: 'network', action: 'login', args: [username, password] });
},
restoreAccountSession: async () => {
    void dispatch({ v: BRIDGE_VERSION, store: 'network', action: 'restoreAccountSession', args: [] });
},
logout: () => {
    void dispatch({ v: BRIDGE_VERSION, store: 'network', action: 'logout', args: [] });
},
```

- [ ] **Step 5: Implement auth message handling**

In `handleMessage`, add:

```ts
case 'auth_ok': {
    const user = normalizeAccountUser(msg.user);
    const token = typeof msg.token === 'string' ? msg.token : '';
    if (!user || !token) {
        set({ accountStatus: 'error', accountError: 'INVALID_SESSION' });
        break;
    }
    const nextPlayerName = get().playerName.trim() && get().playerName !== '我'
        ? get().playerName
        : user.username;
    set({
        accountStatus: 'loggedIn',
        accountUser: user,
        accountToken: token,
        accountError: null,
        playerName: nextPlayerName,
    });
    void savePersistedAccountSession({ token, username: user.username });
    break;
}
case 'auth_logged_out':
    set({ accountStatus: 'guest', accountUser: null, accountToken: null, accountError: null });
    void clearPersistedAccountSession();
    break;
```

Update `case 'error'`:

```ts
const error = msg.error ?? 'INTERNAL_ERROR';
if (error === 'INVALID_SESSION') {
    set({ accountStatus: 'guest', accountUser: null, accountToken: null, accountError: error, lastError: error });
    void clearPersistedAccountSession();
    break;
}
if (error === 'USERNAME_TAKEN' || error === 'INVALID_CREDENTIALS' || error === 'INVALID_ACCOUNT_INPUT' || error === 'AUTH_REQUIRED') {
    set({ accountStatus: 'error', accountError: error, lastError: error });
    break;
}
set({ lastError: error });
break;
```

Add helper below `send`:

```ts
function normalizeAccountUser(value: unknown): AccountUser | null {
    if (!value || typeof value !== 'object') return null;
    const candidate = value as Partial<AccountUser>;
    if (typeof candidate.userId !== 'string' || !candidate.userId) return null;
    if (typeof candidate.username !== 'string' || !candidate.username.trim()) return null;
    return { userId: candidate.userId, username: candidate.username.trim() };
}
```

- [ ] **Step 6: Implement auth actions and room guard**

In the main-window store actions, add:

```ts
createAccount: async (username, password) => {
    set({ accountStatus: 'creating', accountError: null, lastError: null });
    const socket = await ensureSocket();
    send(socket, { type: 'auth_create', username, password });
},
login: async (username, password) => {
    set({ accountStatus: 'loggingIn', accountError: null, lastError: null });
    const socket = await ensureSocket();
    send(socket, { type: 'auth_login', username, password });
},
restoreAccountSession: async () => {
    const session = await loadPersistedAccountSession();
    if (!session) {
        set({ accountStatus: 'guest', accountUser: null, accountToken: null, accountError: null });
        return;
    }
    set({ accountStatus: 'checking', accountToken: session.token, accountError: null });
    const socket = await ensureSocket();
    send(socket, { type: 'auth_session', token: session.token });
},
logout: () => {
    const token = get().accountToken;
    if (get().status === 'joined') get().leaveRoom();
    if (token) send(internal.socket, { type: 'auth_logout', token });
    void clearPersistedAccountSession();
    set({ accountStatus: 'guest', accountUser: null, accountToken: null, accountError: null });
},
```

At the top of `createRoom` and `joinRoom`:

```ts
if (get().accountStatus !== 'loggedIn') {
    set({ lastError: 'AUTH_REQUIRED', accountError: 'AUTH_REQUIRED' });
    return;
}
```

- [ ] **Step 7: Run network tests**

Run:

```bash
cd app
npx vitest run src/domain/accountPersistence.test.ts src/domain/network.test.ts
```

Expected: PASS.

### Task 7: Settings Online Account UI

**Files:**
- Modify: `app/src/ui/SettingsPanel.tsx`
- Modify: `app/src/ui/SettingsPanel.css`
- Modify: `app/src/ui/SettingsPanel.test.tsx`

- [ ] **Step 1: Add failing UI tests**

In `app/src/ui/SettingsPanel.test.tsx`, inside `describe('OnlineTab parity with 8Le5R', () => { ... })`, extend the `beforeEach` network reset with:

```ts
accountStatus: 'guest',
accountUser: null,
accountToken: null,
accountError: null,
```

Append:

```ts
it('renders account login controls while logged out and disables room actions', () => {
    render(<SettingsPanel />);

    expect(screen.getByLabelText('账号')).toBeTruthy();
    expect(screen.getByLabelText('密码')).toBeTruthy();
    expect(screen.getByRole('button', { name: '登录' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '创建账号' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '创建房间' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '加入房间' })).toBeDisabled();
    expect(screen.getByText('登录后可创建或加入联机房间')).toBeTruthy();
});

it('routes login and create account actions to the network store', async () => {
    const createAccount = vi.fn(async () => {});
    const login = vi.fn(async () => {});
    useNetworkStore.setState({ createAccount, login });
    render(<SettingsPanel />);

    fireEvent.change(screen.getByLabelText('账号'), { target: { value: 'Alice' } });
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'secret' } });
    fireEvent.click(screen.getByRole('button', { name: '创建账号' }));
    fireEvent.click(screen.getByRole('button', { name: '登录' }));

    expect(createAccount).toHaveBeenCalledWith('Alice', 'secret');
    expect(login).toHaveBeenCalledWith('Alice', 'secret');
});

it('renders logged-in account state and enables room actions', () => {
    useNetworkStore.setState({
        accountStatus: 'loggedIn',
        accountUser: { userId: 'u1', username: 'Alice' },
        accountToken: 'token',
    });

    render(<SettingsPanel />);

    expect(screen.getByText('Alice')).toBeTruthy();
    expect(screen.getByRole('button', { name: '退出登录' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '创建房间' })).not.toBeDisabled();
});
```

- [ ] **Step 2: Run UI tests and verify failure**

Run:

```bash
cd app
npx vitest run src/ui/SettingsPanel.test.tsx
```

Expected: FAIL because account controls are not rendered.

- [ ] **Step 3: Add account card JSX**

In `OnlineTab`, add local form state:

```ts
const [accountName, setAccountName] = useState(net.accountUser?.username ?? '');
const [accountPassword, setAccountPassword] = useState('');
const isLoggedIn = net.accountStatus === 'loggedIn' && net.accountUser;
const accountBusy = net.accountStatus === 'checking' || net.accountStatus === 'creating' || net.accountStatus === 'loggingIn';
```

Add this card as the first child inside `<div className="tab-pane">`:

```tsx
<div className="card account-card">
    <span className="card-title">账号</span>
    {!isLoggedIn ? (
        <>
            <label className="card card-row-stack account-field">
                <span className="card-label">账号</span>
                <input
                    aria-label="账号"
                    className="text-input"
                    value={accountName}
                    onChange={(e) => setAccountName(e.currentTarget.value)}
                    placeholder="用户名"
                    disabled={accountBusy}
                />
            </label>
            <label className="card card-row-stack account-field">
                <span className="card-label">密码</span>
                <input
                    aria-label="密码"
                    className="text-input"
                    type="password"
                    value={accountPassword}
                    onChange={(e) => setAccountPassword(e.currentTarget.value)}
                    placeholder="密码"
                    disabled={accountBusy}
                />
            </label>
            <div className="card-actions" style={{ width: '100%' }}>
                <button
                    className="btn btn-secondary btn-block"
                    disabled={accountBusy || !accountName || !accountPassword}
                    onClick={() => net.createAccount(accountName, accountPassword)}
                >
                    创建账号
                </button>
                <button
                    className="btn btn-primary btn-block"
                    disabled={accountBusy || !accountName || !accountPassword}
                    onClick={() => net.login(accountName, accountPassword)}
                >
                    登录
                </button>
            </div>
            {net.accountError && <div className="error-text">{net.accountError}</div>}
        </>
    ) : (
        <div className="account-summary">
            <span className="account-name">{net.accountUser.username}</span>
            <button className="btn btn-secondary btn-fit" onClick={net.logout}>
                退出登录
            </button>
        </div>
    )}
</div>
```

Update room buttons:

```tsx
disabled={!isLoggedIn}
```

for 创建房间, and:

```tsx
disabled={!isLoggedIn || !code}
```

for 加入房间. Add the hint under room actions:

```tsx
{!isLoggedIn && <div className="online-auth-hint">登录后可创建或加入联机房间</div>}
```

- [ ] **Step 4: Add compact CSS**

In `app/src/ui/SettingsPanel.css`, add:

```css
.account-card {
    gap: 10px;
}

.account-field {
    background: transparent;
    padding: 0;
}

.account-summary {
    align-items: center;
    display: flex;
    gap: 10px;
    justify-content: space-between;
    width: 100%;
}

.account-name {
    color: var(--text-primary);
    font-size: 14px;
    font-weight: 700;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.online-auth-hint {
    color: var(--text-muted);
    font-size: 12px;
    line-height: 1.4;
}
```

- [ ] **Step 5: Run UI tests**

Run:

```bash
cd app
npx vitest run src/ui/SettingsPanel.test.tsx
```

Expected: PASS.

### Task 8: Final Verification and Commit

**Files:**
- Verify: `Server/src/AuthStore.js`
- Verify: `Server/src/index.js`
- Verify: `Server/src/protocol.js`
- Verify: `app/src/domain/accountPersistence.ts`
- Verify: `app/src/domain/network.ts`
- Verify: `app/src/ui/SettingsPanel.tsx`

- [ ] **Step 1: Run focused server tests**

Run:

```bash
cd Server
node --test test/auth-store.test.js test/protocol.test.js test/integration.test.js
```

Expected: PASS.

- [ ] **Step 2: Run all server tests**

Run:

```bash
cd Server
npm test
```

Expected: PASS.

- [ ] **Step 3: Run focused app tests**

Run:

```bash
cd app
npx vitest run src/domain/accountPersistence.test.ts src/domain/network.test.ts src/ui/SettingsPanel.test.tsx src/domain/pomodoro.test.ts src/domain/checkin.test.ts
```

Expected: PASS.

- [ ] **Step 4: Run all app tests**

Run:

```bash
cd app
npm test
```

Expected: PASS.

- [ ] **Step 5: Build the app**

Run:

```bash
cd app
npm run build
```

Expected: PASS.

- [ ] **Step 6: Review diff**

Run:

```bash
git diff --check
git status --short
```

Expected: `git diff --check` prints no whitespace errors. `git status --short` lists only the files touched by this plan.

- [ ] **Step 7: Commit**

Run:

```bash
git add Server/src/AuthStore.js Server/src/index.js Server/src/protocol.js Server/test/auth-store.test.js Server/test/protocol.test.js Server/test/integration.test.js app/src/domain/accountPersistence.ts app/src/domain/accountPersistence.test.ts app/src/domain/network.ts app/src/domain/network.test.ts app/src/ui/SettingsPanel.tsx app/src/ui/SettingsPanel.css app/src/ui/SettingsPanel.test.tsx
git commit -m "feat: add beta account login"
```

## Self-Review

- Spec coverage: covered account creation, login, session restore, logout, server-side password hashing, file persistence, room auth requirement, Settings online UI, and offline local feature independence.
- Placeholder scan: no TBD, TODO, "implement later", or open-ended validation instructions remain.
- Type consistency: account store uses `accountStatus`, `accountUser`, `accountToken`, and `accountError` consistently across domain and UI tasks; server protocol uses `auth_create`, `auth_login`, `auth_session`, `auth_logout`, `auth_ok`, and `auth_logged_out`.
