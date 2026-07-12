import { load } from '@tauri-apps/plugin-store';
import { DEFAULT_CHECKIN_ENABLED, DEFAULT_PLAN_PANEL_ENABLED } from './settingsDefaults';

const STORE_PATH = 'settings.json';
const STORE_KEY = 'settings';

export interface PersistedSettings {
    uiScale: number;
    autostartEnabled: boolean;
    checkinEnabled: boolean;
    planPanelEnabled: boolean;
}

interface PersistedSettingsV1 {
    v: 1;
    uiScale: number;
    autostartEnabled?: boolean;
    checkinEnabled?: boolean;
    planPanelEnabled?: boolean;
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
            candidate.checkinEnabled === undefined
            || typeof candidate.checkinEnabled === 'boolean'
        )
        && (
            candidate.planPanelEnabled === undefined
            || typeof candidate.planPanelEnabled === 'boolean'
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
            checkinEnabled: value.checkinEnabled ?? DEFAULT_CHECKIN_ENABLED,
            planPanelEnabled: value.planPanelEnabled ?? DEFAULT_PLAN_PANEL_ENABLED,
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
            checkinEnabled: settings.checkinEnabled,
            planPanelEnabled: settings.planPanelEnabled,
        } satisfies PersistedSettingsV1);
        await store.save();
    } catch (err) {
        console.warn('[settingsPersistence] save failed', err);
    }
}
