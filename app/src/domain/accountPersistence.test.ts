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
