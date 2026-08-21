import { useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { create, type StoreApi, type UseBoundStore } from 'zustand';
import { dispatch, dispatchConfirmed } from './bridge/dispatch';
import { BRIDGE_VERSION } from './bridge/protocol';
import { usePomodoroStore, type PomodoroStore } from './pomodoro';
import {
    DEFAULT_PRESENCE_PREFERENCES,
    normalizePresencePreferences,
    savePresencePreferences,
    type PresencePreferences,
} from './presencePersistence';

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
    latestObservation: PresenceObservation;
    lastSuccessfulAt: number | null;
    lastError: string | null;
    inFlight: boolean;
    generation: number;
    candidateDirection: Exclude<PresenceObservation, 'unknown'> | null;
    candidateFirstAt: number | null;
    candidateLastAt: number | null;
    candidateCount: number;
    observedPomodoroEpoch: number;
    notice: PresenceNotice | null;
}

interface PresenceActions {
    hydrate: (preferences: PresencePreferences) => void;
    applySettings: (preferences: PresencePreferences) => Promise<void> | void;
    requestAccess: () => Promise<void> | void;
    retry: () => Promise<void> | void;
    openPrivacySettings: () => Promise<void> | void;
    clearEvidence: () => void;
}

type PresenceStoreState = PresenceState & PresenceActions;
export type PresenceStore = UseBoundStore<StoreApi<PresenceStoreState>>;

let nextNoticeId = 1;

function initialPresenceState(): PresenceState {
    return {
        ...DEFAULT_PRESENCE_PREFERENCES,
        platform: 'other',
        availability: 'disabled',
        latestObservation: 'unknown',
        lastSuccessfulAt: null,
        lastError: null,
        inFlight: false,
        generation: 0,
        candidateDirection: null,
        candidateFirstAt: null,
        candidateLastAt: null,
        candidateCount: 0,
        observedPomodoroEpoch: 0,
        notice: null,
    };
}

function evidenceReset(): Pick<PresenceState,
    'candidateDirection' | 'candidateFirstAt' | 'candidateLastAt' | 'candidateCount'
