import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = {
    get: vi.fn(),
    set: vi.fn(),
    save: vi.fn(),
};

vi.mock('@tauri-apps/plugin-store', () => ({
    load: vi.fn(() => Promise.resolve(store)),
}));

describe('remotePlayerCardPositions', () => {
    beforeEach(() => {
        store.get.mockReset();
        store.set.mockReset();
        store.save.mockReset();
        vi.resetModules();
    });

    it('loads only valid finite numeric player card positions', async () => {
        store.get.mockResolvedValue({
            v: 1,
            positions: {
                p1: { x: 10, y: 20 },
                p2: { x: -5.5, y: 0 },
                badString: { x: 'left', y: 20 },
                badInfinity: { x: Infinity, y: 20 },
                badMissingY: { x: 12 },
            },
        });

        const { loadRemotePlayerCardPositions } = await import('./remotePlayerCardPositions');

        await expect(loadRemotePlayerCardPositions()).resolves.toEqual({
            p1: { x: 10, y: 20 },
            p2: { x: -5.5, y: 0 },
        });
    });

    it('returns an empty map for malformed root payloads', async () => {
        store.get.mockResolvedValue({ v: 2, positions: { p1: { x: 10, y: 20 } } });

        const { loadRemotePlayerCardPositions } = await import('./remotePlayerCardPositions');

        await expect(loadRemotePlayerCardPositions()).resolves.toEqual({});
    });

    it('saves positions as a v1 payload', async () => {
        store.get.mockResolvedValue(undefined);
        const { saveRemotePlayerCardPosition } = await import('./remotePlayerCardPositions');

        await saveRemotePlayerCardPosition('p1', { x: 30, y: 40 });

        expect(store.set).toHaveBeenCalledWith('remotePlayerCardPositions', {
            v: 1,
            positions: {
                p1: { x: 30, y: 40 },
            },
        });
        expect(store.save).toHaveBeenCalledTimes(1);
    });

    it('merges saved positions with existing persisted positions', async () => {
        store.get.mockResolvedValue({
            v: 1,
            positions: {
                p1: { x: 10, y: 20 },
            },
        });
        const { saveRemotePlayerCardPosition } = await import('./remotePlayerCardPositions');

        await saveRemotePlayerCardPosition('p2', { x: 30, y: 40 });

        expect(store.set).toHaveBeenCalledWith('remotePlayerCardPositions', {
            v: 1,
            positions: {
                p1: { x: 10, y: 20 },
                p2: { x: 30, y: 40 },
            },
        });
        expect(store.save).toHaveBeenCalledTimes(1);
    });

    it('serializes concurrent saves so the final payload keeps both player positions', async () => {
        let persisted: unknown;
        store.get.mockImplementation(() => Promise.resolve(persisted));
        store.set.mockImplementation((_, value) => {
            persisted = value;
            return Promise.resolve();
        });
        const { saveRemotePlayerCardPosition } = await import('./remotePlayerCardPositions');

        const firstSave = saveRemotePlayerCardPosition('p1', { x: 10, y: 20 });
        const secondSave = saveRemotePlayerCardPosition('p2', { x: 30, y: 40 });

        await Promise.all([firstSave, secondSave]);

        expect(persisted).toEqual({
            v: 1,
            positions: {
                p1: { x: 10, y: 20 },
                p2: { x: 30, y: 40 },
            },
        });
    });
});
