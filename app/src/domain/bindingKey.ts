import { useEffect } from 'react';
import { create, type StoreApi, type UseBoundStore } from 'zustand';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { dispatch } from './bridge/dispatch';
import { BRIDGE_VERSION } from './bridge/protocol';

interface AccessibilityStatus {
    granted: boolean;
    platform: 'macos' | 'windows' | 'other';
}

export interface BindingKeyEntry {
    id: string;
    label: string;
    keyCode: number;
    pressCount: number;
    enabled: boolean;
}

interface BindingKeyState {
    panelEnabled: boolean;
    entries: BindingKeyEntry[];
    syncedKeyId: string | null;
    capturingId: string | null;
    permissionGranted: boolean;
    platform: 'macos' | 'windows' | 'other' | null;
}

interface BindingKeyActions {
    setPanelEnabled: (enabled: boolean) => void;
    addEntry: () => string;
    removeEntry: (id: string) => void;
    setEnabled: (id: string, enabled: boolean) => void;
    setSynced: (id: string | null) => void;
    beginCapture: (id: string) => void;
    cancelCapture: () => void;
    completeCapture: (keyCode: number, label: string) => void;
    incrementByKeyCode: (keyCode: number) => void;
    resetCount: (id: string) => void;
    setPermission: (granted: boolean, platform: 'macos' | 'windows' | 'other') => void;
}

let nextId = 0;
const newId = () => `bk-${Date.now().toString(36)}-${nextId++}`;

// macOS 虚拟键码到展示标签的最小映射；不在表里的键直接 fallback 为 "Key#N"
const KEYCODE_LABELS: Record<number, string> = {
    0: 'A', 11: 'B', 8: 'C', 2: 'D', 14: 'E', 3: 'F', 5: 'G', 4: 'H',
    34: 'I', 38: 'J', 40: 'K', 37: 'L', 46: 'M', 45: 'N', 31: 'O',
    35: 'P', 12: 'Q', 15: 'R', 1: 'S', 17: 'T', 32: 'U', 9: 'V',
    13: 'W', 7: 'X', 16: 'Y', 6: 'Z',
    18: '1', 19: '2', 20: '3', 21: '4', 23: '5', 22: '6', 26: '7', 28: '8', 25: '9', 29: '0',
    49: 'Space', 36: 'Return', 48: 'Tab', 51: 'Delete', 53: 'Esc',
    123: '←', 124: '→', 125: '↓', 126: '↑',
};

export function labelForKeyCode(keyCode: number): string {
    return KEYCODE_LABELS[keyCode] ?? `Key#${keyCode}`;
}

export function isVisibleBindingEntry(entry: BindingKeyEntry): boolean {
    return entry.enabled && entry.keyCode >= 0;
}

export function hasVisibleInputCounterEntries(entries: BindingKeyEntry[]): boolean {
    return entries.some(isVisibleBindingEntry);
}

export type BindingKeyStore = UseBoundStore<StoreApi<BindingKeyState & BindingKeyActions>>;

