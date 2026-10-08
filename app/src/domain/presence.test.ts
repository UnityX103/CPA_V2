import { describe, expect, it, vi } from 'vitest';

vi.mock('./presencePersistence', async (importOriginal) => {
    const actual = await importOriginal<typeof import('./presencePersistence')>();
    return {
        ...actual,
        savePresencePreferences: vi.fn(async () => {}),
    };
});

import { createPomodoroStore } from './pomodoro';
import { DEFAULT_PRESENCE_PREFERENCES } from './presencePersistence';
import {
    applyPresenceSample,
    createPresenceStore,
    startPresenceMonitor,
    type PresenceCapability,
    type PresenceSample,
} from './presence';

function freshStores() {
    return {
        presence: createPresenceStore({ isSettingsWindow: false }),
        pomodoro: createPomodoroStore({ isSettingsWindow: false }),
    };
}

function sample(
    observation: PresenceSample['observation'],
    availability: PresenceSample['availability'] = 'ready',
): PresenceSample {
    return { observation, availability, errorCode: null };
}

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => { resolve = done; });
    return { promise, resolve };
}

async function flushPromises() {
    await Promise.resolve();
    await Promise.resolve();
}

describe('presence settings updates', () => {
    it('restarts monitoring and clears the stale observation when the camera changes', async () => {
        const { presence } = freshStores();
        presence.setState({
            enabled: true,
            inputActivityEnabled: false,
            cameraDeviceId: null,
            availability: 'ready',
            confirmedPresence: 'present',
            lastSuccessfulAt: 1_000,
            generation: 4,
        });

        await presence.getState().applySettings({
            ...DEFAULT_PRESENCE_PREFERENCES,
            enabled: true,
            inputActivityEnabled: false,
            cameraDeviceId: 'camera-usb',
            intervalSeconds: 10,
            absenceSensitivity: 'strict',
            restDeskReminderEnabled: false,
            restDeskReminderMode: 'cockroachInvasion',
        });

        expect(presence.getState()).toMatchObject({
            inputActivityEnabled: false,
            cameraDeviceId: 'camera-usb',
            confirmedPresence: 'unknown',
            lastSuccessfulAt: null,
            generation: 5,
        });
    });

    it('applies a new interval without clearing the last visible observation', async () => {
        const { presence } = freshStores();
        presence.setState({
            enabled: true,
            intervalSeconds: 60,
            availability: 'ready',
            confirmedPresence: 'present',
            lastSuccessfulAt: 1_000,
            generation: 4,
        });

        await presence.getState().applySettings({
            ...DEFAULT_PRESENCE_PREFERENCES,
            enabled: true,
            inputActivityEnabled: false,
            cameraDeviceId: null,
            intervalSeconds: 5,
            absenceSensitivity: 'strict',
            restDeskReminderEnabled: false,
            restDeskReminderMode: 'cockroachInvasion',
        });

        expect(presence.getState()).toMatchObject({
            enabled: true,
            intervalSeconds: 5,
            absenceSensitivity: 'strict',
            availability: 'ready',
            confirmedPresence: 'present',
            lastSuccessfulAt: 1_000,
            generation: 5,
        });
    });

    it('clears pending absence evidence when the sensitivity level changes', async () => {
        const { presence, pomodoro } = freshStores();
        presence.setState({
            enabled: true,
            intervalSeconds: 10,
            absenceSensitivity: 'relaxed',
            generation: 4,
        });
        pomodoro.getState().start();
        applyPresenceSample(presence, pomodoro, sample('present'), 0);
        for (let index = 1; index <= 5; index += 1) {
            applyPresenceSample(presence, pomodoro, sample('absent'), index * 10_000);
        }

        await presence.getState().applySettings({
            ...DEFAULT_PRESENCE_PREFERENCES,
            enabled: true,
            inputActivityEnabled: false,
            cameraDeviceId: null,
            intervalSeconds: 10,
            absenceSensitivity: 'balanced',
            restDeskReminderEnabled: false,
            restDeskReminderMode: 'cockroachInvasion',
        });

        expect(presence.getState()).toMatchObject({
            generation: 4,
            confirmedPresence: 'present',
        });
        applyPresenceSample(presence, pomodoro, sample('absent'), 60_000);
        applyPresenceSample(presence, pomodoro, sample('absent'), 70_000);
        expect(pomodoro.getState().isRunning).toBe(true);

        applyPresenceSample(presence, pomodoro, sample('absent'), 80_000);
        expect(pomodoro.getState()).toMatchObject({
            isRunning: false,
            presenceAutomationState: 'focusPaused',
        });
    });

});

