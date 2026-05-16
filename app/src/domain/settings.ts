import { create, type StoreApi, type UseBoundStore } from 'zustand';
import { dispatch } from './bridge/dispatch';
import { BRIDGE_VERSION } from './bridge/protocol';

export type SettingsTab = 'pomodoro' | 'online' | 'pet' | 'global';

export interface SettingsState {
    activeTab: SettingsTab;
    uiScale: number;
}

interface SettingsActions {
    setActiveTab: (tab: SettingsTab) => void;
    setUiScale: (scale: number) => void;
}

export const MIN_SCALE = 0.5;
export const MAX_SCALE = 3.0;

export type SettingsStore = UseBoundStore<StoreApi<SettingsState & SettingsActions>>;

export function createSettingsStore(opts: { isSettingsWindow: boolean }): SettingsStore {
    if (opts.isSettingsWindow) {
        return create<SettingsState & SettingsActions>((set) => ({
            activeTab: 'pomodoro',
            uiScale: 1.0,
            setActiveTab: (tab) => set({ activeTab: tab }),
            setUiScale: (scale) => {
                void dispatch({ v: BRIDGE_VERSION, store: 'settings', action: 'setUiScale', args: [scale] });
            },
        }));
    }
    return create<SettingsState & SettingsActions>((set) => ({
        activeTab: 'pomodoro',
        uiScale: 1.0,
        setActiveTab: (tab) => set({ activeTab: tab }),
        setUiScale: (scale) => set({ uiScale: Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale)) }),
    }));
}

function detectIsSettingsWindow(): boolean {
    if (typeof window === 'undefined') return false;
    return new URLSearchParams(window.location.search).get('window') === 'settings';
}

export const useSettingsStore: SettingsStore = createSettingsStore({
    isSettingsWindow: detectIsSettingsWindow(),
});
