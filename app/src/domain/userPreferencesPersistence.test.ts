import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultUserPreferencesSnapshot, normalizeUserPreferencesSnapshot } from './userPreferences';
import { loadPersistedUserPreferences, savePersistedUserPreferences } from './userPreferencesPersistence';

const store = vi.hoisted(() => ({
    get: vi.fn(),
    set: vi.fn(),
    save: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-store', () => ({
    load: vi.fn(async () => store),
}));

beforeEach(() => {
    store.get.mockReset();
    store.set.mockReset();
    store.save.mockReset();
});

describe('user preferences persistence', () => {
    it.each([true, false])('persists and reloads automatic start=%s', async (enabled) => {
        const snapshot = defaultUserPreferencesSnapshot();
        snapshot.pomodoro.autoStartOnLaunch = enabled;
        await savePersistedUserPreferences(snapshot);
        store.get.mockResolvedValue(store.set.mock.calls[0][1]);
        expect((await loadPersistedUserPreferences())?.pomodoro.autoStartOnLaunch).toBe(enabled);
    });

    it.each([undefined, null, 'true', 1])('defaults missing or invalid automatic start to false (%s)', (value) => {
        const snapshot = defaultUserPreferencesSnapshot();
        const fallback = defaultUserPreferencesSnapshot();
        fallback.pomodoro.autoStartOnLaunch = true;
        const legacy = {
            ...snapshot,
            pomodoro: { ...snapshot.pomodoro, autoStartOnLaunch: value },
        };
        expect(normalizeUserPreferencesSnapshot(legacy, fallback)?.pomodoro.autoStartOnLaunch).toBe(false);
    });

    it('normalizes retained fields', () => {
        const input = {
            ...defaultUserPreferencesSnapshot(),
            settings: { uiScale: 1.25, autostartEnabled: true },
        };

        const normalized = normalizeUserPreferencesSnapshot(input);

        expect(normalized?.settings).toEqual({
            uiScale: 1.25,
            autostartEnabled: true,
            breakPetMode: 'off',
        });
        expect(normalized?.pomodoro.endActionMode).toBe('playVideo');
        expect(normalized?.pomodoro.playVideoOnBreakEnd).toBe(false);
        expect(normalized?.pomodoro.endActionVideo).toEqual({
            sourceKind: 'builtin',
            builtinVideoId: 'qianqian',
            customVideoPath: '',
        });
        expect(normalized?.pomodoro.endSounds).toEqual({
            focus: { sourceKind: 'builtin', builtinSoundId: 'clear-success', customSoundPath: '' },
            break: { sourceKind: 'builtin', builtinSoundId: 'triple-ping', customSoundPath: '' },
        });
    });

    it('loads normalized preferences', async () => {
        store.get.mockResolvedValue(defaultUserPreferencesSnapshot());

        await expect(loadPersistedUserPreferences()).resolves.toEqual(defaultUserPreferencesSnapshot());
    });

    it('adds default end sounds when loading an older schema-v1 snapshot', () => {
        const legacy = defaultUserPreferencesSnapshot() as unknown as {
            pomodoro: Record<string, unknown>;
        };
        delete legacy.pomodoro.endSounds;

        expect(normalizeUserPreferencesSnapshot(legacy)?.pomodoro.endSounds).toEqual({
            focus: { sourceKind: 'builtin', builtinSoundId: 'clear-success', customSoundPath: '' },
            break: { sourceKind: 'builtin', builtinSoundId: 'triple-ping', customSoundPath: '' },
        });
    });

    it('saves the retained schema', async () => {
        const snapshot = defaultUserPreferencesSnapshot();

        await savePersistedUserPreferences(snapshot);

        expect(store.set).toHaveBeenCalledWith('userPreferences', snapshot);
        expect(store.save).toHaveBeenCalledTimes(1);
    });

    it.each([true, false])('persists and reloads break-end video=%s', async (enabled) => {
        const snapshot = defaultUserPreferencesSnapshot();
        snapshot.pomodoro.playVideoOnBreakEnd = enabled;
        await savePersistedUserPreferences(snapshot);
        store.get.mockResolvedValue(store.set.mock.calls[0][1]);

        expect((await loadPersistedUserPreferences())?.pomodoro.playVideoOnBreakEnd).toBe(enabled);
    });

    it.each([undefined, null, 'true', 1])('defaults missing or invalid break-end video to false (%s)', (value) => {
        const snapshot = defaultUserPreferencesSnapshot();
        const fallback = defaultUserPreferencesSnapshot();
        fallback.pomodoro.playVideoOnBreakEnd = true;
        const legacy = {
            ...snapshot,
            pomodoro: { ...snapshot.pomodoro, playVideoOnBreakEnd: value },
        };
        expect(normalizeUserPreferencesSnapshot(legacy, fallback)?.pomodoro.playVideoOnBreakEnd).toBe(false);
    });
});
