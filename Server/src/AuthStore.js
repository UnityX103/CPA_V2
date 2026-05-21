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

        return {
            user: {
                userId: session.userId,
                username: session.username
            },
            token: normalizedToken
        };
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
