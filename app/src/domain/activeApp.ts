import { useEffect } from 'react';
import { create } from 'zustand';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';

export interface ActiveAppInfo {
    name: string;
    bundle_id: string;
    window_title?: string | null;
    icon_data_url?: string | null;
}

interface ActiveAppState {
    current: ActiveAppInfo | null;
    setCurrent: (a: ActiveAppInfo | null) => void;
}

export const useActiveAppStore = create<ActiveAppState>((set) => ({
    current: null,
    setCurrent: (a) => set({ current: a }),
}));

export function useActiveAppListener() {
    useEffect(() => {
        let unlisten = () => {};
        invoke<ActiveAppInfo | null>('get_active_app')
            .then((info) => useActiveAppStore.getState().setCurrent(info))
            .catch(() => {});
        listen<ActiveAppInfo | null>('active-app-changed', (event) => {
            useActiveAppStore.getState().setCurrent(event.payload);
        }).then((un) => {
            unlisten = un;
        });
        return () => unlisten();
    }, []);
}
