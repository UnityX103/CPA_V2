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

type BindingKeyPlatform = AccessibilityStatus['platform'];

export type MouseButton = 'left' | 'middle' | 'right';

export type BindingInput =
    | { kind: 'keyboard'; code: number }
    | { kind: 'mouse'; button: MouseButton };

export type InputPressedEvent = BindingInput;

export interface KeyCounterHealth {
    permissionGranted: boolean;
    platform: 'macos' | 'windows' | 'other';
    listenerRunning: boolean;
    lastStartError: string | null;
    lastStartedAtMs: number | null;
    lastStoppedAtMs: number | null;
    bundleIdentifier: string | null;
    executablePath: string | null;
    codeSignIdentifier: string | null;
}

interface ListenerDiagnostic {
    bundleIdentifier: string | null;
    executablePath: string | null;
    codeSignIdentifier: string | null;
}

export interface BindingKeyEntry {
    id: string;
    label: string;
    keyCode: number;
    input?: BindingInput | null;
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
    listenerRunning: boolean | null;
    listenerError: string | null;
    listenerDiagnostic: ListenerDiagnostic | null;
}

interface BindingKeyActions {
    setPanelEnabled: (enabled: boolean) => void;
    addEntry: () => string;
    removeEntry: (id: string) => void;
    setEnabled: (id: string, enabled: boolean) => void;
    setSynced: (id: string | null) => void;
    beginCapture: (id: string) => void;
    cancelCapture: () => void;
    completeCapture: (input: BindingInput, label: string) => void;
    incrementByInput: (input: BindingInput) => void;
    incrementByKeyCode: (keyCode: number) => void;
    resetCount: (id: string) => void;
    setPermission: (granted: boolean, platform: 'macos' | 'windows' | 'other') => void;
    setListenerHealth: (health: KeyCounterHealth) => void;
}

let nextId = 0;
const newId = () => `bk-${Date.now().toString(36)}-${nextId++}`;

// macOS 虚拟键码到展示标签的最小映射；不在表里的键直接 fallback 为 "Key#N"
const MAC_KEYCODE_LABELS: Record<number, string> = {
    0: 'A', 11: 'B', 8: 'C', 2: 'D', 14: 'E', 3: 'F', 5: 'G', 4: 'H',
    34: 'I', 38: 'J', 40: 'K', 37: 'L', 46: 'M', 45: 'N', 31: 'O',
    35: 'P', 12: 'Q', 15: 'R', 1: 'S', 17: 'T', 32: 'U', 9: 'V',
    13: 'W', 7: 'X', 16: 'Y', 6: 'Z',
    18: '1', 19: '2', 20: '3', 21: '4', 23: '5', 22: '6', 26: '7', 28: '8', 25: '9', 29: '0',
    49: 'Space', 36: 'Return', 48: 'Tab', 51: 'Delete', 53: 'Esc',
    123: '←', 124: '→', 125: '↓', 126: '↑',
};

const WINDOWS_KEYCODE_LABELS: Record<number, string> = {
    8: 'Backspace', 9: 'Tab', 13: 'Enter', 16: 'Shift', 17: 'Ctrl',
    18: 'Alt', 20: 'CapsLock', 27: 'Esc', 32: 'Space', 37: 'Left',
    38: 'Up', 39: 'Right', 40: 'Down', 46: 'Delete',
    48: '0', 49: '1', 50: '2', 51: '3', 52: '4',
    53: '5', 54: '6', 55: '7', 56: '8', 57: '9',
    65: 'A', 66: 'B', 67: 'C', 68: 'D', 69: 'E', 70: 'F', 71: 'G',
    72: 'H', 73: 'I', 74: 'J', 75: 'K', 76: 'L', 77: 'M', 78: 'N',
    79: 'O', 80: 'P', 81: 'Q', 82: 'R', 83: 'S', 84: 'T', 85: 'U',
    86: 'V', 87: 'W', 88: 'X', 89: 'Y', 90: 'Z',
};

export const MOUSE_BUTTON_LABELS: Record<MouseButton, string> = {
    left: '鼠标左键',
    middle: '鼠标中键',
    right: '鼠标右键',
};

export function labelForKeyCode(keyCode: number, platform: BindingKeyPlatform | null = 'macos'): string {
    const labels = platform === 'windows' ? WINDOWS_KEYCODE_LABELS : MAC_KEYCODE_LABELS;
    return labels[keyCode] ?? `Key#${keyCode}`;
}

