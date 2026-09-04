import { invoke } from '@tauri-apps/api/core';
import type {
    ExtensionPackId,
    ExtensionRuntimeContribution,
} from '../domain/extensionPacks';
import type { PomodoroPhase } from '../domain/pomodoro';
import type { PomodoroBroadcast } from '../domain/pomodoroBroadcast';
import { usePresenceStore } from '../domain/presence';
import { useSettingsStore } from '../domain/settings';
import { extensionPomodoroBroadcast } from './pomodoroBroadcastClient';

export interface EventDrivenRuntimeAdapter {
    readonly now: () => number;
    readonly setTimeout: (callback: () => void, delayMs: number) => number;
    readonly clearTimeout: (id: number) => void;
    readonly setActive: (packId: ExtensionPackId, active: boolean) => Promise<void> | void;
}

const defaultAdapter: EventDrivenRuntimeAdapter = {
    now: () => performance.now(),
    setTimeout: (callback, delayMs) => window.setTimeout(callback, delayMs),
    clearTimeout: (id) => window.clearTimeout(id),
    setActive: async (packId, active) => {
        try {
            await invoke('set_extension_pack_active', { packId, active });
        } catch (error) {
            console.warn(`[extension-runtime] ${packId} ${active ? 'activate' : 'deactivate'} failed`, error);
        }
    },
};

function activationGateMatches(
    contribution: ExtensionRuntimeContribution,
    phase: PomodoroPhase,
): boolean {
    const settings = useSettingsStore.getState();
    const presence = usePresenceStore.getState();
    if (phase !== contribution.activationPhase || settings.breakPetMode !== contribution.settingsGate) {
        return false;
    }
    if (!contribution.requiresPresence) return true;
    return presence.enabled
        && presence.restDeskReminderEnabled
        && presence.restDeskReminderMode === contribution.settingsGate
        && presence.confirmedPresence === 'present';
}

export function startEventDrivenRuntime(
    packId: ExtensionPackId,
    contribution: ExtensionRuntimeContribution,
    adapter: EventDrivenRuntimeAdapter = defaultAdapter,
    broadcast: PomodoroBroadcast = extensionPomodoroBroadcast,
): () => void {
    let currentPhase = broadcast.current().phase;
    let eligibleSinceMs: number | null = null;
    let active = false;
    let wakeTimer: number | null = null;
    let stopped = false;

    const clearWakeTimer = () => {
        if (wakeTimer == null) return;
        adapter.clearTimeout(wakeTimer);
        wakeTimer = null;
    };

    const evaluate = () => {
        if (stopped) return;
        clearWakeTimer();
        if (!activationGateMatches(contribution, currentPhase)) {
            eligibleSinceMs = null;
            if (active) {
                active = false;
                void adapter.setActive(packId, false);
            }
            return;
        }
        if (active) return;
        eligibleSinceMs ??= adapter.now();
        const wakeAtMs = eligibleSinceMs + contribution.delayMs;
        if (adapter.now() < wakeAtMs) {
            wakeTimer = adapter.setTimeout(evaluate, Math.max(0, wakeAtMs - adapter.now()));
            return;
        }
        active = true;
        void adapter.setActive(packId, true);
    };

    const subscriptions = [
        useSettingsStore.subscribe(evaluate),
        usePresenceStore.subscribe(evaluate),
        broadcast.subscribe((event) => {
            currentPhase = event.phase;
            evaluate();
        }),
    ];
    evaluate();

    return () => {
        stopped = true;
        clearWakeTimer();
        subscriptions.forEach((unsubscribe) => unsubscribe());
        void adapter.setActive(packId, false);
    };
}
