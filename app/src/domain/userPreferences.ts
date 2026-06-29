import type { StoreApi, UseBoundStore } from 'zustand';
import type {
    BindingInput,
    BindingKeyEntry,
} from './bindingKey';
import type {
    CheckinDayPlan,
    CheckinItemIcon,
    CheckinPlanTemplate,
    DailyCheckinRecord,
    LegacyCheckinItem,
    WeekdayKey,
    WeeklyCheckinPlan,
} from './checkin';
import {
    clonePlanTemplate,
    defaultPlanTemplate,
    migrateWeeklyPlanToTemplate,
    normalizePlanTemplate,
} from './checkin';
import type { NetworkStateShape } from './network';
import type {
    PomodoroEndActionMode,
    PomodoroEndActionVideo,
    PomodoroState,
} from './pomodoro';
import { DEFAULT_BUILTIN_POMODORO_VIDEO_ID } from './pomodoroVideos';
import type { PersistedSettingsSnapshot, SettingsState } from './settings';
import type { AppUpdateSnapshot } from './appUpdate';

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
    };
    settings: {
        uiScale: number;
        autostartEnabled: boolean;
        checkinEnabled: boolean;
        planPanelEnabled: boolean;
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
    checkin: {
        planTemplate: CheckinPlanTemplate;
        dailyRecords: Record<string, DailyCheckinRecord>;
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
    applyEndActionSettings: (mode: PomodoroEndActionMode, video: PomodoroEndActionVideo) => void;
    setAutoPinAfterFocus: (enabled: boolean) => void;
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

interface CheckinStoreShape {
    planTemplate: CheckinPlanTemplate;
    dailyRecords: Record<string, DailyCheckinRecord>;
    hydrateCheckin: (snapshot: Pick<CheckinStoreShape, 'planTemplate' | 'dailyRecords'>) => void;
}

export interface UserPreferencesStores {
    pomodoro: Store<PomodoroStoreShape>;
    settings: Store<SettingsStoreShape>;
    appUpdate: Store<AppUpdateStoreShape>;
    network: Store<NetworkStateShape>;
    bindingKey: Store<BindingKeyStoreShape>;
    checkin: Store<CheckinStoreShape>;
}

const DEFAULT_FOCUS_SECONDS = 25 * 60;
const DEFAULT_BREAK_SECONDS = 5 * 60;
const DEFAULT_TOTAL_ROUNDS = 4;
const DEFAULT_END_ACTION_MODE: PomodoroEndActionMode = 'playVideo';
const CHECKIN_ITEM_ICONS = new Set<CheckinItemIcon>([
    'activity',
    'dumbbell',
    'bookOpen',
    'droplet',
    'listChecks',
    'sparkle',
    'coffee',
    'moon',
    'sun',
    'leaf',
    'music',
    'pencil',
    'target',
    'flame',
    'heart',
    'apple',
    'clock',
    'meditation',
]);
const WEEKDAYS: WeekdayKey[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

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
            endActionVideo: {
                sourceKind: 'builtin',
                builtinVideoId: DEFAULT_BUILTIN_POMODORO_VIDEO_ID,
                customVideoPath: '',
            },
        },
        settings: {
            uiScale: 1,
            autostartEnabled: false,
            checkinEnabled: true,
            planPanelEnabled: true,
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
        checkin: {
            planTemplate: defaultPlanTemplate(),
            dailyRecords: {},
        },
    };
}

export function buildUserPreferencesSnapshot(stores: UserPreferencesStores): UserPreferencesSnapshot {
    const pomodoro = stores.pomodoro.getState();
    const settings = stores.settings.getState();
    const appUpdate = stores.appUpdate.getState();
    const network = stores.network.getState();
    const bindingKey = stores.bindingKey.getState();
    const checkin = stores.checkin.getState();

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
        },
        settings: {
            uiScale: settings.committedUiScale,
            autostartEnabled: settings.autostartEnabled,
            checkinEnabled: settings.checkinEnabled,
            planPanelEnabled: settings.planPanelEnabled,
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
        checkin: {
            planTemplate: clonePlanTemplate(checkin.planTemplate),
            dailyRecords: cloneDailyRecords(checkin.dailyRecords),
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
    stores.pomodoro.getState().applyEndActionSettings(
        snapshot.pomodoro.endActionMode,
        { ...snapshot.pomodoro.endActionVideo },
    );
    stores.pomodoro.getState().setAutoPinAfterFocus(snapshot.pomodoro.autoPinAfterFocus);
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
    stores.checkin.getState().hydrateCheckin({
        planTemplate: clonePlanTemplate(snapshot.checkin.planTemplate),
        dailyRecords: cloneDailyRecords(snapshot.checkin.dailyRecords),
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
    const checkin = normalizeCheckin(value.checkin, fallback.checkin);

    return {
        schemaVersion: 1,
        pomodoro,
        settings,
        appUpdate,
        network,
        bindingKey,
        checkin,
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
    };
}

function normalizeEndActionVideo(value: unknown, fallback: PomodoroEndActionVideo): PomodoroEndActionVideo {
    if (!isObject(value)) return { ...fallback };
    return {
        sourceKind: value.sourceKind === 'custom' ? 'custom' : 'builtin',
        builtinVideoId: typeof value.builtinVideoId === 'string' && value.builtinVideoId
            ? value.builtinVideoId
            : fallback.builtinVideoId,
        customVideoPath: typeof value.customVideoPath === 'string' ? value.customVideoPath : fallback.customVideoPath,
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
        checkinEnabled: typeof value.checkinEnabled === 'boolean'
            ? value.checkinEnabled
            : fallback.checkinEnabled,
        planPanelEnabled: typeof value.planPanelEnabled === 'boolean'
            ? value.planPanelEnabled
            : fallback.planPanelEnabled,
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

function normalizeCheckin(
    value: unknown,
    fallback: UserPreferencesSnapshot['checkin'],
): UserPreferencesSnapshot['checkin'] {
    if (!isObject(value)) return fallback;
    const planTemplate = normalizePlanTemplate(value.planTemplate)
        ?? legacyPlanTemplate(value.weeklyPlan)
        ?? fallback.planTemplate;
    const dailyRecords = normalizeDailyRecords(value.dailyRecords) ?? fallback.dailyRecords;
    return { planTemplate, dailyRecords };
}

function legacyPlanTemplate(value: unknown): CheckinPlanTemplate | null {
    const weeklyPlan = normalizeWeeklyPlan(value);
    return weeklyPlan ? migrateWeeklyPlanToTemplate(weeklyPlan) : null;
}

function normalizeWeeklyPlan(value: unknown): WeeklyCheckinPlan | null {
    if (!isObject(value) || !isObject(value.days)) return null;
    if (typeof value.weekStartDate !== 'string' || typeof value.carryToNextWeek !== 'boolean') return null;
    const days = {} as WeeklyCheckinPlan['days'];
    for (const day of WEEKDAYS) {
        const plan = normalizeDayPlan(value.days[day]);
        if (!plan) return null;
        days[day] = plan;
    }
    return {
        weekStartDate: value.weekStartDate,
        carryToNextWeek: value.carryToNextWeek,
        days,
    };
}

function normalizeDayPlan(value: unknown): CheckinDayPlan | null {
    if (!isObject(value)) return null;
    if (value.kind === 'inherit' || value.kind === 'rest') return { kind: value.kind };
    if (value.kind !== 'items' || !Array.isArray(value.items)) return null;
    const items = value.items.map(normalizeCheckinItem);
    if (items.some((item) => item === null)) return null;
    return { kind: 'items', items: items as LegacyCheckinItem[] };
}

function normalizeCheckinItem(value: unknown): LegacyCheckinItem | null {
    if (!isObject(value)) return null;
    if (
        typeof value.id !== 'string'
        || typeof value.title !== 'string'
        || (value.type !== 'manual' && value.type !== 'pomodoroFocus')
    ) {
        return null;
    }
    return {
        id: value.id,
        title: value.title,
        type: value.type,
        targetCount: normalizePositiveInteger(value.targetCount, 1),
        ...(typeof value.icon === 'string' && CHECKIN_ITEM_ICONS.has(value.icon as CheckinItemIcon)
            ? { icon: value.icon as CheckinItemIcon }
            : {}),
        ...(typeof value.perUseAmount === 'number' && Number.isFinite(value.perUseAmount)
            ? { perUseAmount: Math.max(0, value.perUseAmount) }
            : {}),
        ...(typeof value.perUseUnit === 'string' && value.perUseUnit.trim()
            ? { perUseUnit: value.perUseUnit.trim() }
            : {}),
    };
}

function normalizeDailyRecords(value: unknown): Record<string, DailyCheckinRecord> | null {
    if (!isObject(value)) return null;
    const records: Record<string, DailyCheckinRecord> = {};
    for (const [date, record] of Object.entries(value)) {
        const normalized = normalizeDailyRecord(record);
        if (!normalized) return null;
        records[date] = normalized;
    }
    return records;
}

function normalizeDailyRecord(value: unknown): DailyCheckinRecord | null {
    if (!isObject(value) || !isObject(value.countsByItemId) || typeof value.date !== 'string') return null;
    return {
        date: value.date,
        countsByItemId: Object.fromEntries(
            Object.entries(value.countsByItemId)
                .filter(([, count]) => typeof count === 'number' && Number.isFinite(count))
                .map(([id, count]) => [id, Math.max(0, count as number)]),
        ),
        processedPomodoroEndEventIds: Array.isArray(value.processedPomodoroEndEventIds)
            ? value.processedPomodoroEndEventIds.filter((id): id is number => (
                typeof id === 'number' && Number.isInteger(id)
            ))
            : [],
    };
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

function cloneDailyRecord(record: DailyCheckinRecord): DailyCheckinRecord {
    return {
        date: record.date,
        countsByItemId: { ...record.countsByItemId },
        processedPomodoroEndEventIds: [...record.processedPomodoroEndEventIds],
    };
}

function cloneDailyRecords(records: Record<string, DailyCheckinRecord>): Record<string, DailyCheckinRecord> {
    return Object.fromEntries(
        Object.entries(records).map(([date, record]) => [date, cloneDailyRecord(record)]),
    );
}