export function inputForLegacyKeyCode(keyCode: number): BindingInput | null {
    return keyCode >= 0 ? { kind: 'keyboard', code: keyCode } : null;
}

export function labelForInput(input: BindingInput, platform: BindingKeyPlatform | null = 'macos'): string {
    return input.kind === 'keyboard'
        ? labelForKeyCode(input.code, platform)
        : MOUSE_BUTTON_LABELS[input.button];
}

export function inputsEqual(a: BindingInput | null | undefined, b: BindingInput | null | undefined): boolean {
    if (!a || !b || a.kind !== b.kind) return false;
    if (a.kind === 'keyboard') return a.code === (b as { kind: 'keyboard'; code: number }).code;
    return a.button === (b as { kind: 'mouse'; button: MouseButton }).button;
}

export function normalizeEntryInput(entry: Pick<BindingKeyEntry, 'input' | 'keyCode'>): BindingInput | null {
    return entry.input ?? inputForLegacyKeyCode(entry.keyCode);
}

export function isVisibleBindingEntry(entry: BindingKeyEntry): boolean {
    return entry.enabled && normalizeEntryInput(entry) !== null;
}

export function hasVisibleInputCounterEntries(entries: BindingKeyEntry[]): boolean {
    return entries.some(isVisibleBindingEntry);
}

export type BindingKeyStore = UseBoundStore<StoreApi<BindingKeyState & BindingKeyActions>>;

function listenerHealthPatch(health: KeyCounterHealth): Pick<
    BindingKeyState,
    'permissionGranted' | 'platform' | 'listenerRunning' | 'listenerError' | 'listenerDiagnostic'
> {
    return {
        permissionGranted: health.permissionGranted,
        platform: health.platform,
        listenerRunning: health.listenerRunning,
        listenerError: health.lastStartError,
        listenerDiagnostic: {
            bundleIdentifier: health.bundleIdentifier,
            executablePath: health.executablePath,
            codeSignIdentifier: health.codeSignIdentifier,
        },
    };
}

