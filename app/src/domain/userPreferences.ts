import type { StoreApi, UseBoundStore } from 'zustand';
import type {
    BindingInput,
    BindingKeyEntry,
} from './bindingKey';
import type { NetworkStateShape } from './network';
import type {
    PomodoroEndActionMode,
    PomodoroEndActionVideo,
    PomodoroState,
} from './pomodoro';
import type { BreakPetMode, PersistedSettingsSnapshot, SettingsState } from './settings';
import type { AppUpdateSnapshot } from './appUpdate';
import {
    clonePomodoroEndSounds,
    DEFAULT_POMODORO_END_SOUNDS,
    normalizePomodoroSoundSelection,
    type PomodoroEndSounds,
} from './pomodoroSounds';

export interface PersistedBindingKeyEntry {
    id: string;
    label: string;
    keyCode: number;
    input: BindingInput | null;
    enabled: boolean;
}

export interface UserPreferencesSnapshot {
    schemaVersion: 1;
    pomodoro: {
        focusDurationSeconds: number;
        breakDurationSeconds: number;
        totalRounds: number;
        autoStartBreak: boolean;
        autoPinAfterFocus: boolean;
        endActionMode: PomodoroEndActionMode;
        endActionVideo: PomodoroEndActionVideo;
        endSounds: PomodoroEndSounds;
    };
    settings: {
        uiScale: number;
        autostartEnabled: boolean;
        breakPetMode?: BreakPetMode;
    };
    appUpdate: {
        autoUpdateEnabled: boolean;
    };
    network: {
        autoConnect: boolean;
        playerName: string;
    };
    bindingKey: {
        panelEnabled: boolean;
        entries: PersistedBindingKeyEntry[];
        syncedKeyId: string | null;
    };
}

type Store<T> = UseBoundStore<StoreApi<T>>;

interface PomodoroStoreShape extends PomodoroState {
    applySettings: (
        focusSeconds: number,
        breakSeconds: number,
        totalRounds: number,
        resetProgress: boolean,
        autoStartBreak: boolean,
    ) => void;
    setAutoPinAfterFocus: (enabled: boolean) => void;
    applyEndActionSettings: (
        mode: PomodoroEndActionMode,
        video: PomodoroEndActionVideo,
    ) => Promise<void> | void;
    applyEndSoundSettings: (sounds: PomodoroEndSounds) => Promise<void> | void;
}

interface SettingsStoreShape extends SettingsState {
    hydrateSettings: (snapshot: PersistedSettingsSnapshot) => void;
}

interface AppUpdateStoreShape extends AppUpdateSnapshot {}

interface BindingKeyStoreShape {
    panelEnabled: boolean;
    entries: BindingKeyEntry[];
    syncedKeyId: string | null;
    capturingId: string | null;
}

export interface UserPreferencesStores {
    pomodoro: Store<PomodoroStoreShape>;
    settings: Store<SettingsStoreShape>;
    appUpdate: Store<AppUpdateStoreShape>;
    network: Store<NetworkStateShape>;
    bindingKey: Store<BindingKeyStoreShape>;
}

const DEFAULT_FOCUS_SECONDS = 25 * 60;
const DEFAULT_BREAK_SECONDS = 5 * 60;
const DEFAULT_TOTAL_ROUNDS = 4;
const DEFAULT_END_ACTION_MODE: PomodoroEndActionMode = 'playVideo';
const DEFAULT_END_ACTION_VIDEO: PomodoroEndActionVideo = {
    sourceKind: 'builtin',
    builtinVideoId: 'qianqian',
    customVideoPath: '',
};

export function defaultUserPreferencesSnapshot(): UserPreferencesSnapshot {
    return {
        schemaVersion: 1,
        pomodoro: {
            focusDurationSeconds: DEFAULT_FOCUS_SECONDS,
            breakDurationSeconds: DEFAULT_BREAK_SECONDS,
            totalRounds: DEFAULT_TOTAL_ROUNDS,
            autoStartBreak: false,
            autoPinAfterFocus: true,
            endActionMode: DEFAULT_END_ACTION_MODE,
            endActionVideo: { ...DEFAULT_END_ACTION_VIDEO },
            endSounds: clonePomodoroEndSounds(DEFAULT_POMODORO_END_SOUNDS),
        },
        settings: {
            uiScale: 1,
            autostartEnabled: false,
            breakPetMode: 'off',
        },
        appUpdate: {
            autoUpdateEnabled: true,
        },
        network: {
            autoConnect: false,
            playerName: '我',
        },
        bindingKey: {
            panelEnabled: true,
            entries: [],
            syncedKeyId: null,
        },
    };
}