describe('presence and pomodoro integration', () => {
    it('starts the initial waiting focus when the camera confirms presence', () => {
        const { presence, pomodoro } = freshStores();
        presence.setState({ enabled: true });

        applyPresenceSample(presence, pomodoro, sample('unknown'), 0);
        applyPresenceSample(presence, pomodoro, sample('absent'), 10_000);
        expect(pomodoro.getState().isRunning).toBe(false);

        applyPresenceSample(presence, pomodoro, sample('present'), 20_000);
        expect(pomodoro.getState()).toMatchObject({
            currentPhase: 'focus',
            currentRound: 1,
            remainingSeconds: 1500,
            isRunning: true,
            lastEndEvent: null,
            consecutiveCompletedFocus: 0,
        });
        expect(presence.getState().notice?.message).toBe('检测到在场，已开始专注');

        const noticeId = presence.getState().notice?.id;
        pomodoro.getState().tick(1);
        applyPresenceSample(presence, pomodoro, sample('present'), 30_000);
        expect(pomodoro.getState().remainingSeconds).toBe(1499);
        expect(presence.getState().notice?.id).toBe(noticeId);
    });

    it('waits for confirmed workstation presence before starting the initial focus', () => {
        const { presence, pomodoro } = freshStores();
        presence.setState({
            enabled: true,
            workstationRegion: { x: 0.1, y: 0.1, width: 0.6, height: 0.8 },
        });

        applyPresenceSample(presence, pomodoro, sample('present'), 0);
        expect(pomodoro.getState().isRunning).toBe(false);
        applyPresenceSample(presence, pomodoro, sample('present'), 10_000);
        expect(pomodoro.getState().isRunning).toBe(true);
    });

    it('starts a waiting focus after reset, settings reset, or skipping break', () => {
        const { presence, pomodoro } = freshStores();
        presence.setState({ enabled: true });

        pomodoro.getState().start();
        pomodoro.getState().pause();
        pomodoro.getState().reset();
        applyPresenceSample(presence, pomodoro, sample('present'), 0);
        expect(pomodoro.getState().isRunning).toBe(true);

        pomodoro.getState().applySettings(60, 30, 2, true, false);
        applyPresenceSample(presence, pomodoro, sample('present'), 10_000);
        expect(pomodoro.getState()).toMatchObject({ isRunning: true, remainingSeconds: 60 });

        pomodoro.setState({ currentPhase: 'break', isRunning: true });
        pomodoro.getState().skip();
        applyPresenceSample(presence, pomodoro, sample('present'), 20_000);
        expect(pomodoro.getState()).toMatchObject({ currentPhase: 'focus', currentRound: 2, isRunning: true });
    });

    it('uses the active preset count and ignores a single passerby after an absence', () => {
        const { presence, pomodoro } = freshStores();
        presence.setState({
            enabled: true,
            absenceSensitivity: 'balanced',
            absenceThresholds: { strict: 2, balanced: 4, relaxed: 6 },
            workstationRegion: { x: 0.1, y: 0.1, width: 0.6, height: 0.8 },
        });
        pomodoro.getState().start();
        for (let index = 0; index < 3; index += 1) {
            applyPresenceSample(presence, pomodoro, sample('absent'), index * 10_000);
        }
        expect(pomodoro.getState().isRunning).toBe(true);
        applyPresenceSample(presence, pomodoro, sample('absent'), 30_000);
        expect(pomodoro.getState().presenceAutomationState).toBe('focusPaused');
        applyPresenceSample(presence, pomodoro, sample('present'), 40_000);
        expect(pomodoro.getState().isRunning).toBe(false);
        applyPresenceSample(presence, pomodoro, sample('absent'), 50_000);
        applyPresenceSample(presence, pomodoro, sample('present'), 60_000);
        expect(pomodoro.getState().isRunning).toBe(false);
        applyPresenceSample(presence, pomodoro, sample('present'), 70_000);
        expect(pomodoro.getState().isRunning).toBe(true);
    });
    it.each([
        ['off', 1],
        ['strict', 2],
        ['balanced', 3],
        ['relaxed', 6],
    ] as const)('uses the %s absence-sensitivity threshold', (absenceSensitivity, requiredSamples) => {
        const { presence, pomodoro } = freshStores();
        presence.setState({ enabled: true, intervalSeconds: 10, absenceSensitivity });
        pomodoro.getState().applySettings(120, 30, 4, true, false);
        pomodoro.getState().start();

        applyPresenceSample(presence, pomodoro, sample('present'), 0);
        for (let index = 1; index < requiredSamples; index += 1) {
            applyPresenceSample(presence, pomodoro, sample('absent'), index * 10_000);
            expect(presence.getState().confirmedPresence).toBe('present');
            expect(pomodoro.getState()).toMatchObject({
                currentPhase: 'focus',
                isRunning: true,
                presenceAutomationState: 'none',
            });
        }

        applyPresenceSample(
            presence,
            pomodoro,
            sample('absent'),
            requiredSamples * 10_000,
        );

        expect(presence.getState().confirmedPresence).toBe('absent');
        expect(pomodoro.getState()).toMatchObject({
            currentPhase: 'focus',
            isRunning: false,
            presenceAutomationState: 'focusPaused',
        });
    });

    it.each(['strict', 'balanced', 'relaxed'] as const)('rest recovery resumes on the next empty observation with %s focus debounce', (absenceSensitivity) => {
        const { presence, pomodoro } = freshStores();
        presence.setState({ enabled: true, intervalSeconds: 10, absenceSensitivity,
            absenceThresholds: { strict: 30, balanced: 30, relaxed: 30 } });
        pomodoro.setState({ currentPhase: 'break', isRunning: true, remainingSeconds: 300 });
        applyPresenceSample(presence, pomodoro, sample('present'), 0);
        expect(pomodoro.getState().presenceAutomationState).toBe('breakPaused');
        applyPresenceSample(presence, pomodoro, sample('absent'), 10_000);
        expect(pomodoro.getState()).toMatchObject({ isRunning: true, remainingSeconds: 300, presenceAutomationState: 'none' });
        expect(presence.getState().confirmedPresence).toBe('absent');
    });

    it('waits for a valid empty camera result instead of resuming rest on a detection error', () => {
        const { presence, pomodoro } = freshStores();
        presence.setState({ enabled: true });
        pomodoro.setState({ currentPhase: 'break', isRunning: true, remainingSeconds: 300 });
        applyPresenceSample(presence, pomodoro, sample('present'), 0);
        applyPresenceSample(presence, pomodoro, sample('unknown', 'error'), 10_000);
        expect(pomodoro.getState().presenceAutomationState).toBe('breakPaused');
        applyPresenceSample(presence, pomodoro, sample('absent'), 20_000);
        expect(pomodoro.getState().isRunning).toBe(true);
    });

    it('pauses a running break while present and resumes after confirmed absence', () => {
        const { presence, pomodoro } = freshStores();
        presence.setState({ enabled: true, intervalSeconds: 30 });
        pomodoro.getState().applySettings(60, 30, 2, true, false);
        pomodoro.setState({ currentPhase: 'break', isRunning: true, remainingSeconds: 20 });

        applyPresenceSample(presence, pomodoro, sample('present'), 0);

        expect(pomodoro.getState()).toMatchObject({
            currentPhase: 'break',
            currentRound: 1,
            remainingSeconds: 20,
            isRunning: false,
            presenceAutomationState: 'breakPaused',
        });

        applyPresenceSample(presence, pomodoro, sample('absent'), 30_000);

        expect(pomodoro.getState()).toMatchObject({
            currentPhase: 'break',
            remainingSeconds: 20,
            isRunning: true,
            presenceAutomationState: 'none',
        });
        pomodoro.getState().tick(1);
        expect(pomodoro.getState().remainingSeconds).toBe(19);
    });

    it('starts focus on the first present observation after break finishes naturally', () => {
        const { presence, pomodoro } = freshStores();
        presence.setState({ enabled: true, intervalSeconds: 30 });
        pomodoro.getState().applySettings(60, 1, 2, true, false);
        pomodoro.setState({ currentPhase: 'break', isRunning: true, remainingSeconds: 1 });

        pomodoro.getState().tick(1);
        expect(pomodoro.getState()).toMatchObject({
            currentPhase: 'focus',
            isRunning: false,
            presenceAutomationState: 'focusAutoStartEligible',
        });

        applyPresenceSample(presence, pomodoro, sample('absent'), 30_000);
        expect(pomodoro.getState().isRunning).toBe(false);

        applyPresenceSample(presence, pomodoro, sample('present'), 60_000);

        expect(pomodoro.getState()).toMatchObject({
            currentPhase: 'focus',
            currentRound: 2,
            isRunning: true,
            presenceAutomationState: 'none',
        });
        expect(presence.getState().notice?.message).toBe('检测到在场，已开始专注');
    });

    it('starts a naturally reached paused break only after confirmed absence', () => {
        const { presence, pomodoro } = freshStores();
        presence.setState({ enabled: true, intervalSeconds: 30 });
        pomodoro.getState().applySettings(1, 30, 2, true, false);
        pomodoro.getState().start();
        pomodoro.getState().tick(1);

        expect(pomodoro.getState()).toMatchObject({
            currentPhase: 'break',
            isRunning: false,
            remainingSeconds: 30,
            presenceAutomationState: 'breakResumeEligible',
        });

        applyPresenceSample(presence, pomodoro, sample('present'), 0);
        applyPresenceSample(presence, pomodoro, sample('absent'), 30_000);
        expect(pomodoro.getState()).toMatchObject({
            currentPhase: 'break',
            isRunning: true,
            remainingSeconds: 30,
        });
    });

    it('never resumes a manually paused break after absence', () => {
        const { presence, pomodoro } = freshStores();
        presence.setState({ enabled: true, intervalSeconds: 30 });
        pomodoro.setState({ currentPhase: 'break', isRunning: true, remainingSeconds: 20 });

        applyPresenceSample(presence, pomodoro, sample('present'), 0);
        expect(pomodoro.getState().presenceAutomationState).toBe('breakPaused');

        pomodoro.getState().pause();
        applyPresenceSample(presence, pomodoro, sample('absent'), 30_000);
        applyPresenceSample(presence, pomodoro, sample('absent'), 60_000);

        expect(pomodoro.getState()).toMatchObject({
            currentPhase: 'break',
            isRunning: false,
            remainingSeconds: 20,
            presenceAutomationState: 'manualPaused',
        });
    });

    it('honors a manual break resume until presence changes away and back', () => {
        const { presence, pomodoro } = freshStores();
        presence.setState({ enabled: true, intervalSeconds: 30 });
        pomodoro.setState({ currentPhase: 'break', isRunning: true, remainingSeconds: 20 });

        applyPresenceSample(presence, pomodoro, sample('present'), 0);
        expect(pomodoro.getState().isRunning).toBe(false);

        pomodoro.getState().start();
        expect(pomodoro.getState().presenceAutomationState).toBe('breakPresentOverride');
        applyPresenceSample(presence, pomodoro, sample('present'), 30_000);
        expect(pomodoro.getState().isRunning).toBe(true);
        expect(pomodoro.getState().presenceAutomationState).toBe('breakPresentOverride');

        applyPresenceSample(presence, pomodoro, sample('absent'), 60_000);
        applyPresenceSample(presence, pomodoro, sample('absent'), 90_000);
        expect(pomodoro.getState().isRunning).toBe(true);
        expect(pomodoro.getState().presenceAutomationState).toBe('none');

        applyPresenceSample(presence, pomodoro, sample('present'), 120_000);
        expect(pomodoro.getState()).toMatchObject({
            currentPhase: 'break',
            isRunning: false,
            presenceAutomationState: 'breakPaused',
        });
    });

    it('pauses focus after the default two absent cycles and resumes on the first present', () => {
        const { presence, pomodoro } = freshStores();
        presence.setState({ enabled: true, intervalSeconds: 30 });
        pomodoro.getState().applySettings(120, 30, 4, true, false);
        pomodoro.getState().start();
        pomodoro.getState().tick(10);
        const remaining = pomodoro.getState().remainingSeconds;

        applyPresenceSample(presence, pomodoro, sample('absent'), 0);
        expect(pomodoro.getState().isRunning).toBe(true);
        applyPresenceSample(presence, pomodoro, sample('absent'), 30_000);
        expect(pomodoro.getState()).toMatchObject({
            currentPhase: 'focus',
            remainingSeconds: remaining,
            isRunning: false,
            presenceAutomationState: 'focusPaused',
            lastEndEvent: null,
        });

        applyPresenceSample(presence, pomodoro, sample('present'), 60_000);
        expect(pomodoro.getState()).toMatchObject({
            remainingSeconds: remaining,
            isRunning: true,
            presenceAutomationState: 'none',
        });

        pomodoro.getState().pause();
        applyPresenceSample(presence, pomodoro, sample('present'), 120_000);
        expect(pomodoro.getState().isRunning).toBe(false);
    });

    it('never starts focus while camera automation is disabled or the timer is completed', () => {
        const { presence, pomodoro } = freshStores();

        applyPresenceSample(presence, pomodoro, sample('present'), 0);
        expect(pomodoro.getState()).toMatchObject({ currentPhase: 'focus', isRunning: false });

        presence.setState({ enabled: true, intervalSeconds: 30 });
        pomodoro.setState({ currentPhase: 'completed', remainingSeconds: 0 });
        applyPresenceSample(presence, pomodoro, sample('present'), 60_000);
        expect(pomodoro.getState()).toMatchObject({ currentPhase: 'completed', isRunning: false });
    });
});

