import { create, type StoreApi, type UseBoundStore } from 'zustand';
import { dispatch } from './bridge/dispatch';
import { BRIDGE_VERSION } from './bridge/protocol';
import { savePersistedSettings } from './settingsPersistence';
import { applyAutostartEnabled } from './autostart';

export type SettingsTab = 'pomodoro' | 'online' | 'pet' | 'global';
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
    showActiveAppWindowTitle: boolean;
    autostartEnabled: boolean;
    dangerousChange: DangerousChange | null;
}

export interface PersistedSettingsSnapshot {
    uiScale: number;
    showActiveAppWindowTitle?: boolean;
    autostartEnabled?: boolean;
}

interface SettingsActions {
    setActiveTab: (tab: SettingsTab) => void;
    setUiScale: (scale: number) => void;
    setShowActiveAppWindowTitle: (enabled: boolean) => void;
    setAutostartEnabled: (enabled: boolean) => Promise<void> | void;
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

export function createSettingsStore(opts: { isSettingsWindow: boolean }): SettingsStore {
    if (opts.isSettingsWindow) {
        return create<SettingsState & SettingsActions>((set) => ({
            activeTab: 'pomodoro',
            uiScale: 1.0,
            committedUiScale: 1.0,
            showActiveAppWindowTitle: true,
            autostartEnabled: false,
            dangerousChange: null,
            setActiveTab: (tab) => set({ activeTab: tab }),
            setUiScale: (scale) => {
                void dispatch({ v: BRIDGE_VERSION, store: 'settings', action: 'setUiScale', args: [scale] });
            },
            setShowActiveAppWindowTitle: (enabled) => {
                void dispatch({ v: BRIDGE_VERSION, store: 'settings', action: 'setShowActiveAppWindowTitle', args: [enabled] });
            },
            setAutostartEnabled: (enabled) => {
                void dispatch({
                    v: BRIDGE_VERSION,
                    store: 'settings',
                    action: 'setAutostartEnabled',
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
                    showActiveAppWindowTitle: snapshot.showActiveAppWindowTitle ?? true,
                    autostartEnabled: snapshot.autostartEnabled ?? false,
                    dangerousChange: null,
                });
            },
        }));
    }
    return create<SettingsState & SettingsActions>((set, get) => ({
        activeTab: 'pomodoro',
        uiScale: 1.0,
        committedUiScale: 1.0,
        showActiveAppWindowTitle: true,
        autostartEnabled: false,
        dangerousChange: null,
        setActiveTab: (tab) => set({ activeTab: tab }),
        setUiScale: (scale) => {
            const uiScale = clampScale(scale);
            set({ uiScale, committedUiScale: uiScale, dangerousChange: null });
        },
        setShowActiveAppWindowTitle: (enabled) => {
            set({ showActiveAppWindowTitle: enabled });
            const state = get();
            void savePersistedSettings({
                uiScale: state.committedUiScale,
                showActiveAppWindowTitle: enabled,
                autostartEnabled: state.autostartEnabled,
            });
        },
        setAutostartEnabled: async (enabled) => {
            const fallback = get().autostartEnabled;
            const confirmed = await applyAutostartEnabled(enabled, fallback);
            set({ autostartEnabled: confirmed });
            const state = get();
            void savePersistedSettings({
                uiScale: state.committedUiScale,
                showActiveAppWindowTitle: state.showActiveAppWindowTitle,
                autostartEnabled: confirmed,
            });
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
            void savePersistedSettings({
                uiScale: committedUiScale,
                showActiveAppWindowTitle: get().showActiveAppWindowTitle,
                autostartEnabled: get().autostartEnabled,
            });
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
                showActiveAppWindowTitle: snapshot.showActiveAppWindowTitle ?? true,
                autostartEnabled: snapshot.autostartEnabled ?? false,
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