export function buildUserPreferencesSnapshot(stores: UserPreferencesStores): UserPreferencesSnapshot {
    const pomodoro = stores.pomodoro.getState();
    const settings = stores.settings.getState();
    const appUpdate = stores.appUpdate.getState();
    const network = stores.network.getState();
    const bindingKey = stores.bindingKey.getState();

    return {
        schemaVersion: 1,
        pomodoro: {
            focusDurationSeconds: pomodoro.focusDurationSeconds,
            breakDurationSeconds: pomodoro.breakDurationSeconds,
            totalRounds: pomodoro.totalRounds,
            autoStartBreak: pomodoro.autoStartBreak,
            autoPinAfterFocus: pomodoro.autoPinAfterFocus,
            endActionMode: pomodoro.endActionMode,
            endActionVideo: { ...pomodoro.endActionVideo },
            endSounds: clonePomodoroEndSounds(pomodoro.endSounds),
        },
        settings: {
            uiScale: settings.committedUiScale,
            autostartEnabled: settings.autostartEnabled,
            breakPetMode: settings.breakPetMode,
        },
        appUpdate: {
            autoUpdateEnabled: appUpdate.autoUpdateEnabled,
        },
        network: {
            autoConnect: network.autoConnect,
            playerName: network.playerName,
        },
        bindingKey: {
            panelEnabled: bindingKey.panelEnabled,
            entries: bindingKey.entries.map(persistedBindingEntry),
            syncedKeyId: bindingKey.syncedKeyId,
        },
    };
}

export function hydrateUserPreferencesSnapshot({ stores, snapshot }: {
    stores: UserPreferencesStores;
    snapshot: UserPreferencesSnapshot;
}): void {
    stores.pomodoro.getState().applySettings(
        snapshot.pomodoro.focusDurationSeconds,
        snapshot.pomodoro.breakDurationSeconds,
        snapshot.pomodoro.totalRounds,
        false,
        snapshot.pomodoro.autoStartBreak,
    );
    stores.pomodoro.getState().setAutoPinAfterFocus(snapshot.pomodoro.autoPinAfterFocus);
    void stores.pomodoro.getState().applyEndActionSettings(
        snapshot.pomodoro.endActionMode,
        { ...snapshot.pomodoro.endActionVideo },
    );
    void stores.pomodoro.getState().applyEndSoundSettings(
        clonePomodoroEndSounds(snapshot.pomodoro.endSounds),
    );
    stores.settings.getState().hydrateSettings(snapshot.settings);
    stores.appUpdate.setState((state) => ({
        autoUpdateEnabled: snapshot.appUpdate.autoUpdateEnabled,
        status: state.status === 'readyToRestart'
            ? state.status
            : snapshot.appUpdate.autoUpdateEnabled ? 'idle' : 'disabled',
        errorMessage: null,
    }));
    stores.network.setState({
        autoConnect: snapshot.network.autoConnect,
        playerName: snapshot.network.playerName,
    });
    stores.bindingKey.setState({
        panelEnabled: snapshot.bindingKey.panelEnabled,
        entries: snapshot.bindingKey.entries.map((entry) => ({ ...entry, pressCount: 0 })),
        syncedKeyId: snapshot.bindingKey.syncedKeyId,
        capturingId: null,
    });
}

export function userPreferencesKey(snapshot: UserPreferencesSnapshot): string {
    return JSON.stringify(snapshot);
}

export function normalizeUserPreferencesSnapshot(
    value: unknown,
    fallback: UserPreferencesSnapshot = defaultUserPreferencesSnapshot(),
): UserPreferencesSnapshot | null {
    if (!isObject(value) || value.schemaVersion !== 1) return null;

    const pomodoro = normalizePomodoro(value.pomodoro, fallback.pomodoro);
    const settings = normalizeSettings(value.settings, fallback.settings);
    const appUpdate = normalizeAppUpdate(value.appUpdate, fallback.appUpdate);
    const network = normalizeNetwork(value.network, fallback.network);
    const bindingKey = normalizeBindingKey(value.bindingKey, fallback.bindingKey);

    return {
        schemaVersion: 1,
        pomodoro,
        settings,
        appUpdate,
        network,
        bindingKey,
    };
}

function persistedBindingEntry(entry: BindingKeyEntry): PersistedBindingKeyEntry {
    return {
        id: entry.id,
        label: entry.label,
        keyCode: entry.keyCode,
        input: cloneInput(normalizeInput(entry.input)),
        enabled: entry.enabled,
    };
}

function normalizePomodoro(
    value: unknown,
    fallback: UserPreferencesSnapshot['pomodoro'],
): UserPreferencesSnapshot['pomodoro'] {
    if (!isObject(value)) return fallback;
    const endActionVideo = normalizeEndActionVideo(value.endActionVideo, fallback.endActionVideo);
    const endSounds = normalizeEndSounds(value.endSounds, fallback.endSounds);
    return {
        focusDurationSeconds: normalizePositiveInteger(value.focusDurationSeconds, fallback.focusDurationSeconds),
        breakDurationSeconds: normalizeNonNegativeInteger(value.breakDurationSeconds, fallback.breakDurationSeconds),
        totalRounds: normalizePositiveInteger(value.totalRounds, fallback.totalRounds),
        autoStartBreak: typeof value.autoStartBreak === 'boolean' ? value.autoStartBreak : fallback.autoStartBreak,
        autoPinAfterFocus: typeof value.autoPinAfterFocus === 'boolean'
            ? value.autoPinAfterFocus
            : fallback.autoPinAfterFocus,
        endActionMode: value.endActionMode === 'topWindow' || value.endActionMode === 'playVideo'
            ? value.endActionMode
            : fallback.endActionMode,
        endActionVideo,
        endSounds,
    };
}

