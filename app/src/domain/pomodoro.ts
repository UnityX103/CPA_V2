import { create, type StoreApi, type UseBoundStore } from 'zustand';
import { dispatch } from './bridge/dispatch';
import { BRIDGE_VERSION } from './bridge/protocol';

export type PomodoroPhase = 'focus' | 'break' | 'completed';

export interface PomodoroState {
    focusDurationSeconds: number;
    breakDurationSeconds: number;
    totalRounds: number;
    currentRound: number;
    remainingSeconds: number;
    currentPhase: PomodoroPhase;
    isRunning: boolean;
    isPinned: boolean;
    autoStartBreak: boolean;
    consecutiveCompletedFocus: number;
}

export interface PomodoroActions {
    start: () => void;
    pause: () => void;
    skip: () => void;
    reset: () => void;
    togglePin: () => void;
    applySettings: (focusSeconds: number, breakSeconds: number, totalRounds: number, resetProgress: boolean) => void;
    tick: (deltaSeconds: number) => void;
}

const DEFAULT_FOCUS = 25 * 60;
const DEFAULT_BREAK = 5 * 60;
const DEFAULT_ROUNDS = 4;

export type PomodoroStore = UseBoundStore<StoreApi<PomodoroState & PomodoroActions>>;

export function createPomodoroStore(opts: { isSettingsWindow: boolean }): PomodoroStore {
    if (opts.isSettingsWindow) {
        return create<PomodoroState & PomodoroActions>(() => ({
            focusDurationSeconds: DEFAULT_FOCUS,
            breakDurationSeconds: DEFAULT_BREAK,
            totalRounds: DEFAULT_ROUNDS,
            currentRound: 1,
            remainingSeconds: DEFAULT_FOCUS,
            currentPhase: 'focus',
            isRunning: false,
            isPinned: false,
            autoStartBreak: true,
            consecutiveCompletedFocus: 0,
            start: () => {},
            pause: () => {},
            skip: () => {},
            reset: () => {},
            togglePin: () => {},
            applySettings: (focusSeconds, breakSeconds, totalRounds, resetProgress) => {
                void dispatch({
                    v: BRIDGE_VERSION,
                    store: 'pomodoro',
                    action: 'applySettings',
                    args: [focusSeconds, breakSeconds, totalRounds, resetProgress],
                });
            },
            tick: () => {},
        }));
    }
    return create<PomodoroState & PomodoroActions>((set, get) => {
        let accumulator = 0;

        function advancePhase(state: PomodoroState): Partial<PomodoroState> {
            if (state.currentPhase === 'focus') {
                // 阶段切换时一律清零 accumulator，避免新阶段第一秒被吞掉（adversarial-review #7）
                accumulator = 0;
                return {
                    currentPhase: 'break',
                    remainingSeconds: state.breakDurationSeconds,
                    isRunning: state.autoStartBreak,
                    consecutiveCompletedFocus: state.consecutiveCompletedFocus + 1,
                };
            }
            if (state.currentPhase === 'break') {
                const nextRound = state.currentRound + 1;
                if (nextRound > state.totalRounds) {
                    return {
                        currentPhase: 'completed',
                        isRunning: false,
                        remainingSeconds: 0,
                    };
                }
                accumulator = 0;
                return {
                    currentRound: nextRound,
                    currentPhase: 'focus',
                    remainingSeconds: state.focusDurationSeconds,
                    isRunning: false,
                };
            }
            return {};
        }

        return {
            focusDurationSeconds: DEFAULT_FOCUS,
            breakDurationSeconds: DEFAULT_BREAK,
            totalRounds: DEFAULT_ROUNDS,
            currentRound: 1,
            remainingSeconds: DEFAULT_FOCUS,
            currentPhase: 'focus',
            isRunning: false,
            isPinned: false,
            autoStartBreak: true,
            consecutiveCompletedFocus: 0,

            start: () => {
                const state = get();
                if (state.currentPhase === 'completed') {
                    accumulator = 0;
                    set({
                        currentRound: 1,
                        currentPhase: 'focus',
                        remainingSeconds: state.focusDurationSeconds,
                        isRunning: true,
                    });
                    return;
                }
                set({ isRunning: true });
            },
            pause: () => set({ isRunning: false }),
            skip: () => {
                const state = get();
                if (!state.isRunning || state.currentPhase === 'completed') return;
                accumulator = 0;
                set(advancePhase(state));
            },
            reset: () => {
                accumulator = 0;
                const { focusDurationSeconds } = get();
                set({
                    isRunning: false,
                    currentRound: 1,
                    currentPhase: 'focus',
                    remainingSeconds: focusDurationSeconds,
                    consecutiveCompletedFocus: 0,
                });
            },
            togglePin: () => set((s) => ({ isPinned: !s.isPinned })),
            applySettings: (focusSeconds, breakSeconds, totalRounds, resetProgress) => {
                set({
                    focusDurationSeconds: focusSeconds,
                    breakDurationSeconds: breakSeconds,
                    totalRounds,
                });
                if (resetProgress) {
                    accumulator = 0;
                    set({
                        isRunning: false,
                        currentRound: 1,
                        currentPhase: 'focus',
                        remainingSeconds: focusSeconds,
                    });
                }
            },
            tick: (deltaSeconds) => {
                const state = get();
                if (!state.isRunning || state.currentPhase === 'completed') return;
                accumulator += deltaSeconds;
                while (accumulator >= 1) {
                    accumulator -= 1;
                    const next = state.remainingSeconds - 1;
                    if (next > 0) {
                        set({ remainingSeconds: next });
                        return;
                    }
                    set({ remainingSeconds: 0, ...advancePhase(get()) });
                    return;
                }
            },
        };
    });
}

function detectIsSettingsWindow(): boolean {
    if (typeof window === 'undefined') return false;
    return new URLSearchParams(window.location.search).get('window') === 'settings';
}

export const usePomodoroStore: PomodoroStore = createPomodoroStore({
    isSettingsWindow: detectIsSettingsWindow(),
});

export function formatMmSs(totalSeconds: number): string {
    const safe = Math.max(0, Math.floor(totalSeconds));
    const minutes = Math.floor(safe / 60);
    const seconds = safe % 60;
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}