describe('presence monitor scheduling', () => {
    it('keeps polling an automatically paused break and resumes on the next empty result', async () => {
        const { presence, pomodoro } = freshStores();
        presence.setState({ enabled: true, intervalSeconds: 10, absenceSensitivity: 'relaxed' });
        pomodoro.setState({ currentPhase: 'break', isRunning: true, remainingSeconds: 300 });
        const invokeSample = vi.fn(async () => sample('present'));
        let nowMs = 0;
        let intervalCallback = () => {};
        const clearInterval = vi.fn();
        const cleanup = startPresenceMonitor({
            store: presence,
            pomodoro,
            runtime: {
                invokeCapability: vi.fn(async (): Promise<PresenceCapability> => ({ platform: 'macos', availability: 'ready' })),
                invokeSample,
                now: () => nowMs,
                setInterval: vi.fn((callback: () => void) => { intervalCallback = callback; return 1; }),
                clearInterval,
                setTimeout: vi.fn(() => 2),
                clearTimeout: vi.fn(),
            },
        });
        await flushPromises();
        expect(pomodoro.getState().presenceAutomationState).toBe('breakPaused');
        expect(clearInterval).not.toHaveBeenCalled();

        invokeSample.mockResolvedValue(sample('absent'));
        nowMs = 10_000;
        intervalCallback();
        await flushPromises();
        expect(invokeSample).toHaveBeenCalledTimes(2);
        expect(pomodoro.getState()).toMatchObject({ isRunning: true, remainingSeconds: 300, presenceAutomationState: 'none' });
        cleanup();
    });

    it('does nothing while the feature is disabled', async () => {
        const { presence, pomodoro } = freshStores();
        const invokeCapability = vi.fn<() => Promise<PresenceCapability>>();
        const cleanup = startPresenceMonitor({
            store: presence,
            pomodoro,
            runtime: {
                invokeCapability,
                invokeSample: vi.fn(),
                now: () => 0,
                setInterval: vi.fn(),
                clearInterval: vi.fn(),
                setTimeout: vi.fn(),
                clearTimeout: vi.fn(),
            },
        });
        await flushPromises();
        expect(invokeCapability).not.toHaveBeenCalled();
        cleanup();
    });

    it('samples immediately when ready and skips interval ticks while in flight', async () => {
        const { presence, pomodoro } = freshStores();
        presence.setState({ enabled: true, generation: 1, intervalSeconds: 30 });
        const pending = deferred<PresenceSample>();
        const invokeSample = vi.fn(() => pending.promise);
        let intervalCallback = () => {};
        const cleanup = startPresenceMonitor({
            store: presence,
            pomodoro,
            runtime: {
                invokeCapability: vi.fn(async (): Promise<PresenceCapability> => ({
                    platform: 'macos',
                    availability: 'ready',
                })),
                invokeSample,
                now: () => 0,
                setInterval: vi.fn((callback: () => void) => {
                    intervalCallback = callback;
                    return 1;
                }),
                clearInterval: vi.fn(),
                setTimeout: vi.fn(() => 2),
                clearTimeout: vi.fn(),
            },
        });
        await flushPromises();
        expect(invokeSample).toHaveBeenCalledTimes(1);
        expect(invokeSample).toHaveBeenCalledWith(30, null, null);
        expect(presence.getState().availability).toBe('ready');

        intervalCallback();
        expect(invokeSample).toHaveBeenCalledTimes(1);

        pending.resolve(sample('present'));
        await flushPromises();
        cleanup();
    });

    it('passes the selected camera to capability checks and samples', async () => {
        const { presence, pomodoro } = freshStores();
        presence.setState({
            enabled: true,
            inputActivityEnabled: false,
            cameraDeviceId: 'camera-usb',
            workstationRegion: { x: 0.2, y: 0.1, width: 0.5, height: 0.8 },
            generation: 1,
            intervalSeconds: 30,
        });
        const invokeCapability = vi.fn(async (): Promise<PresenceCapability> => ({
            platform: 'macos',
            availability: 'ready',
        }));
        const invokeSample = vi.fn(async () => sample('present'));

        const cleanup = startPresenceMonitor({
            store: presence,
            pomodoro,
            runtime: {
                invokeCapability,
                invokeSample,
                now: () => 0,
                setInterval: vi.fn(() => 1),
                clearInterval: vi.fn(),
                setTimeout: vi.fn(() => 2),
                clearTimeout: vi.fn(),
            },
        });
        await flushPromises();

        expect(invokeCapability).toHaveBeenCalledWith('camera-usb');
        expect(invokeSample).toHaveBeenCalledWith(30, 'camera-usb', {
            x: 0.2, y: 0.1, width: 0.5, height: 0.8,
        });
        cleanup();
    });

    it('uses the configured detection interval for sampling and automation', async () => {
        const { presence, pomodoro } = freshStores();
        presence.setState({
            enabled: true,
            generation: 1,
            intervalSeconds: 30,
        });
        pomodoro.setState({
            currentPhase: 'focus',
            isRunning: true,
            breakDurationSeconds: 5,
        });
        let now = 0;
        let sampleCount = 0;
        let intervalCallback = () => {};
        let intervalDelay = 0;
        const cleanup = startPresenceMonitor({
            store: presence,
            pomodoro,
            runtime: {
                invokeCapability: vi.fn(async (): Promise<PresenceCapability> => ({
                    platform: 'macos',
                    availability: 'ready',
                })),
                invokeSample: vi.fn(async () => sample(sampleCount++ === 0 ? 'present' : 'absent')),
                now: () => now,
                setInterval: vi.fn((callback: () => void, delayMs: number) => {
                    intervalCallback = callback;
                    intervalDelay = delayMs;
                    return 1;
                }),
                clearInterval: vi.fn(),
                setTimeout: vi.fn(() => 2),
                clearTimeout: vi.fn(),
            },
        });
        await flushPromises();

        expect(intervalDelay).toBe(30_000);
        expect(presence.getState().confirmedPresence).toBe('present');

        now = 30_000;
        intervalCallback();
        await flushPromises();
        expect(presence.getState().confirmedPresence).toBe('present');
        expect(pomodoro.getState().isRunning).toBe(true);

        now = 60_000;
        intervalCallback();
        await flushPromises();
        expect(presence.getState().confirmedPresence).toBe('absent');
        expect(pomodoro.getState()).toMatchObject({
            isRunning: false,
            presenceAutomationState: 'focusPaused',
        });
        cleanup();
    });

    it('drops a sample that completes after generation changes', async () => {
        const { presence, pomodoro } = freshStores();
        presence.setState({ enabled: true, generation: 4 });
        const pending = deferred<PresenceSample>();
        const cleanup = startPresenceMonitor({
            store: presence,
            pomodoro,
            runtime: {
                invokeCapability: vi.fn(async (): Promise<PresenceCapability> => ({
                    platform: 'windows',
                    availability: 'ready',
                })),
                invokeSample: vi.fn(() => pending.promise),
                now: () => 30_000,
                setInterval: vi.fn(() => 1),
                clearInterval: vi.fn(),
                setTimeout: vi.fn(() => 2),
                clearTimeout: vi.fn(),
            },
        });
        await flushPromises();
        presence.setState({ generation: 5, confirmedPresence: 'unknown' });
        pending.resolve(sample('present'));
        await flushPromises();

        expect(presence.getState().confirmedPresence).toBe('unknown');
        cleanup();
    });

    it('uses a fallback timeout after the native helper termination deadline', async () => {
        const { presence, pomodoro } = freshStores();
        presence.setState({ enabled: true, generation: 1 });
        let timeoutCallback = () => {};
        const setTimeout = vi.fn((callback: () => void, delayMs: number) => {
            timeoutCallback = callback;
            expect(delayMs).toBe(12_000);
            return 2;
        });
        const cleanup = startPresenceMonitor({
            store: presence,
            pomodoro,
            runtime: {
                invokeCapability: vi.fn(async (): Promise<PresenceCapability> => ({
                    platform: 'macos',
                    availability: 'ready',
                })),
                invokeSample: vi.fn(() => new Promise<PresenceSample>(() => {})),
                now: () => 12_000,
                setInterval: vi.fn(() => 1),
                clearInterval: vi.fn(),
                setTimeout,
                clearTimeout: vi.fn(),
            },
        });
        await flushPromises();

        timeoutCallback();
        await flushPromises();

        expect(setTimeout).toHaveBeenCalledTimes(1);
        expect(presence.getState()).toMatchObject({
            availability: 'error',
            confirmedPresence: 'unknown',
            lastError: 'sampleTimeout',
            inFlight: false,
        });
        cleanup();
    });
});