> {
    return {
        candidateDirection: null,
        candidateFirstAt: null,
        candidateLastAt: null,
        candidateCount: 0,
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
        ...(capability.availability === 'ready' ? {} : evidenceReset()),
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
            clearEvidence: () => {},
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
                latestObservation: 'unknown',
                lastSuccessfulAt: null,
                lastError: null,
                inFlight: false,
                ...evidenceReset(),
            }));
        },
        applySettings: async (preferences) => {
            const normalized = normalizePresencePreferences(preferences);
            const wasEnabled = get().enabled;
            set((state) => ({
                ...normalized,
                availability: normalized.enabled ? 'checking' : 'disabled',
                generation: state.generation + 1,
                latestObservation: 'unknown',
                lastSuccessfulAt: null,
                lastError: null,
                inFlight: false,
                ...evidenceReset(),
            }));
            if (wasEnabled && !normalized.enabled) {
                usePomodoroStore.getState().clearPresenceAutomationOwnership();
            }
            await savePresencePreferences(normalized);
        },
        requestAccess: async () => {
            set((state) => ({
                availability: 'checking',
                inFlight: true,
                latestObservation: 'unknown',
                lastSuccessfulAt: null,
                lastError: null,
                generation: state.generation + 1,
                ...evidenceReset(),
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
                    ...evidenceReset(),
                }));
            }
        },
        retry: async () => {
            set((state) => ({
                availability: 'checking',
                inFlight: true,
                latestObservation: 'unknown',
                lastSuccessfulAt: null,
                lastError: null,
                generation: state.generation + 1,
                ...evidenceReset(),
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
                    ...evidenceReset(),
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
        clearEvidence: () => set(evidenceReset()),
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
            latestObservation: 'unknown',
            lastError: sample.errorCode,
            inFlight: false,
            ...(becameUnavailable
                ? { notice: notice('摄像头不可用，自动控制暂不可用') }
                : {}),
            ...evidenceReset(),
        });
        return;
    }

    const directionChanged = current.candidateDirection != null
        && current.candidateDirection !== sample.observation;
    store.setState({
        availability: sample.availability,
        latestObservation: sample.observation,
        lastSuccessfulAt: nowMs,
        lastError: sample.errorCode,
        inFlight: false,
        ...(directionChanged ? evidenceReset() : {}),
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

    const epochChanged = current.observedPomodoroEpoch !== pomo.presenceAutomationEpoch;
    const staleGap = current.candidateLastAt != null
        && nowMs - current.candidateLastAt > current.intervalSeconds * 2000;
    const sameDirection = !epochChanged
        && !staleGap
        && current.candidateDirection === sample.observation;
    const candidateFirstAt = sameDirection && current.candidateFirstAt != null
        ? current.candidateFirstAt
        : nowMs;
    const candidateCount = sameDirection ? current.candidateCount + 1 : 1;
    const thresholdSeconds = sample.observation === 'present'
        ? current.presentThresholdSeconds
        : pomo.breakDurationSeconds;
    const thresholdMet = candidateCount >= 2
        && nowMs - candidateFirstAt >= thresholdSeconds * 1000;

    store.setState({
        availability: sample.availability,
        latestObservation: sample.observation,
        lastSuccessfulAt: nowMs,
        lastError: sample.errorCode,
        inFlight: false,
        candidateDirection: sample.observation,
        candidateFirstAt,
        candidateLastAt: nowMs,
        candidateCount,
        observedPomodoroEpoch: pomo.presenceAutomationEpoch,
    });

    if (!thresholdMet) return;

    if (sample.observation === 'absent') {
        if (pomo.currentPhase !== 'focus' || !pomo.isRunning) return;
        pomodoro.getState().pauseFocusFromPresence();
        store.setState({
            notice: notice('检测到离开，已暂停专注'),
            observedPomodoroEpoch: pomodoro.getState().presenceAutomationEpoch,
            ...evidenceReset(),
        });
        return;
    }

    if (pomo.currentPhase === 'break') {
        pomodoro.getState().startFocusFromPresence();
    } else if (pomo.currentPhase === 'focus' && !pomo.isRunning && pomo.presenceOwnedPause) {
        pomodoro.getState().resumeFocusFromPresence();
        store.setState({ notice: notice('检测到返回，已继续专注') });
    } else if (
        pomo.currentPhase === 'focus'
        && !pomo.isRunning
        && pomo.presenceAutoStartEligible
    ) {
        pomodoro.getState().startFocusFromPresence();
    } else {
        return;
    }

    store.setState({
        observedPomodoroEpoch: pomodoro.getState().presenceAutomationEpoch,
        ...evidenceReset(),
    });
}

interface PresenceMonitorRuntime {
    invokeCapability: () => Promise<PresenceCapability>;
    invokeSample: () => Promise<PresenceSample>;
    now: () => number;
    setInterval: (callback: () => void, delayMs: number) => number;
    clearInterval: (id: number) => void;
    setTimeout: (callback: () => void, delayMs: number) => number;
    clearTimeout: (id: number) => void;
}

const defaultMonitorRuntime: PresenceMonitorRuntime = {
    invokeCapability: () => invoke<PresenceCapability>('camera_presence_status'),
    invokeSample: () => invoke<PresenceSample>('sample_camera_presence'),
    now: () => performance.now(),
    setInterval: (callback, delayMs) => window.setInterval(callback, delayMs),
    clearInterval: (id) => window.clearInterval(id),
    setTimeout: (callback, delayMs) => window.setTimeout(callback, delayMs),
    clearTimeout: (id) => window.clearTimeout(id),
};

// Native supervision terminates the helper at 10 seconds. This fallback only
// protects the UI if IPC itself stalls after native cleanup should have finished.
const SAMPLE_TIMEOUT_MS = 12_000;
const LIVE_OBSERVATION_INTERVAL_MS = 2_000;

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
    let lastAutomationSampleAt: number | null = null;

    const isCurrent = () => !stopped
        && store.getState().enabled
        && store.getState().generation === generation;

    const stopInterval = () => {
        if (intervalId != null) {
            runtime.clearInterval(intervalId);
            intervalId = null;
        }
    };

    const sample = async () => {
        if (!isCurrent() || inFlight) return;
        inFlight = true;
        store.setState({ availability: 'checking', inFlight: true });
        let timeoutId: number | null = null;
        const timeout = new Promise<PresenceSample>((resolve) => {
            timeoutId = runtime.setTimeout(() => resolve({
                observation: 'unknown',
                availability: 'error',
                errorCode: 'sampleTimeout',
            }), SAMPLE_TIMEOUT_MS);
        });
        const applyResult = (result: PresenceSample) => {
            const sampledAt = runtime.now();
            const automationDue = lastAutomationSampleAt == null
                || sampledAt - lastAutomationSampleAt >= store.getState().intervalSeconds * 1000;
            if (automationDue) {
                lastAutomationSampleAt = sampledAt;
                applyPresenceSample(store, pomodoro, result, sampledAt);
            } else {
                applyLivePresenceSample(store, result, sampledAt);
            }
        };
        try {
            const result = await Promise.race([runtime.invokeSample(), timeout]);
            if (!isCurrent()) return;
            applyResult(result);
            if (terminalAvailability(result.availability)) stopInterval();
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
                || terminalAvailability(capability.availability)) return;
            intervalId = runtime.setInterval(() => { void sample(); }, LIVE_OBSERVATION_INTERVAL_MS);
            if (capability.availability === 'ready') void sample();
        } catch (error) {
            if (!isCurrent()) return;
            store.setState({
                availability: 'error',
                inFlight: false,
                lastError: String(error),
                ...evidenceReset(),
            });
            intervalId = runtime.setInterval(() => { void sample(); }, LIVE_OBSERVATION_INTERVAL_MS);
        }
    };

    const unsubscribePomodoro = pomodoro.subscribe((state, previous) => {
        if (state.presenceAutomationEpoch === previous.presenceAutomationEpoch) return;
        store.setState({
            observedPomodoroEpoch: state.presenceAutomationEpoch,
            ...evidenceReset(),
        });
    });
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
}