export function createBindingKeyStore(opts: { isSettingsWindow: boolean }): BindingKeyStore {
    if (opts.isSettingsWindow) {
        return create<BindingKeyState & BindingKeyActions>((set) => ({
            panelEnabled: true,
            entries: [],
            syncedKeyId: null,
            capturingId: null,
            permissionGranted: true,
            platform: null,
            setPanelEnabled: (enabled) => {
                void dispatch({ v: BRIDGE_VERSION, store: 'bindingKey', action: 'setPanelEnabled', args: [enabled] });
            },
            addEntry: () => {
                void dispatch({ v: BRIDGE_VERSION, store: 'bindingKey', action: 'addEntry', args: [] });
                return '';
            },
            removeEntry: (id) => {
                void dispatch({ v: BRIDGE_VERSION, store: 'bindingKey', action: 'removeEntry', args: [id] });
            },
            setEnabled: () => {},
            setSynced: (id) => {
                void dispatch({ v: BRIDGE_VERSION, store: 'bindingKey', action: 'setSynced', args: [id] });
            },
            beginCapture: (id) => {
                void dispatch({ v: BRIDGE_VERSION, store: 'bindingKey', action: 'beginCapture', args: [id] });
            },
            cancelCapture: () => {},
            completeCapture: () => {},
            incrementByKeyCode: () => {},
            resetCount: () => {},
            setPermission: (granted, platform) =>
                set({ permissionGranted: granted, platform }),
        }));
    }
    return create<BindingKeyState & BindingKeyActions>((set, get) => ({
        panelEnabled: true,
        entries: [],
        syncedKeyId: null,
        capturingId: null,
        permissionGranted: true,
        platform: null,

        setPanelEnabled: (enabled) => set({ panelEnabled: enabled }),
        addEntry: () => {
            const id = newId();
            const entry: BindingKeyEntry = {
                id,
                label: '未绑定',
                keyCode: -1,
                pressCount: 0,
                enabled: true,
            };
            set((s) => ({ entries: [...s.entries, entry], capturingId: id }));
            return id;
        },
        removeEntry: (id) => {
            set((s) => ({
                entries: s.entries.filter((e) => e.id !== id),
                syncedKeyId: s.syncedKeyId === id ? null : s.syncedKeyId,
                capturingId: s.capturingId === id ? null : s.capturingId,
            }));
        },
        setEnabled: (id, enabled) => {
            set((s) => ({
                entries: s.entries.map((e) => (e.id === id ? { ...e, enabled } : e)),
            }));
        },
        setSynced: (id) => set({ syncedKeyId: id }),
        beginCapture: (id) => set({ capturingId: id }),
        cancelCapture: () => set({ capturingId: null }),
        completeCapture: (keyCode, label) => {
            const id = get().capturingId;
            if (!id) return;
            set((s) => ({
                entries: s.entries.map((e) =>
                    e.id === id ? { ...e, keyCode, label, pressCount: 0 } : e,
                ),
                capturingId: null,
            }));
        },
        incrementByKeyCode: (keyCode) => {
            if (keyCode < 0) return;
            set((s) => ({
                entries: s.entries.map((e) =>
                    e.keyCode >= 0 && e.keyCode === keyCode && e.enabled ? { ...e, pressCount: e.pressCount + 1 } : e,
                ),
            }));
        },
        resetCount: (id) => {
            set((s) => ({
                entries: s.entries.map((e) => (e.id === id ? { ...e, pressCount: 0 } : e)),
            }));
        },
        setPermission: (granted, platform) => set({ permissionGranted: granted, platform }),
    }));
}

function detectIsSettingsWindow(): boolean {
    if (typeof window === 'undefined') return false;
    return new URLSearchParams(window.location.search).get('window') === 'settings';
}

export const useBindingKeyStore: BindingKeyStore = createBindingKeyStore({
    isSettingsWindow: detectIsSettingsWindow(),
});

export function useBindingKeyListener() {
    useEffect(() => {
        let unlistenKey = () => {};
        let cancelled = false;

        // 启动时拉一次状态；后续翻转走 accessibility-permission-changed 事件
        invoke<AccessibilityStatus>('accessibility_status').then((s) => {
            if (cancelled) return;
            useBindingKeyStore.getState().setPermission(s.granted, s.platform);
        }).catch(() => { /* 非 Tauri 环境（vitest jsdom）下静默 */ });

        listen<number>('key-pressed', (event) => {
            const store = useBindingKeyStore.getState();
            const keyCode = Number(event.payload);
            if (store.capturingId) {
                store.completeCapture(keyCode, labelForKeyCode(keyCode));
            } else {
                store.incrementByKeyCode(keyCode);
            }
        }).then((un) => {
            unlistenKey = un;
        });

        let unlistenPerm = () => {};
        listen<{ granted: boolean; platform: 'macos' | 'windows' | 'other' }>('accessibility-permission-changed', (event) => {
            const { granted, platform } = event.payload;
            useBindingKeyStore.getState().setPermission(granted, platform);
        }).then((un) => {
            unlistenPerm = un;
        });

        return () => {
            cancelled = true;
            unlistenKey();
            unlistenPerm();
        };
    }, []);
}
