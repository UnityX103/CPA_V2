import { create, type StoreApi, type UseBoundStore } from 'zustand';
import { dispatch } from './bridge/dispatch';
import { BRIDGE_VERSION } from './bridge/protocol';
import { savePersistedSettings, type PersistedSettings } from './settingsPersistence';
import { applyAutostartEnabled } from './autostart';
import { DEFAULT_CHECKIN_ENABLED, DEFAULT_PLAN_PANEL_ENABLED } from './settingsDefaults';

export type SettingsTab = 'pomodoro' | 'online' | 'global';
export type DangerousSettingKind = 'uiScale';

export interface DangerousChange {
    id: string;
    kind: DangerousSettingKind;
    previousValue: number;
    nextValue: number;
    expiresAt: number;
}

export interface SettingsState {
    activeTab: SettingsTab;
    uiScale: number;
    committedUiScale: number;
    autostartEnabled: boolean;
    checkinEnabled: boolean;
    planPanelEnabled: boolean;
    dangerousChange: DangerousChange | null;
}

export interface PersistedSettingsSnapshot {
    uiScale: number;
    autostartEnabled?: boolean;
    checkinEnabled?: boolean;
    planPanelEnabled?: boolean;
}

interface SettingsActions {
    setActiveTab: (tab: SettingsTab) => void;
    setUiScale: (scale: number) => void;
    setAutostartEnabled: (enabled: boolean) => Promise<void> | void;
    setCheckinEnabled: (enabled: boolean) => void;
    setPlanPanelEnabled: (enabled: boolean) => void;
    previewDangerousUiScale: (scale: number) => void;
    applyDangerousChange: (id: string) => void;
    revertDangerousChange: (id: string) => void;
    hydrateSettings: (snapshot: PersistedSettingsSnapshot) => void;
}

export const MIN_SCALE = 0.5;
export const MAX_SCALE = 2.0;
export const DANGEROUS_CHANGE_TIMEOUT_MS = 5000;

export type SettingsStore = UseBoundStore<StoreApi<SettingsState & SettingsActions>>;

function clampScale(scale: number): number {
    if (!Number.isFinite(scale)) return 1.0;
    return Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale));
}

