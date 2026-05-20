import { load } from '@tauri-apps/plugin-store';

const STORE_PATH = 'settings.json';
const STORE_KEY = 'remotePlayerCardPositions';

export interface RemotePlayerCardPosition {
    x: number;
    y: number;
}

export type RemotePlayerCardPositions = Record<string, RemotePlayerCardPosition>;

interface PersistedRemotePlayerCardPositionsV1 {
    v: 1;
    positions: RemotePlayerCardPositions;
}

let saveQueue: Promise<void> = Promise.resolve();

function isRemotePlayerCardPosition(value: unknown): value is RemotePlayerCardPosition {
    if (!value || typeof value !== 'object') return false;

    const candidate = value as Partial<RemotePlayerCardPosition>;
    return typeof candidate.x === 'number'
        && Number.isFinite(candidate.x)
        && typeof candidate.y === 'number'
        && Number.isFinite(candidate.y);
}

function normalizePositions(value: unknown): RemotePlayerCardPositions {
    if (!value || typeof value !== 'object') return {};

    const candidate = value as Partial<PersistedRemotePlayerCardPositionsV1>;
    if (candidate.v !== 1 || !candidate.positions || typeof candidate.positions !== 'object') {
        return {};
    }

    return Object.fromEntries(
        Object.entries(candidate.positions)
            .filter(([, position]) => isRemotePlayerCardPosition(position)),
    );
}

async function openStore() {
    return load(STORE_PATH, { defaults: {}, autoSave: false });
}

export async function loadRemotePlayerCardPositions(): Promise<RemotePlayerCardPositions> {
    try {
        const store = await openStore();
        return normalizePositions(await store.get<unknown>(STORE_KEY));
    } catch (err) {
        console.warn('[remotePlayerCardPositions] load failed', err);
        return {};
    }
}

export async function saveRemotePlayerCardPosition(
    playerId: string,
    position: RemotePlayerCardPosition,
): Promise<void> {
    const save = () => saveRemotePlayerCardPositionNow(playerId, position);
    saveQueue = saveQueue.then(save, save);
    await saveQueue;
}

async function saveRemotePlayerCardPositionNow(
    playerId: string,
    position: RemotePlayerCardPosition,
): Promise<void> {
    try {
        const store = await openStore();
        const positions = normalizePositions(await store.get<unknown>(STORE_KEY));
        const next = {
            ...positions,
            [playerId]: position,
        };

        await store.set(STORE_KEY, {
            v: 1,
            positions: next,
        } satisfies PersistedRemotePlayerCardPositionsV1);
        await store.save();
    } catch (err) {
        console.warn('[remotePlayerCardPositions] save failed', err);
    }
}