export function createBindingKeyStore(opts: { isSettingsWindow: boolean }): BindingKeyStore {
    if (opts.isSettingsWindow) {
        return create<BindingKeyState & BindingKeyActions>((set) => ({
            panelEnabled: true,
            entries: [],
            syncedKeyId: null,
            capturingId: null,
            permissionGranted: true,
            platform: null,
            listenerRunning: null,
            listenerError: null,
            listenerDiagnostic: null,
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
            completeCapture: (input, label) => {
                void dispatch({ v: BRIDGE_VERSION, store: 'bindingKey', action: 'completeCapture', args: [input, label] });
            },
            incrementByInput: () => {},
            incrementByKeyCode: () => {},
            resetCount: () => {},
            setPermission: (granted, platform) =>
                set({ permissionGranted: granted, platform }),
            setListenerHealth: (health) => set(listenerHealthPatch(health)),
        }));
    }
    return create<BindingKeyState & BindingKeyActions>((set, get) => ({
        panelEnabled: true,
        entries: [],
        syncedKeyId: null,
        capturingId: null,
        permissionGranted: true,
        platform: null,
        listenerRunning: null,
        listenerError: null,
        listenerDiagnostic: null,

        setPanelEnabled: (enabled) => set({ panelEnabled: enabled }),
        addEntry: () => {
            const id = newId();
            const entry: BindingKeyEntry = {
                id,
                label: '未绑定',
                keyCode: -1,
                input: null,
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
        completeCapture: (input, label) => {
            const id = get().capturingId;
            if (!id) return;
            set((s) => ({
                entries: s.entries.map((e) =>
                    e.id === id
                        ? {
                            ...e,
                            keyCode: input.kind === 'keyboard' ? input.code : -1,
                            input,
                            label,
                            pressCount: 0,
                        }
                        : e,
                ),
                capturingId: null,
            }));
        },
        incrementByInput: (input) => {
            set((s) => ({
                entries: s.entries.map((e) =>
                    e.enabled && inputsEqual(normalizeEntryInput(e), input)
                        ? { ...e, pressCount: e.pressCount + 1 }
                        : e,
                ),
            }));
        },
        incrementByKeyCode: (keyCode) => {
            if (keyCode < 0) return;
            get().incrementByInput({ kind: 'keyboard', code: keyCode });
        },
        resetCount: (id) => {
            set((s) => ({
                entries: s.entries.map((e) => (e.id === id ? { ...e, pressCount: 0 } : e)),
            }));
        },
        setPermission: (granted, platform) => set({ permissionGranted: granted, platform }),
        setListenerHealth: (health) => set(listenerHealthPatch(health)),
    }));
}

function detectIsSettingsWindow(): boolean {
    if (typeof window === 'undefined') return false;
    return new URLSearchParams(window.location.search).get('window') === 'settings';
}

export const useBindingKeyStore: BindingKeyStore = createBindingKeyStore({
    isSettingsWindow: detectIsSettingsWindow(),
});

function applyHealth(health: KeyCounterHealth) {
    useBindingKeyStore.getState().setListenerHealth(health);
}

function isInputPressedEvent(value: unknown): value is InputPressedEvent {
    if (!value || typeof value !== 'object') return false;
    const payload = value as Partial<InputPressedEvent>;
    if (payload.kind === 'keyboard') {
        const code = payload.code;
        return Number.isInteger(code) && typeof code === 'number' && code >= 0;
    }
    if (payload.kind === 'mouse') {
        return payload.button === 'left' || payload.button === 'middle' || payload.button === 'right';
    }
    return false;
}

export function useBindingKeyListener() {
    useEffect(() => {
        let unlistenKey = () => {};
        let unlistenInput = () => {};
        let unlistenHealth = () => {};
        let unlistenPerm = () => {};
        let cancelled = false;

        // 启动时拉一次状态；后续翻转走 accessibility-permission-changed 事件
        invoke<AccessibilityStatus>('accessibility_status').then((s) => {
            if (cancelled) return;
            useBindingKeyStore.getState().setPermission(s.granted, s.platform);
        }).catch(() => { /* 非 Tauri 环境（vitest jsdom）下静默 */ });

        const loadHealth = () =>
            invoke<KeyCounterHealth>('key_counter_health')
                .then((health) => {
                    if (cancelled) return null;
                    applyHealth(health);
                    return health;
                })
                .catch(() => null);

        void loadHealth();

        const refreshOnFocus = () => {
            void loadHealth().then((health) => {
                if (cancelled || !health?.permissionGranted || health.listenerRunning) return;
                invoke<KeyCounterHealth>('restart_key_counter_listener')
                    .then((restartedHealth) => {
                        if (cancelled) return;
                        applyHealth(restartedHealth);
                    })
                    .catch(() => {});
            });
        };

        window.addEventListener('focus', refreshOnFocus);

        listen<InputPressedEvent>('input-pressed', (event) => {
            if (!isInputPressedEvent(event.payload)) return;
            const store = useBindingKeyStore.getState();
            const input = event.payload;
            if (store.capturingId) {
                store.completeCapture(input, labelForInput(input, store.platform));
            } else {
                store.incrementByInput(input);
            }
        }).then((un) => {
            if (cancelled) un();
            else unlistenInput = un;
        }).catch(() => {});

        listen<number>('key-pressed', (event) => {
            const keyCode = Number(event.payload);
            if (!Number.isInteger(keyCode) || keyCode < 0) return;
            const input: BindingInput = { kind: 'keyboard', code: keyCode };
            const store = useBindingKeyStore.getState();
            if (store.capturingId) {
                store.completeCapture(input, labelForInput(input, store.platform));
            } else {
                store.incrementByInput(input);
            }
        }).then((un) => {
            if (cancelled) un();
            else unlistenKey = un;
        }).catch(() => {});

        listen<KeyCounterHealth>('key-counter-health-changed', (event) => {
            applyHealth(event.payload);
        }).then((un) => {
            if (cancelled) un();
            else unlistenHealth = un;
        }).catch(() => {});

        listen<{ granted: boolean; platform: 'macos' | 'windows' | 'other' }>('accessibility-permission-changed', (event) => {
            const { granted, platform } = event.payload;
            useBindingKeyStore.getState().setPermission(granted, platform);
        }).then((un) => {
            if (cancelled) un();
            else unlistenPerm = un;
        }).catch(() => {});

        return () => {
            cancelled = true;
            window.removeEventListener('focus', refreshOnFocus);
            unlistenInput();
            unlistenKey();
            unlistenHealth();
            unlistenPerm();
        };
    }, []);
}
