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
export type {
    PresencePreferences,
    RestDeskReminderMode,
} from './presencePersistence';

export const INPUT_ACTIVITY_RECENT_MS = 30_000;
export type InputActivityAvailability = 'disabled' | 'waiting' | 'ready' | 'error';

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
    inputActivityAvailability: InputActivityAvailability;
    inputIdleMs: number | null;
    inputSampleAt: number | null;
    cameraPresence: ConfirmedPresence;
    cameraSampleAt: number | null;
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
        inputActivityAvailability: 'disabled',
        inputIdleMs: null,
        inputSampleAt: null,
        cameraPresence: 'unknown',
        cameraSampleAt: null,
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
            ? { notice: notice('摄像头不可用，摄像头自动控制暂不可用') }
            : {}),
        ...(capability.availability === 'ready'
            ? {}
            : { consecutiveAbsentSamples: 0, cameraPresence: 'unknown', cameraSampleAt: null }),
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
                inputActivityAvailability: normalized.inputActivityEnabled ? 'waiting' : 'disabled',
                inputIdleMs: null,
                inputSampleAt: null,
                cameraPresence: 'unknown',
                cameraSampleAt: null,
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
            const inputChanged = previous.inputActivityEnabled !== normalized.inputActivityEnabled;
            const cameraChanged = previous.cameraDeviceId !== normalized.cameraDeviceId;
            const intervalChanged = previous.intervalSeconds !== normalized.intervalSeconds;
            const sensitivityChanged = previous.absenceSensitivity
                !== normalized.absenceSensitivity;
            const monitorChanged = enabledChanged || cameraChanged || intervalChanged;
            set((state) => ({
                ...normalized,
                ...(inputChanged ? {
                    inputActivityAvailability: normalized.inputActivityEnabled ? 'waiting' as const : 'disabled' as const,
                    inputIdleMs: null,
                    inputSampleAt: null,
                } : {}),
                ...(enabledChanged || cameraChanged ? { cameraPresence: 'unknown' as const, cameraSampleAt: null } : {}),
                availability: normalized.enabled
                    ? (enabledChanged ? 'checking' : state.availability)
                    : 'disabled',
                generation: monitorChanged ? state.generation + 1 : state.generation,
                confirmedPresence: enabledChanged || cameraChanged || inputChanged ? 'unknown' : state.confirmedPresence,
                lastSuccessfulAt: enabledChanged || cameraChanged ? null : state.lastSuccessfulAt,
                lastError: enabledChanged || cameraChanged ? null : state.lastError,
                inFlight: monitorChanged ? false : state.inFlight,
                consecutiveAbsentSamples: monitorChanged || sensitivityChanged
                    ? 0
                    : state.consecutiveAbsentSamples,
            }));
            if ((previous.enabled || previous.inputActivityEnabled) && !normalized.enabled && !normalized.inputActivityEnabled) {
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
                const capability = await invoke<PresenceCapability>('request_camera_presence_access', {
                    cameraDeviceId: get().cameraDeviceId,
                });
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
                const capability = await invoke<PresenceCapability>('camera_presence_status', {
                    cameraDeviceId: get().cameraDeviceId,
                });
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

// Each source keeps its own evidence; input polls must never count as camera misses.
export function applyPresenceSample(
    store: PresenceStore,
    pomodoro: PomodoroStore,
    sample: PresenceSample,
    nowMs: number,
): void {
    const current = store.getState();
    const required = presenceAbsencePolicy(current.absenceSensitivity).requiredAbsentSamples;
    const misses = sample.observation === 'absent'
        ? Math.min(current.consecutiveAbsentSamples + 1, required) : 0;
    const cameraPresence = sample.observation === 'absent' && misses < required
        ? current.cameraPresence : sample.observation;
    store.setState({
        availability: sample.availability,
        cameraPresence,
        cameraSampleAt: nowMs,
        lastError: sample.errorCode,
        inFlight: false,
        consecutiveAbsentSamples: misses,
        ...(terminalAvailability(sample.availability) && sample.availability !== current.availability
            ? { notice: notice('摄像头不可用，摄像头自动控制暂不可用') } : {}),
    });
    applyCombinedPresence(store, pomodoro, nowMs, sample.observation !== 'absent' || misses >= required
        || (current.inputActivityEnabled && pomodoro.getState().currentPhase === 'break'));
}

export function applyInputActivitySample(
    store: PresenceStore,
    pomodoro: PomodoroStore,
    idleMs: number | null,
    nowMs: number,
): void {
    const valid = idleMs !== null && Number.isFinite(idleMs) && idleMs >= 0;
    store.setState({
        inputActivityAvailability: valid ? 'ready' : 'error',
        inputIdleMs: valid ? idleMs : null,
        inputSampleAt: nowMs,
    });
    applyCombinedPresence(store, pomodoro, nowMs);
}

export function applyCombinedPresence(store: PresenceStore, pomodoro: PomodoroStore, nowMs: number, control = true): void {
    const current = store.getState();
    const pomo = pomodoro.getState();
    let observation = current.enabled ? current.cameraPresence : 'unknown';
    const inputEnabled = current.inputActivityEnabled && pomo.currentPhase === 'break';
    if (inputEnabled) {
        const cameraFresh = current.cameraSampleAt !== null
            && nowMs - current.cameraSampleAt <= current.intervalSeconds * 1000 + SAMPLE_TIMEOUT_MS;
        const camera = current.enabled && cameraFresh ? current.cameraPresence : 'unknown';
        const inputFresh = current.inputSampleAt !== null && nowMs - current.inputSampleAt <= 10_000;
        const input = current.inputActivityAvailability === 'ready' && inputFresh && current.inputIdleMs !== null
            ? (current.inputIdleMs + nowMs - current.inputSampleAt! < INPUT_ACTIVITY_RECENT_MS ? 'present' : 'absent')
            : 'unknown';
        observation = camera === 'present' || input === 'present' ? 'present'
            : input === 'absent' && (!current.enabled || camera === 'absent') ? 'absent' : 'unknown';
    }
    store.setState({
        confirmedPresence: observation,
        ...(observation !== 'unknown' ? { lastSuccessfulAt: nowMs } : {}),
    });
    if (!control || observation === 'unknown') return;
    if (observation === 'absent') {
        if (pomo.currentPhase === 'break') {
            if (pomodoro.getState().resumeBreakFromPresence()) {
                store.setState({ notice: notice('检测到离开，已继续休息') });
            }
        } else if (pomo.currentPhase === 'focus' && pomo.isRunning
            && pomodoro.getState().pauseFocusFromPresence()) {
            store.setState({ notice: notice('检测到离开，已暂停专注') });
        }
        return;
    }
    if (pomo.currentPhase === 'break') {
        if (pomodoro.getState().pauseBreakFromPresence()) {
            store.setState({ notice: notice('仍在工位，已暂停休息') });
        }
        return;
    }
    const focusStarted = pomodoro.getState().startFocusFromPresence();
    const focusResumed = !focusStarted && pomodoro.getState().resumeFocusFromPresence();
    if (focusStarted || focusResumed) {
        store.setState({ notice: notice(focusStarted ? '检测到在场，已开始专注' : '检测到返回，已继续专注') });
    }
}

interface PresenceMonitorRuntime {
    invokeCapability: (cameraDeviceId: string | null) => Promise<PresenceCapability>;
    invokeSample: (
        intervalSeconds: number,
        cameraDeviceId: string | null,
    ) => Promise<PresenceSample>;
    stopSampleStream?: () => Promise<unknown>;
    now: () => number;
    setInterval: (callback: () => void, delayMs: number) => number;
    clearInterval: (id: number) => void;
    setTimeout: (callback: () => void, delayMs: number) => number;
    clearTimeout: (id: number) => void;
}

const defaultMonitorRuntime: PresenceMonitorRuntime = {
    invokeCapability: (cameraDeviceId) => invoke<PresenceCapability>('camera_presence_status', {
        cameraDeviceId,
    }),
    invokeSample: (intervalSeconds, cameraDeviceId) => invoke<PresenceSample>('sample_camera_presence', {
        intervalSeconds,
        cameraDeviceId,
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
    const cameraDeviceId = store.getState().cameraDeviceId;
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
            const result = await Promise.race([
                runtime.invokeSample(intervalSeconds, cameraDeviceId),
                timeout,
            ]);
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
            const capability = await runtime.invokeCapability(cameraDeviceId);
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
    const cameraDeviceId = usePresenceStore((state) => state.cameraDeviceId);
    const intervalSeconds = usePresenceStore((state) => state.intervalSeconds);
    const generation = usePresenceStore((state) => state.generation);

    useEffect(() => {
        if (!enabled || !presenceEnabled) return undefined;
        return startPresenceMonitor({
            store: usePresenceStore,
            pomodoro: usePomodoroStore,
        });
    }, [enabled, presenceEnabled, cameraDeviceId, intervalSeconds, generation]);

    useEffect(() => {
        if (!enabled || presenceEnabled) return;
        void invoke('stop_camera_presence_stream').catch(() => {});
    }, [enabled, presenceEnabled]);
}
