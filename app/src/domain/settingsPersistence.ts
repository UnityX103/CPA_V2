import { load } from '@tauri-apps/plugin-store';

const STORE_PATH = 'settings.json';
const STORE_KEY = 'settings';

export interface PersistedSettings {
    uiScale: number;
    showActiveAppWindowTitle: boolean;
    autostartEnabled: boolean;
    autoPinOnFocusEnd: boolean;
}

interface PersistedSettingsV1 {
    v: 1;
    uiScale: number;
    showActiveAppWindowTitle?: boolean;
    autostartEnabled?: boolean;
    autoPinOnFocusEnd?: boolean;
}

function isPersistedSettingsV1(value: unknown): value is PersistedSettingsV1 {
    if (!value || typeof value !== 'object') return false;
    const candidate = value as Partial<PersistedSettingsV1>;
    return candidate.v === 1
        && typeof candidate.uiScale === 'number'
        && Number.isFinite(candidate.uiScale)
        && (
            candidate.showActiveAppWindowTitle === undefined
            || typeof candidate.showActiveAppWindowTitle === 'boolean'
        )
        && (
            candidate.autostartEnabled === undefined
            || typeof candidate.autostartEnabled === 'boolean'
        )
        && (
            candidate.autoPinOnFocusEnd === undefined
            || typeof candidate.autoPinOnFocusEnd === 'boolean'
        );
}

async function openStore() {
    return load(STORE_PATH, { defaults: {}, autoSave: false });
}

export async function loadPersistedSettings(): Promise<PersistedSettings | null> {
    try {
        const store = await openStore();
        const value = await store.get<unknown>(STORE_KEY);
        if (!isPersistedSettingsV1(value)) return null;
        return {
            uiScale: value.uiScale,
            showActiveAppWindowTitle: value.showActiveAppWindowTitle ?? true,
            autostartEnabled: value.autostartEnabled ?? false,
            autoPinOnFocusEnd: value.autoPinOnFocusEnd ?? true,
        };
    } catch (err) {
        console.warn('[settingsPersistence] load failed', err);
        return null;
    }
}

export async function savePersistedSettings(settings: PersistedSettings): Promise<void> {
    try {
        const store = await openStore();
        await store.set(STORE_KEY, {
            v: 1,
            uiScale: settings.uiScale,
            showActiveAppWindowTitle: settings.showActiveAppWindowTitle,
            autostartEnabled: settings.autostartEnabled,
            autoPinOnFocusEnd: settings.autoPinOnFocusEnd,
        } satisfies PersistedSettingsV1);
        await store.save();
    } catch (err) {
        console.warn('[settingsPersistence] save failed', err);
    }
}
