import { useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { create, type StoreApi, type UseBoundStore } from 'zustand';
import { dispatch, dispatchConfirmed } from './bridge/dispatch';
import { BRIDGE_VERSION } from './bridge/protocol';
import {
    presenceAutomationContextSignature,
    usePomodoroStore,
    type PomodoroStore,
} from './pomodoro';
import {
    presenceAbsencePolicy,
} from './presencePolicy';
import {
    DEFAULT_PRESENCE_PREFERENCES,
    normalizePresencePreferences,
    savePresencePreferences,
    type PresencePreferences,
} from './presencePersistence';

export { PRESENCE_ABSENCE_POLICIES } from './presencePolicy';
export type { PresenceAbsenceSensitivity } from './presencePolicy';
export type { PresencePreferences } from './presencePersistence';

export type PresencePlatform = 'macos' | 'windows' | 'other';
export type PresenceAvailability =
    | 'disabled'
    | 'permissionRequired'
    | 'checking'
    | 'ready'
    | 'permissionDenied'
    | 'noDevice'
    | 'busy'
    | 'error';
export type NativePresenceAvailability = Exclude<PresenceAvailability, 'disabled' | 'checking'>;
export type PresenceObservation = 'present' | 'absent' | 'unknown';
export type ConfirmedPresence = PresenceObservation;

export interface PresenceCapability {
    platform: PresencePlatform;
    availability: NativePresenceAvailability;
}

export interface PresenceSample {
    observation: PresenceObservation;
    availability: Exclude<NativePresenceAvailability, 'permissionRequired'>;
    errorCode: string | null;
}

export interface PresenceNotice {
    id: number;
    message: string;
}

interface PresenceState extends PresencePreferences {
    platform: PresencePlatform;
    availability: PresenceAvailability;
    confirmedPresence: ConfirmedPresence;
    lastSuccessfulAt: number | null;
    lastError: string | null;
    inFlight: boolean;
    generation: number;
    consecutiveAbsentSamples: number;
    notice: PresenceNotice | null;
}

interface PresenceActions {
    hydrate: (preferences: PresencePreferences) => void;
    applySettings: (preferences: PresencePreferences) => Promise<void> | void;
    requestAccess: () => Promise<void> | void;
    retry: () => Promise<void> | void;
    openPrivacySettings: () => Promise<void> | void;
}

type PresenceStoreState = PresenceState & PresenceActions;
export type PresenceStore = UseBoundStore<StoreApi<PresenceStoreState>>;

let nextNoticeId = 1;

// A single face-detector miss is common while the user leans on a hand,
// turns sideways, or adjusts the camera. Return detection stays immediate;
// the selected level controls how much absence evidence is required.
function initialPresenceState(): PresenceState {
    return {
        ...DEFAULT_PRESENCE_PREFERENCES,
        platform: 'other',
        availability: 'disabled',
        confirmedPresence: 'unknown',
        lastSuccessfulAt: null,
        lastError: null,
        inFlight: false,
        generation: 0,
        consecutiveAbsentSamples: 0,
        notice: null,
    };
}

function notice(message: string): PresenceNotice {
    return { id: nextNoticeId++, message };
}

function terminalAvailability(availability: PresenceAvailability): boolean {
    return availability === 'permissionDenied' || availability === 'noDevice';
}

function capabilityState(
    previous: PresenceState,
    capability: PresenceCapability,
): Partial<PresenceState> {
    const becameUnavailable = terminalAvailability(capability.availability)
        && capability.availability !== previous.availability;
    return {
        platform: capability.platform,
        availability: capability.availability,
        inFlight: false,
        lastError: terminalAvailability(capability.availability)
            ? capability.availability
            : null,
        ...(becameUnavailable
            ? { notice: notice('摄像头不可用，自动控制暂不可用') }
            : {}),
        ...(capability.availability === 'ready'
            ? {}
            : { consecutiveAbsentSamples: 0 }),
    };
}

export function createPresenceStore(opts: { isSettingsWindow: boolean }): PresenceStore {
    if (opts.isSettingsWindow) {
        return create<PresenceStoreState>(() => ({
            ...initialPresenceState(),
            hydrate: () => {},
            applySettings: (preferences) => dispatchConfirmed({
                v: BRIDGE_VERSION,
                store: 'presence',
                action: 'applySettings',
                args: [normalizePresencePreferences(preferences)],
            }, { replyTo: 'settings' }),
            requestAccess: () => dispatch({
                v: BRIDGE_VERSION,
                store: 'presence',
                action: 'requestAccess',
                args: [],
            }),
            retry: () => dispatch({
                v: BRIDGE_VERSION,
                store: 'presence',
                action: 'retry',
                args: [],
            }),
            openPrivacySettings: () => dispatch({
                v: BRIDGE_VERSION,
                store: 'presence',
                action: 'openPrivacySettings',
                args: [],
            }),
        }));
    }

    return create<PresenceStoreState>((set, get) => ({
        ...initialPresenceState(),
        hydrate: (preferences) => {
            const normalized = normalizePresencePreferences(preferences);
            set((state) => ({
                ...normalized,
                availability: normalized.enabled ? 'checking' : 'disabled',
                generation: state.generation + 1,
                confirmedPresence: 'unknown',
                lastSuccessfulAt: null,
                lastError: null,
                inFlight: false,
                consecutiveAbsentSamples: 0,
            }));
        },
        applySettings: async (preferences) => {
            const normalized = normalizePresencePreferences(preferences);
            const previous = get();
            const enabledChanged = previous.enabled !== normalized.enabled;
            const intervalChanged = previous.intervalSeconds !== normalized.intervalSeconds;
            const sensitivityChanged = previous.absenceSensitivity
                !== normalized.absenceSensitivity;
            const monitorChanged = enabledChanged || intervalChanged;
            set((state) => ({
                ...normalized,
                availability: normalized.enabled
                    ? (enabledChanged ? 'checking' : state.availability)
                    : 'disabled',
                generation: monitorChanged ? state.generation + 1 : state.generation,
                confirmedPresence: enabledChanged ? 'unknown' : state.confirmedPresence,
                lastSuccessfulAt: enabledChanged ? null : state.lastSuccessfulAt,
                lastError: enabledChanged ? null : state.lastError,
                inFlight: monitorChanged ? false : state.inFlight,
                consecutiveAbsentSamples: monitorChanged || sensitivityChanged
                    ? 0
                    : state.consecutiveAbsentSamples,
            }));
            if (previous.enabled && !normalized.enabled) {
                usePomodoroStore.getState().clearPresenceAutomationOwnership();
            }
            await savePresencePreferences(normalized);
        },
        requestAccess: async () => {
            set((state) => ({
                availability: 'checking',
                inFlight: true,
                confirmedPresence: 'unknown',
                lastSuccessfulAt: null,
                lastError: null,
                generation: state.generation + 1,
                consecutiveAbsentSamples: 0,
            }));
            try {
                const capability = await invoke<PresenceCapability>('request_camera_presence_access');
                set((state) => ({
                    ...capabilityState(state, capability),
                    generation: state.generation + 1,
                }));
            } catch (error) {
                set((state) => ({
                    availability: 'error',
                    inFlight: false,
                    lastError: String(error),
                    generation: state.generation + 1,
                }));
            }
        },
        retry: async () => {
            set((state) => ({
                availability: 'checking',
                inFlight: true,
                confirmedPresence: 'unknown',
                lastSuccessfulAt: null,
                lastError: null,
                generation: state.generation + 1,
                consecutiveAbsentSamples: 0,
            }));
            try {
                const capability = await invoke<PresenceCapability>('camera_presence_status');
                set((state) => ({
                    ...capabilityState(state, capability),
                    generation: state.generation + 1,
                }));
            } catch (error) {
                set((state) => ({
                    availability: 'error',
                    inFlight: false,
                    lastError: String(error),
                    generation: state.generation + 1,
                }));
            }
        },
        openPrivacySettings: async () => {
            try {
                await invoke('open_camera_privacy_settings');
            } catch (error) {
                set({ lastError: String(error) });
            }
        },
    }));
}

function detectIsSettingsWindow(): boolean {
    if (typeof window === 'undefined') return false;
    return new URLSearchParams(window.location.search).get('window') === 'settings';
}

export const usePresenceStore = createPresenceStore({
    isSettingsWindow: detectIsSettingsWindow(),
});

export function applyPresenceCapability(
    store: PresenceStore,
    capability: PresenceCapability,
): void {
    store.setState((state) => capabilityState(state, capability));
}

function applyLivePresenceSample(
    store: PresenceStore,
    sample: PresenceSample,
    nowMs: number,
): void {
    const current = store.getState();
    const availabilityChanged = sample.availability !== current.availability;
    const becameUnavailable = terminalAvailability(sample.availability) && availabilityChanged;

    if (sample.observation === 'unknown') {
        store.setState({
            availability: sample.availability,
            confirmedPresence: 'unknown',
            lastError: sample.errorCode,
            inFlight: false,
            consecutiveAbsentSamples: 0,
            ...(becameUnavailable
                ? { notice: notice('摄像头不可用，自动控制暂不可用') }
                : {}),
        });
        return;
    }

    store.setState({
        availability: sample.availability,
        confirmedPresence: sample.observation,
        lastSuccessfulAt: nowMs,
        lastError: sample.errorCode,
        inFlight: false,
    });
}

export function applyPresenceSample(
    store: PresenceStore,
    pomodoro: PomodoroStore,
    sample: PresenceSample,
    nowMs: number,
): void {
    const current = store.getState();
    const pomo = pomodoro.getState();

    if (sample.observation === 'unknown') {
        applyLivePresenceSample(store, sample, nowMs);
        return;
    }

    if (sample.observation === 'absent') {
        const requiredSamples = presenceAbsencePolicy(
            current.absenceSensitivity,
        ).requiredAbsentSamples;
        const consecutiveAbsentSamples = Math.min(
            current.consecutiveAbsentSamples + 1,
            requiredSamples,
        );
        const confirmed = consecutiveAbsentSamples >= requiredSamples;
        store.setState({
            availability: sample.availability,
            confirmedPresence: confirmed ? 'absent' : current.confirmedPresence,
            lastSuccessfulAt: nowMs,
            lastError: sample.errorCode,
            inFlight: false,
            consecutiveAbsentSamples,
        });
        if (!confirmed) return;
        if (pomo.currentPhase !== 'focus' || !pomo.isRunning) return;
        pomodoro.getState().pauseFocusFromPresence();
        store.setState({ notice: notice('检测到离开，已暂停专注') });
        return;
    }

    store.setState({
        availability: sample.availability,
        confirmedPresence: 'present',
        lastSuccessfulAt: nowMs,
        lastError: sample.errorCode,
        inFlight: false,
        consecutiveAbsentSamples: 0,
    });

    const focusStarted = pomodoro.getState().startFocusFromPresence();
    const breakFinished = !focusStarted
        && pomodoro.getState().finishBreakFromPresence();
    if (focusStarted || breakFinished) {
        store.setState({ notice: notice('检测到在岗，已开始专注') });
        return;
    }

    if (pomo.currentPhase === 'focus' && !pomo.isRunning && pomo.presenceOwnedPause) {
        pomodoro.getState().resumeFocusFromPresence();
        store.setState({ notice: notice('检测到返回，已继续专注') });
    }
}

interface PresenceMonitorRuntime {
    invokeCapability: () => Promise<PresenceCapability>;
    invokeSample: (intervalSeconds: number) => Promise<PresenceSample>;
    stopSampleStream?: () => Promise<unknown>;
    now: () => number;
    setInterval: (callback: () => void, delayMs: number) => number;
    clearInterval: (id: number) => void;
    setTimeout: (callback: () => void, delayMs: number) => number;
    clearTimeout: (id: number) => void;
}

const defaultMonitorRuntime: PresenceMonitorRuntime = {
    invokeCapability: () => invoke<PresenceCapability>('camera_presence_status'),
    invokeSample: (intervalSeconds) => invoke<PresenceSample>('sample_camera_presence', {
        intervalSeconds,
    }),
    stopSampleStream: () => invoke('stop_camera_presence_stream'),
    now: () => performance.now(),
    setInterval: (callback, delayMs) => window.setInterval(callback, delayMs),
    clearInterval: (id) => window.clearInterval(id),
    setTimeout: (callback, delayMs) => window.setTimeout(callback, delayMs),
    clearTimeout: (id) => window.clearTimeout(id),
};

// Native supervision terminates the helper at 10 seconds. This fallback only
// protects the UI if IPC itself stalls after native cleanup should have finished.
const SAMPLE_TIMEOUT_MS = 12_000;

export function startPresenceMonitor({
    store,
    pomodoro,
    runtime = defaultMonitorRuntime,
}: {
    store: PresenceStore;
    pomodoro: PomodoroStore;
    runtime?: PresenceMonitorRuntime;
}): () => void {
    const generation = store.getState().generation;
    let stopped = false;
    let intervalId: number | null = null;
    let inFlight = false;
    const intervalSeconds = store.getState().intervalSeconds;
    const intervalMs = intervalSeconds * 1000;

    const isCurrent = () => !stopped
        && store.getState().enabled
        && store.getState().generation === generation;

    const stopInterval = () => {
        if (intervalId != null) {
            runtime.clearInterval(intervalId);
            intervalId = null;
        }
    };
    const stopSampleStream = () => {
        const stop = runtime.stopSampleStream;
        if (stop) void stop().catch(() => {});
    };

    const unsubscribePomodoro = pomodoro.subscribe((state, previous) => {
        const contextChanged = presenceAutomationContextSignature(state)
            !== presenceAutomationContextSignature(previous);
        if (contextChanged) store.setState({ consecutiveAbsentSamples: 0 });
    });

    const sample = async () => {
        if (!isCurrent() || inFlight) return;
        inFlight = true;
        store.setState({ inFlight: true });
        let timeoutId: number | null = null;
        const timeout = new Promise<PresenceSample>((resolve) => {
            timeoutId = runtime.setTimeout(() => resolve({
                observation: 'unknown',
                availability: 'error',
                errorCode: 'sampleTimeout',
            }), SAMPLE_TIMEOUT_MS);
        });
        const applyResult = (result: PresenceSample) => {
            applyPresenceSample(store, pomodoro, result, runtime.now());
        };
        try {
            const result = await Promise.race([runtime.invokeSample(intervalSeconds), timeout]);
            if (!isCurrent()) return;
            applyResult(result);
            if (terminalAvailability(result.availability)) {
                stopInterval();
                stopSampleStream();
            }
        } catch (error) {
            if (!isCurrent()) return;
            applyResult({
                observation: 'unknown',
                availability: 'error',
                errorCode: String(error),
            });
        } finally {
            if (timeoutId != null) runtime.clearTimeout(timeoutId);
            inFlight = false;
            if (isCurrent()) store.setState({ inFlight: false });
        }
    };

    const initialize = async () => {
        if (!isCurrent()) return;
        store.setState({ availability: 'checking', inFlight: true });
        try {
            const capability = await runtime.invokeCapability();
            if (!isCurrent()) return;
            applyPresenceCapability(store, capability);
            if (capability.availability === 'permissionRequired'
                || terminalAvailability(capability.availability)) {
                stopSampleStream();
                return;
            }
            intervalId = runtime.setInterval(() => { void sample(); }, intervalMs);
            if (capability.availability === 'ready') void sample();
        } catch (error) {
            if (!isCurrent()) return;
            store.setState({
                availability: 'error',
                inFlight: false,
                lastError: String(error),
            });
            intervalId = runtime.setInterval(() => { void sample(); }, intervalMs);
        }
    };

    void initialize();

    return () => {
        stopped = true;
        stopInterval();
        unsubscribePomodoro();
    };
}

export function usePresenceMonitor({ enabled }: { enabled: boolean }): void {
    const presenceEnabled = usePresenceStore((state) => state.enabled);
    const intervalSeconds = usePresenceStore((state) => state.intervalSeconds);
    const generation = usePresenceStore((state) => state.generation);

    useEffect(() => {
        if (!enabled || !presenceEnabled) return undefined;
        return startPresenceMonitor({
            store: usePresenceStore,
            pomodoro: usePomodoroStore,
        });
    }, [enabled, presenceEnabled, intervalSeconds, generation]);

    useEffect(() => {
        if (!enabled || presenceEnabled) return;
        void invoke('stop_camera_presence_stream').catch(() => {});
    }, [enabled, presenceEnabled]);
}
