import { create, type StoreApi, type UseBoundStore } from 'zustand';
import { dispatchConfirmed } from './bridge/dispatch';
import { BRIDGE_VERSION } from './bridge/protocol';
import { usePomodoroStore, type PomodoroStore } from './pomodoro';
import {
    DEFAULT_PRESENCE_PREFERENCES,
    normalizePresencePreferences,
    savePresencePreferences,
    type PresencePreferences,
} from './presencePersistence';

export type { PresencePreferences, RestDeskReminderMode } from './presencePersistence';

export const INPUT_ACTIVITY_RECENT_MS = 5_000;
export type InputActivityAvailability = 'disabled' | 'waiting' | 'ready' | 'error';
export type ConfirmedPresence = 'present' | 'absent' | 'unknown';
export interface PresenceNotice { id: number; message: string }

interface PresenceState extends PresencePreferences {
    inputActivityAvailability: InputActivityAvailability;
    inputIdleMs: number | null;
    inputSampleAt: number | null;
    confirmedPresence: ConfirmedPresence;
    lastSuccessfulAt: number | null;
    notice: PresenceNotice | null;
}
interface PresenceActions {
    hydrate: (preferences: PresencePreferences) => void;
    applySettings: (preferences: PresencePreferences) => Promise<void> | void;
}
export type PresenceStore = UseBoundStore<StoreApi<PresenceState & PresenceActions>>;
let nextNoticeId = 1;
function notice(message: string): PresenceNotice { return { id: nextNoticeId++, message }; }

function emptyEvidence(inputActivityEnabled: boolean) {
    return {
        inputActivityAvailability: inputActivityEnabled ? 'waiting' as const : 'disabled' as const,
        inputIdleMs: null,
        inputSampleAt: null,
        confirmedPresence: 'unknown' as const,
        lastSuccessfulAt: null,
        notice: null,
    };
}

export function createPresenceStore(opts: { isSettingsWindow: boolean }): PresenceStore {
    const initial = { ...DEFAULT_PRESENCE_PREFERENCES, ...emptyEvidence(false) };
    if (opts.isSettingsWindow) {
        return create<PresenceState & PresenceActions>(() => ({
            ...initial,
            hydrate: () => {},
            applySettings: (preferences) => dispatchConfirmed({
                v: BRIDGE_VERSION, store: 'presence', action: 'applySettings',
                args: [normalizePresencePreferences(preferences)],
            }, { replyTo: 'settings' }),
        }));
    }
    return create<PresenceState & PresenceActions>((set, get) => ({
        ...initial,
        hydrate: (preferences) => {
            const normalized = normalizePresencePreferences(preferences);
            set({ ...normalized, ...emptyEvidence(normalized.inputActivityEnabled) });
        },
        applySettings: async (preferences) => {
            const normalized = normalizePresencePreferences(preferences);
            const previous = get();
            set({
                ...normalized,
                ...(previous.inputActivityEnabled !== normalized.inputActivityEnabled
                    ? emptyEvidence(normalized.inputActivityEnabled) : {}),
            });
            if (previous.inputActivityEnabled && !normalized.inputActivityEnabled) {
                usePomodoroStore.getState().clearPresenceAutomationOwnership();
            }
            await savePresencePreferences(normalized);
        },
    }));
}

export const usePresenceStore = createPresenceStore({
    isSettingsWindow: typeof window !== 'undefined'
        && new URLSearchParams(window.location.search).get('window') === 'settings',
});

function inputPresence(state: PresenceState, nowMs: number): ConfirmedPresence {
    if (!state.inputActivityEnabled || state.inputActivityAvailability !== 'ready'
        || state.inputSampleAt === null || state.inputIdleMs === null) return 'unknown';
    const elapsedMs = nowMs - state.inputSampleAt;
    if (elapsedMs < 0 || elapsedMs > 10_000) return 'unknown';
    return state.inputIdleMs + elapsedMs < INPUT_ACTIVITY_RECENT_MS ? 'present' : 'absent';
}

export function applyInputActivitySample(store: PresenceStore, pomodoro: PomodoroStore,
    idleMs: number | null, nowMs: number): void {
    const valid = idleMs !== null && Number.isFinite(idleMs) && idleMs >= 0;
    store.setState({
        inputActivityAvailability: valid ? 'ready' : 'error',
        inputIdleMs: valid ? idleMs : null,
        inputSampleAt: nowMs,
    });
    applyCombinedPresence(store, pomodoro, nowMs);
}

export function applyCombinedPresence(store: PresenceStore, pomodoro: PomodoroStore,
    nowMs: number, control = true): void {
    const pomo = pomodoro.getState();
    const input = inputPresence(store.getState(), nowMs);
    // Idle input can resume rest, but does not prove departure during focus.
    const observation = pomo.currentPhase === 'break' ? input
        : pomo.currentPhase === 'focus' && input === 'present' ? 'present' : 'unknown';
    store.setState({ confirmedPresence: observation,
        ...(observation !== 'unknown' ? { lastSuccessfulAt: nowMs } : {}) });
    if (!control || observation === 'unknown') return;
    if (pomo.currentPhase === 'break') {
        if (observation === 'absent' && pomodoro.getState().resumeBreakFromPresence()) {
            store.setState({ notice: notice('键鼠已闲置，已继续休息') });
        } else if (observation === 'present' && pomodoro.getState().pauseBreakFromPresence()) {
            store.setState({ notice: notice('检测到键鼠活动，已暂停休息') });
        }
        return;
    }
    const started = pomodoro.getState().startFocusFromPresence();
    const resumed = !started && pomodoro.getState().resumeFocusFromPresence();
    if (started || resumed) {
        store.setState({ notice: notice(started ? '检测到键鼠活动，已开始专注' : '检测到键鼠活动，已继续专注') });
    }
}
