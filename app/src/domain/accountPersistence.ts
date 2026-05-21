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
