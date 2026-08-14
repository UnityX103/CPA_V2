import { create, type StoreApi, type UseBoundStore } from 'zustand';
import { dispatch } from './bridge/dispatch';
import { BRIDGE_VERSION } from './bridge/protocol';

export type PomodoroPhase = 'focus' | 'break' | 'completed';
export type PomodoroEndActionMode = 'topWindow';
export type PomodoroPinSource = 'manual' | 'focusEndAuto' | null;

export interface PomodoroEndEvent {
    id: number;
    fromPhase: PomodoroPhase;
    toPhase: PomodoroPhase;
    triggeredBy: 'timer' | 'skip';
}

export interface PomodoroState {
    focusDurationSeconds: number;
    breakDurationSeconds: number;
    totalRounds: number;
    currentRound: number;
    remainingSeconds: number;
    currentPhase: PomodoroPhase;
    isRunning: boolean;
    isPinned: boolean;
    pinSource: PomodoroPinSource;
    autoStartBreak: boolean;
    autoPinAfterFocus: boolean;
    consecutiveCompletedFocus: number;
    endActionMode: PomodoroEndActionMode;
    lastEndEvent: PomodoroEndEvent | null;
}

export interface PomodoroActions {
    start: () => void;
    pause: () => void;
    skip: () => void;
    reset: () => void;
    togglePin: () => void;
    setPinned: (isPinned: boolean) => void;
    setPinnedFromFocusEnd: () => void;
    setAutoPinAfterFocus: (enabled: boolean) => void;
    applySettings: (
        focusSeconds: number,
        breakSeconds: number,
        totalRounds: number,
        resetProgress: boolean,
        autoStartBreak: boolean,
    ) => void;
    tick: (deltaSeconds: number) => void;
}

