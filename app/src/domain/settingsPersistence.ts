import { load } from '@tauri-apps/plugin-store';

const STORE_PATH = 'settings.json';
const STORE_KEY = 'settings';

export interface PersistedSettings {
    uiScale: number;
    autostartEnabled: boolean;
    audioOutputDeviceId: string | null;
    soundVolume: number;
    breakPetMode: 'off' | 'cockroachInvasion';
}

interface PersistedSettingsV1 {
    v: 1;
    uiScale: number;
    autostartEnabled?: boolean;
    audioOutputDeviceId?: string | null;
    soundVolume?: number;
    breakPetMode?: 'off' | 'cockroachInvasion';
}

const obsoleteActiveTitleKey = 'showActiveApp' + 'WindowTitle';
const obsoleteAutoPinKey = 'autoPinOn' + 'FocusEnd';

function isPersistedSettingsV1(value: unknown): value is PersistedSettingsV1 {
    if (!value || typeof value !== 'object') return false;
    const candidate = value as Partial<PersistedSettingsV1>;
    const obsoleteTitleValue = (candidate as Record<string, unknown>)[obsoleteActiveTitleKey];
    const obsoleteAutoPinValue = (candidate as Record<string, unknown>)[obsoleteAutoPinKey];
    return candidate.v === 1
        && typeof candidate.uiScale === 'number'
        && Number.isFinite(candidate.uiScale)
        && (
            obsoleteTitleValue === undefined
            || typeof obsoleteTitleValue === 'boolean'
        )
        && (
            candidate.autostartEnabled === undefined
            || typeof candidate.autostartEnabled === 'boolean'
        )
        && (
            candidate.audioOutputDeviceId === undefined
            || candidate.audioOutputDeviceId === null
            || typeof candidate.audioOutputDeviceId === 'string'
        )
        && (
            candidate.soundVolume === undefined
            || (typeof candidate.soundVolume === 'number' && Number.isFinite(candidate.soundVolume))
        )
        && (
            candidate.breakPetMode === undefined
            || candidate.breakPetMode === 'off'
            || candidate.breakPetMode === 'cockroachInvasion'
        )
        && (
            obsoleteAutoPinValue === undefined
            || typeof obsoleteAutoPinValue === 'boolean'
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
            autostartEnabled: value.autostartEnabled ?? false,
            audioOutputDeviceId: value.audioOutputDeviceId?.trim() || null,
            soundVolume: Math.max(0, Math.min(1, value.soundVolume ?? 1)),
            breakPetMode: value.breakPetMode === 'cockroachInvasion' ? 'cockroachInvasion' : 'off',
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
            autostartEnabled: settings.autostartEnabled,
            audioOutputDeviceId: settings.audioOutputDeviceId,
            soundVolume: settings.soundVolume,
            breakPetMode: settings.breakPetMode,
        } satisfies PersistedSettingsV1);
        await store.save();
    } catch (err) {
        console.warn('[settingsPersistence] save failed', err);
    }
}
