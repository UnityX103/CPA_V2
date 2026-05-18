import { load } from '@tauri-apps/plugin-store';

const STORE_PATH = 'app-update.json';
const STORE_KEY = 'appUpdate';

export interface PersistedAppUpdateSettings {
    autoUpdateEnabled: boolean;
}

interface PersistedAppUpdateSettingsV1 {
    v: 1;
    autoUpdateEnabled: boolean;
}

function isPersistedAppUpdateSettingsV1(value: unknown): value is PersistedAppUpdateSettingsV1 {
    if (!value || typeof value !== 'object') return false;
    const candidate = value as Partial<PersistedAppUpdateSettingsV1>;
    return candidate.v === 1 && typeof candidate.autoUpdateEnabled === 'boolean';
}

async function openStore() {
    return load(STORE_PATH, { defaults: {}, autoSave: false });
}

export async function loadPersistedAppUpdateSettings(): Promise<PersistedAppUpdateSettings> {
    try {
        const store = await openStore();
        const value = await store.get<unknown>(STORE_KEY);
        if (!isPersistedAppUpdateSettingsV1(value)) {
            return { autoUpdateEnabled: true };
        }
        return { autoUpdateEnabled: value.autoUpdateEnabled };
    } catch (err) {
        console.warn('[appUpdatePersistence] load failed', err);
        return { autoUpdateEnabled: true };
    }
}

export async function savePersistedAppUpdateSettings(settings: PersistedAppUpdateSettings): Promise<void> {
    try {
        const store = await openStore();
        await store.set(STORE_KEY, {
            v: 1,
            autoUpdateEnabled: settings.autoUpdateEnabled,
        } satisfies PersistedAppUpdateSettingsV1);
        await store.save();
    } catch (err) {
        console.warn('[appUpdatePersistence] save failed', err);
    }
}