const DEFAULT_FOCUS = 25 * 60;
const DEFAULT_BREAK = 5 * 60;
const DEFAULT_ROUNDS = 4;
const DEFAULT_END_ACTION_MODE: PomodoroEndActionMode = 'topWindow';

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
            pinSource: null,
            autoStartBreak: false,
            autoPinAfterFocus: true,
            consecutiveCompletedFocus: 0,
            endActionMode: DEFAULT_END_ACTION_MODE,
            lastEndEvent: null,
            start: () => {},
            pause: () => {},
            skip: () => {},
            reset: () => {},
            togglePin: () => {},
            setPinned: () => {},
            setPinnedFromFocusEnd: () => {},
            setAutoPinAfterFocus: (enabled) => {
                void dispatch({
                    v: BRIDGE_VERSION,
                    store: 'pomodoro',
                    action: 'setAutoPinAfterFocus',
                    args: [enabled],
                });
            },
            applySettings: (focusSeconds, breakSeconds, totalRounds, resetProgress, autoStartBreak) => {
                void dispatch({
                    v: BRIDGE_VERSION,
                    store: 'pomodoro',
                    action: 'applySettings',
                    args: [focusSeconds, breakSeconds, totalRounds, resetProgress, autoStartBreak],
                });
            },
            tick: () => {},
        }));
    }
    return create<PomodoroState & PomodoroActions>((set, get) => {
        let accumulator = 0;
        let nextEndEventId = 1;

        function makeEndEvent(
            state: PomodoroState,
            toPhase: PomodoroPhase,
            triggeredBy: PomodoroEndEvent['triggeredBy'],
        ): PomodoroEndEvent {
            return {
                id: nextEndEventId++,
                fromPhase: state.currentPhase,
                toPhase,
                triggeredBy,
            };
        }

        function advancePhase(
            state: PomodoroState,
            triggeredBy: PomodoroEndEvent['triggeredBy'],
        ): Partial<PomodoroState> {
            if (state.currentPhase === 'focus') {
                // 阶段切换时一律清零 accumulator，避免新阶段第一秒被吞掉（adversarial-review #7）
                accumulator = 0;
                return {
                    currentPhase: 'break',
                    remainingSeconds: state.breakDurationSeconds,
                    isRunning: state.autoStartBreak,
                    consecutiveCompletedFocus: state.consecutiveCompletedFocus + 1,
                    lastEndEvent: makeEndEvent(state, 'break', triggeredBy),
                };
            }
            if (state.currentPhase === 'break') {
                accumulator = 0;
                const nextRound = state.currentRound + 1;
                if (nextRound > state.totalRounds) {
                    return {
                        currentPhase: 'completed',
                        isRunning: false,
                        remainingSeconds: 0,
                        lastEndEvent: makeEndEvent(state, 'completed', triggeredBy),
                    };
                }
                return {
                    currentRound: nextRound,
                    currentPhase: 'focus',
                    remainingSeconds: state.focusDurationSeconds,
                    isRunning: false,
                    lastEndEvent: makeEndEvent(state, 'focus', triggeredBy),
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
            pinSource: null,
            autoStartBreak: false,
            autoPinAfterFocus: true,
            consecutiveCompletedFocus: 0,
            endActionMode: DEFAULT_END_ACTION_MODE,
            lastEndEvent: null,

            start: () => {
                const state = get();
                const autoPinReset =
                    state.isPinned && state.pinSource === 'focusEndAuto'
                        ? { isPinned: false, pinSource: null as PomodoroPinSource }
                        : {};
                if (state.currentPhase === 'completed') {
                    accumulator = 0;
                    set({
                        currentRound: 1,
                        currentPhase: 'focus',
                        remainingSeconds: state.focusDurationSeconds,
                        isRunning: true,
                        lastEndEvent: null,
                        ...autoPinReset,
                    });
                    return;
                }
                set({
                    isRunning: true,
                    ...(state.currentPhase === 'focus' ? autoPinReset : {}),
                });
            },
            pause: () => set({ isRunning: false }),
            skip: () => {
                const state = get();
                if (!state.isRunning || state.currentPhase === 'completed') return;
                accumulator = 0;
                set(advancePhase(state, 'skip'));
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
                    lastEndEvent: null,
                });
            },
            togglePin: () => set((s) => {
                const isPinned = !s.isPinned;
                return {
                    isPinned,
                    pinSource: isPinned ? 'manual' : null,
                };
            }),
            setPinned: (isPinned) => set((s) => (
                s.isPinned === isPinned && s.pinSource === (isPinned ? 'manual' : null)
                    ? s
                    : { isPinned, pinSource: isPinned ? 'manual' : null }
            )),
            setPinnedFromFocusEnd: () => {
                const state = get();
                if (!state.autoPinAfterFocus || state.isPinned) return;
                set({ isPinned: true, pinSource: 'focusEndAuto' });
            },
            setAutoPinAfterFocus: (autoPinAfterFocus) => set({ autoPinAfterFocus }),
            applySettings: (focusSeconds, breakSeconds, totalRounds, resetProgress, autoStartBreak) => {
                set({
                    focusDurationSeconds: focusSeconds,
                    breakDurationSeconds: breakSeconds,
                    totalRounds,
                    autoStartBreak,
                });
                if (resetProgress) {
                    accumulator = 0;
                    set({
                        isRunning: false,
                        currentRound: 1,
                        currentPhase: 'focus',
                        remainingSeconds: focusSeconds,
                        lastEndEvent: null,
                    });
                }
            },
            tick: (deltaSeconds) => {
                const state = get();
                if (!state.isRunning || state.currentPhase === 'completed') return;
                accumulator += deltaSeconds;

                const elapsedWholeSeconds = Math.floor(accumulator);
                if (elapsedWholeSeconds < 1) return;

                const current = get();
                if (elapsedWholeSeconds < current.remainingSeconds) {
                    accumulator -= elapsedWholeSeconds;
                    set({ remainingSeconds: current.remainingSeconds - elapsedWholeSeconds });
                    return;
                }

                accumulator = 0;
                set({ ...advancePhase(current, 'timer') });
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
