import { useEffect } from 'react';
import { create } from 'zustand';
import { listen } from '@tauri-apps/api/event';

export interface BindingKeyEntry {
    id: string;
    label: string;
    keyCode: number;
    pressCount: number;
    enabled: boolean;
}

interface BindingKeyState {
    entries: BindingKeyEntry[];
    syncedKeyId: string | null;
    capturingId: string | null;
}

interface BindingKeyActions {
    addEntry: () => string;
    removeEntry: (id: string) => void;
    setEnabled: (id: string, enabled: boolean) => void;
    setSynced: (id: string | null) => void;
    beginCapture: (id: string) => void;
    cancelCapture: () => void;
    completeCapture: (keyCode: number, label: string) => void;
    incrementByKeyCode: (keyCode: number) => void;
    resetCount: (id: string) => void;
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

export const useBindingKeyStore = create<BindingKeyState & BindingKeyActions>((set, get) => ({
    entries: [],
    syncedKeyId: null,
    capturingId: null,

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
        set((s) => ({
            entries: s.entries.map((e) =>
                e.keyCode === keyCode && e.enabled ? { ...e, pressCount: e.pressCount + 1 } : e,
            ),
        }));
    },
    resetCount: (id) => {
        set((s) => ({
            entries: s.entries.map((e) => (e.id === id ? { ...e, pressCount: 0 } : e)),
        }));
    },
}));

export function useBindingKeyListener() {
    useEffect(() => {
        let unlisten = () => {};
        listen<number>('key-pressed', (event) => {
            const store = useBindingKeyStore.getState();
            const keyCode = Number(event.payload);
            if (store.capturingId) {
                // 捕获模式：绑定按下的键
                store.completeCapture(keyCode, labelForKeyCode(keyCode));
            } else {
                store.incrementByKeyCode(keyCode);
            }
        }).then((un) => {
            unlisten = un;
        });
        return () => unlisten();
    }, []);
}
