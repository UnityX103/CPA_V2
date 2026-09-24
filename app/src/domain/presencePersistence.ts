import { load } from '@tauri-apps/plugin-store';
import {
    DEFAULT_PRESENCE_ABSENCE_SENSITIVITY,
    DEFAULT_PRESENCE_ABSENCE_THRESHOLDS,
    MAX_ABSENCE_SAMPLES,
    MIN_ABSENCE_SAMPLES,
    isPresenceAbsenceSensitivity,
    type PresenceAbsenceThresholds,
    type PresenceAbsenceSensitivity,
} from './presencePolicy';

export type { PresenceAbsenceSensitivity } from './presencePolicy';
export { MIN_ABSENCE_SAMPLES, MAX_ABSENCE_SAMPLES } from './presencePolicy';

export type RestDeskReminderMode = 'cockroachInvasion';
export interface WorkstationRegion {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface PresencePreferences {
    enabled: boolean;
    inputActivityEnabled: boolean;
    cameraDeviceId: string | null;
    intervalSeconds: number;
    absenceSensitivity: PresenceAbsenceSensitivity;
    absenceThresholds: PresenceAbsenceThresholds;
    workstationRegion: WorkstationRegion | null;
    restDeskReminderEnabled: boolean;
    restDeskReminderMode: RestDeskReminderMode;
}

export const DEFAULT_PRESENCE_PREFERENCES: PresencePreferences = {
    enabled: false,
    inputActivityEnabled: false,
    cameraDeviceId: null,
    intervalSeconds: 10,
    absenceSensitivity: DEFAULT_PRESENCE_ABSENCE_SENSITIVITY,
    absenceThresholds: { ...DEFAULT_PRESENCE_ABSENCE_THRESHOLDS },
    workstationRegion: null,
    restDeskReminderEnabled: false,
    restDeskReminderMode: 'cockroachInvasion',
};

export const MIN_PRESENCE_SECONDS = 5;
export const MAX_PRESENCE_SECONDS = 600;

const STORE_PATH = 'presence-preferences.json';
const STORE_KEY = 'presencePreferences';

function normalizeSeconds(value: unknown, fallback: number): number {
    return typeof value === 'number'
        && Number.isInteger(value)
        && value >= MIN_PRESENCE_SECONDS
        && value <= MAX_PRESENCE_SECONDS
        ? value
        : fallback;
}

function normalizeAbsenceSensitivity(value: unknown): PresenceAbsenceSensitivity {
    return isPresenceAbsenceSensitivity(value)
        ? value
        : DEFAULT_PRESENCE_PREFERENCES.absenceSensitivity;
}

function normalizeCameraDeviceId(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

function normalizeAbsenceThresholds(value: unknown): PresenceAbsenceThresholds {
    const values = value && typeof value === 'object' ? value as Record<string, unknown> : {};
    return Object.fromEntries(
        (Object.keys(DEFAULT_PRESENCE_ABSENCE_THRESHOLDS) as Array<keyof PresenceAbsenceThresholds>)
            .map((key) => {
                const count = values[key];
                return [key, typeof count === 'number' && Number.isInteger(count)
                    && count >= MIN_ABSENCE_SAMPLES && count <= MAX_ABSENCE_SAMPLES
                    ? count : DEFAULT_PRESENCE_ABSENCE_THRESHOLDS[key]];
            }),
    ) as PresenceAbsenceThresholds;
}

export function normalizeWorkstationRegion(value: unknown): WorkstationRegion | null {
    if (!value || typeof value !== 'object') return null;
    const region = value as Record<string, unknown>;
    if (!['x', 'y', 'width', 'height'].every((key) => typeof region[key] === 'number'
        && Number.isFinite(region[key]) && region[key] >= 0 && region[key] <= 1)) return null;
    const { x, y, width, height } = region as unknown as WorkstationRegion;
    if (width < 0.1 || height < 0.1 || x + width > 1.000001 || y + height > 1.000001) return null;
    const round = (value: number) => Math.round(value * 10000) / 10000;
    return { x: round(x), y: round(y), width: round(width), height: round(height) };
}

export function normalizePresencePreferences(value: unknown): PresencePreferences {
    if (!value || typeof value !== 'object') {
        return { ...DEFAULT_PRESENCE_PREFERENCES, absenceThresholds: { ...DEFAULT_PRESENCE_ABSENCE_THRESHOLDS } };
    }
    const persisted = value as Record<string, unknown>;
    const enabled = typeof persisted.enabled === 'boolean'
        ? persisted.enabled
        : DEFAULT_PRESENCE_PREFERENCES.enabled;
    return {
        enabled,
        inputActivityEnabled: persisted.inputActivityEnabled === true,
        cameraDeviceId: normalizeCameraDeviceId(persisted.cameraDeviceId),
        intervalSeconds: normalizeSeconds(
            persisted.intervalSeconds,
            DEFAULT_PRESENCE_PREFERENCES.intervalSeconds,
        ),
        absenceSensitivity: normalizeAbsenceSensitivity(persisted.absenceSensitivity),
        absenceThresholds: normalizeAbsenceThresholds(persisted.absenceThresholds),
        workstationRegion: normalizeWorkstationRegion(persisted.workstationRegion),
        restDeskReminderEnabled: enabled && persisted.restDeskReminderEnabled === true,
        restDeskReminderMode: 'cockroachInvasion',
    };
}

async function openStore() {
    return load(STORE_PATH, { defaults: {}, autoSave: false });
}

export async function loadPresencePreferences(): Promise<PresencePreferences> {
    try {
        const store = await openStore();
        const value = await store.get<unknown>(STORE_KEY);
        if (!value || typeof value !== 'object') {
            return normalizePresencePreferences(null);
        }
        const schemaVersion = (value as { schemaVersion?: unknown }).schemaVersion;
        if (schemaVersion !== 1 && schemaVersion !== 2 && schemaVersion !== 3 && schemaVersion !== 4 && schemaVersion !== 5 && schemaVersion !== 6) {
            return normalizePresencePreferences(null);
        }
        return normalizePresencePreferences(value);
    } catch (error) {
        console.warn('[presencePersistence] load failed', error);
        return normalizePresencePreferences(null);
    }
}

export async function savePresencePreferences(preferences: PresencePreferences): Promise<void> {
    try {
        const store = await openStore();
        await store.set(STORE_KEY, {
            schemaVersion: 6,
            ...normalizePresencePreferences(preferences),
        });
        await store.save();
    } catch (error) {
        console.warn('[presencePersistence] save failed', error);
    }
}
