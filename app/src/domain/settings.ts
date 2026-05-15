import { create } from 'zustand';

export type SettingsTab = 'pomodoro' | 'online' | 'pet' | 'global';

export interface SettingsState {
    isOpen: boolean;
    activeTab: SettingsTab;
    uiScale: number;
    targetMonitorIndex: number;
}

interface SettingsActions {
    open: (tab?: SettingsTab) => void;
    close: () => void;
    setActiveTab: (tab: SettingsTab) => void;
    setUiScale: (scale: number) => void;
    setTargetMonitor: (index: number) => void;
}

export const MIN_SCALE = 0.5;
export const MAX_SCALE = 3.0;

export const useSettingsStore = create<SettingsState & SettingsActions>((set) => ({
    isOpen: false,
    activeTab: 'pomodoro',
    uiScale: 1.0,
    targetMonitorIndex: 0,

    open: (tab) => set((s) => ({ isOpen: true, activeTab: tab ?? s.activeTab })),
    close: () => set({ isOpen: false }),
    setActiveTab: (tab) => set({ activeTab: tab }),
    setUiScale: (scale) => set({ uiScale: Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale)) }),
    setTargetMonitor: (index) => set({ targetMonitorIndex: Math.max(0, index) }),
}));