function createDangerousChangeId(): string {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
        return crypto.randomUUID();
    }
    return `danger-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function persistedSnapshot(state: SettingsState): PersistedSettings {
    return {
        uiScale: state.committedUiScale,
        autostartEnabled: state.autostartEnabled,
        checkinEnabled: state.checkinEnabled,
        planPanelEnabled: state.planPanelEnabled,
    };
}

export function createSettingsStore(opts: { isSettingsWindow: boolean }): SettingsStore {
    if (opts.isSettingsWindow) {
        return create<SettingsState & SettingsActions>((set) => ({
            activeTab: 'pomodoro',
            uiScale: 1.0,
            committedUiScale: 1.0,
            autostartEnabled: false,
            checkinEnabled: DEFAULT_CHECKIN_ENABLED,
            planPanelEnabled: DEFAULT_PLAN_PANEL_ENABLED,
            dangerousChange: null,
            setActiveTab: (tab) => set({ activeTab: tab }),
            setUiScale: (scale) => {
                void dispatch({ v: BRIDGE_VERSION, store: 'settings', action: 'setUiScale', args: [scale] });
            },
            setAutostartEnabled: (enabled) => {
                void dispatch({
                    v: BRIDGE_VERSION,
                    store: 'settings',
                    action: 'setAutostartEnabled',
                    args: [enabled],
                } as Parameters<typeof dispatch>[0]);
            },
            setCheckinEnabled: (enabled) => {
                void dispatch({
                    v: BRIDGE_VERSION,
                    store: 'settings',
                    action: 'setCheckinEnabled',
                    args: [enabled],
                } as Parameters<typeof dispatch>[0]);
            },
            setPlanPanelEnabled: (enabled) => {
                void dispatch({
                    v: BRIDGE_VERSION,
                    store: 'settings',
                    action: 'setPlanPanelEnabled',
                    args: [enabled],
                } as Parameters<typeof dispatch>[0]);
            },
            previewDangerousUiScale: (scale) => {
                void dispatch({ v: BRIDGE_VERSION, store: 'settings', action: 'previewDangerousUiScale', args: [scale] });
            },
            applyDangerousChange: (id) => {
                void dispatch({ v: BRIDGE_VERSION, store: 'settings', action: 'applyDangerousChange', args: [id] });
            },
            revertDangerousChange: (id) => {
                void dispatch({ v: BRIDGE_VERSION, store: 'settings', action: 'revertDangerousChange', args: [id] });
            },
            hydrateSettings: (snapshot) => {
                const uiScale = clampScale(snapshot.uiScale);
                set({
                    uiScale,
                    committedUiScale: uiScale,
                    autostartEnabled: snapshot.autostartEnabled ?? false,
                    checkinEnabled: snapshot.checkinEnabled ?? DEFAULT_CHECKIN_ENABLED,
                    planPanelEnabled: snapshot.planPanelEnabled ?? DEFAULT_PLAN_PANEL_ENABLED,
                    dangerousChange: null,
                });
            },
        }));
    }
    return create<SettingsState & SettingsActions>((set, get) => ({
        activeTab: 'pomodoro',
        uiScale: 1.0,
        committedUiScale: 1.0,
        autostartEnabled: false,
        checkinEnabled: DEFAULT_CHECKIN_ENABLED,
        planPanelEnabled: DEFAULT_PLAN_PANEL_ENABLED,
        dangerousChange: null,
        setActiveTab: (tab) => set({ activeTab: tab }),
        setUiScale: (scale) => {
            const uiScale = clampScale(scale);
            set({ uiScale, committedUiScale: uiScale, dangerousChange: null });
        },
        setAutostartEnabled: async (enabled) => {
            const fallback = get().autostartEnabled;
            const confirmed = await applyAutostartEnabled(enabled, fallback);
            set({ autostartEnabled: confirmed });
            void savePersistedSettings(persistedSnapshot(get()));
        },
        setCheckinEnabled: (checkinEnabled) => {
            set({ checkinEnabled });
            void savePersistedSettings(persistedSnapshot(get()));
        },
        setPlanPanelEnabled: (planPanelEnabled) => {
            set({ planPanelEnabled });
            void savePersistedSettings(persistedSnapshot(get()));
        },
        previewDangerousUiScale: (scale) => {
            const nextValue = clampScale(scale);
            const existing = get().dangerousChange;
            const previousValue = existing?.kind === 'uiScale'
                ? existing.previousValue
                : get().committedUiScale;
            set({
                uiScale: nextValue,
                dangerousChange: {
                    id: existing?.kind === 'uiScale' ? existing.id : createDangerousChangeId(),
                    kind: 'uiScale',
                    previousValue,
                    nextValue,
                    expiresAt: Date.now() + DANGEROUS_CHANGE_TIMEOUT_MS,
                },
            });
        },
        applyDangerousChange: (id) => {
            const change = get().dangerousChange;
            if (!change || change.id !== id) return;
            const committedUiScale = change.nextValue;
            set({ uiScale: committedUiScale, committedUiScale, dangerousChange: null });
            void savePersistedSettings(persistedSnapshot(get()));
        },
        revertDangerousChange: (id) => {
            const change = get().dangerousChange;
            if (!change || change.id !== id) return;
            set({ uiScale: change.previousValue, dangerousChange: null });
        },
        hydrateSettings: (snapshot) => {
            const uiScale = clampScale(snapshot.uiScale);
            set({
                uiScale,
                committedUiScale: uiScale,
                autostartEnabled: snapshot.autostartEnabled ?? false,
                checkinEnabled: snapshot.checkinEnabled ?? DEFAULT_CHECKIN_ENABLED,
                planPanelEnabled: snapshot.planPanelEnabled ?? DEFAULT_PLAN_PANEL_ENABLED,
                dangerousChange: null,
            });
        },
    }));
}

function detectIsSettingsWindow(): boolean {
    if (typeof window === 'undefined') return false;
    return new URLSearchParams(window.location.search).get('window') === 'settings';
}

export const useSettingsStore: SettingsStore = createSettingsStore({
    isSettingsWindow: detectIsSettingsWindow(),
});