function normalizeEndSounds(
    value: unknown,
    fallback: PomodoroEndSounds,
): PomodoroEndSounds {
    if (!isObject(value)) return clonePomodoroEndSounds(fallback);
    return {
        focus: normalizePomodoroSoundSelection(value.focus, fallback.focus, 'focus'),
        break: normalizePomodoroSoundSelection(value.break, fallback.break, 'break'),
    };
}

function normalizeEndActionVideo(
    value: unknown,
    fallback: PomodoroEndActionVideo,
): PomodoroEndActionVideo {
    if (!isObject(value)) return { ...fallback };
    return {
        sourceKind: value.sourceKind === 'custom' ? 'custom' : 'builtin',
        builtinVideoId: typeof value.builtinVideoId === 'string' && value.builtinVideoId
            ? value.builtinVideoId
            : fallback.builtinVideoId,
        customVideoPath: typeof value.customVideoPath === 'string'
            ? value.customVideoPath
            : fallback.customVideoPath,
    };
}

function normalizeSettings(
    value: unknown,
    fallback: UserPreferencesSnapshot['settings'],
): UserPreferencesSnapshot['settings'] {
    if (!isObject(value)) return fallback;
    return {
        uiScale: typeof value.uiScale === 'number' && Number.isFinite(value.uiScale)
            ? Math.max(0.5, Math.min(2, value.uiScale))
            : fallback.uiScale,
        autostartEnabled: typeof value.autostartEnabled === 'boolean'
            ? value.autostartEnabled
            : fallback.autostartEnabled,
        breakPetMode: value.breakPetMode === 'cockroachInvasion' ? 'cockroachInvasion' : 'off',
    };
}

function normalizeAppUpdate(
    value: unknown,
    fallback: UserPreferencesSnapshot['appUpdate'],
): UserPreferencesSnapshot['appUpdate'] {
    if (!isObject(value)) return fallback;
    return {
        autoUpdateEnabled: typeof value.autoUpdateEnabled === 'boolean'
            ? value.autoUpdateEnabled
            : fallback.autoUpdateEnabled,
    };
}

function normalizeNetwork(
    value: unknown,
    fallback: UserPreferencesSnapshot['network'],
): UserPreferencesSnapshot['network'] {
    if (!isObject(value)) return fallback;
    const playerName = typeof value.playerName === 'string' && value.playerName.trim()
        ? value.playerName.trim()
        : fallback.playerName;
    return {
        autoConnect: typeof value.autoConnect === 'boolean' ? value.autoConnect : fallback.autoConnect,
        playerName,
    };
}

function normalizeBindingKey(
    value: unknown,
    fallback: UserPreferencesSnapshot['bindingKey'],
): UserPreferencesSnapshot['bindingKey'] {
    if (!isObject(value)) return fallback;
    const entries = Array.isArray(value.entries)
        ? value.entries.map(normalizeBindingEntry).filter((entry): entry is PersistedBindingKeyEntry => entry !== null)
        : fallback.entries;
    const syncedKeyId = typeof value.syncedKeyId === 'string'
        && entries.some((entry) => entry.id === value.syncedKeyId)
        ? value.syncedKeyId
        : null;
    return {
        panelEnabled: typeof value.panelEnabled === 'boolean' ? value.panelEnabled : fallback.panelEnabled,
        entries,
        syncedKeyId,
    };
}

function normalizeBindingEntry(value: unknown): PersistedBindingKeyEntry | null {
    if (!isObject(value)) return null;
    if (typeof value.id !== 'string' || !value.id) return null;
    if (typeof value.label !== 'string') return null;
    if (typeof value.keyCode !== 'number' || !Number.isInteger(value.keyCode)) return null;
    const input = normalizeInput(value.input);
    if (value.input != null && !input) return null;
    return {
        id: value.id,
        label: value.label,
        keyCode: value.keyCode,
        input,
        enabled: typeof value.enabled === 'boolean' ? value.enabled : true,
    };
}

function normalizeInput(value: unknown): BindingInput | null {
    if (!isObject(value)) return null;
    if (value.kind === 'keyboard' && typeof value.code === 'number' && Number.isInteger(value.code) && value.code >= 0) {
        return { kind: 'keyboard', code: value.code };
    }
    if (
        value.kind === 'mouse' &&
        (value.button === 'left' || value.button === 'middle' || value.button === 'right')
    ) {
        return { kind: 'mouse', button: value.button };
    }
    return null;
}

function normalizePositiveInteger(value: unknown, fallback: number): number {
    return typeof value === 'number' && Number.isInteger(value) && value >= 1 ? value : fallback;
}

function normalizeNonNegativeInteger(value: unknown, fallback: number): number {
    return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : fallback;
}

function isObject(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function cloneInput(input: BindingInput | null): BindingInput | null {
    return input ? { ...input } : null;
}
