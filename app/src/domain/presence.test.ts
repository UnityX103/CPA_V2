import { describe, expect, it, vi } from 'vitest';

vi.mock('./presencePersistence', async (importOriginal) => {
    const actual = await importOriginal<typeof import('./presencePersistence')>();
    return {
        ...actual,
        savePresencePreferences: vi.fn(async () => {}),
    };
});

import { createPomodoroStore } from './pomodoro';
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
    it('applies a new interval without clearing the last visible observation', async () => {
        const { presence } = freshStores();
        presence.setState({
            enabled: true,
            intervalSeconds: 60,
            availability: 'ready',
            latestObservation: 'present',
            lastSuccessfulAt: 1_000,
            generation: 4,
        });

        await presence.getState().applySettings({
            enabled: true,
            intervalSeconds: 5,
        });

        expect(presence.getState()).toMatchObject({
            enabled: true,
            intervalSeconds: 5,
            availability: 'ready',
            latestObservation: 'present',
            lastSuccessfulAt: 1_000,
            generation: 5,
        });
    });

});

describe('presence and pomodoro integration', () => {
    it('ends break early on the first present observation', () => {
        const { presence, pomodoro } = freshStores();
        presence.setState({ enabled: true, intervalSeconds: 30 });
        pomodoro.getState().applySettings(60, 30, 2, true, false);
        pomodoro.setState({ currentPhase: 'break', isRunning: true, remainingSeconds: 20 });

        applyPresenceSample(presence, pomodoro, sample('absent'), 0);
        expect(pomodoro.getState().currentPhase).toBe('break');

        applyPresenceSample(presence, pomodoro, sample('present'), 30_000);

        expect(pomodoro.getState()).toMatchObject({
            currentPhase: 'focus',
            currentRound: 2,
            remainingSeconds: 60,
            isRunning: true,
        });
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
            presenceAutoStartEligible: true,
        });

        applyPresenceSample(presence, pomodoro, sample('absent'), 30_000);
        expect(pomodoro.getState().isRunning).toBe(false);

        applyPresenceSample(presence, pomodoro, sample('present'), 60_000);

        expect(pomodoro.getState()).toMatchObject({
            currentPhase: 'focus',
            currentRound: 2,
            isRunning: true,
            presenceAutoStartEligible: false,
        });
    });

    it('pauses and resumes focus on the first absent or present observation', () => {
        const { presence, pomodoro } = freshStores();
        presence.setState({ enabled: true, intervalSeconds: 30 });
        pomodoro.getState().applySettings(120, 30, 4, true, false);
        pomodoro.getState().start();
        pomodoro.getState().tick(10);
        const remaining = pomodoro.getState().remainingSeconds;

        applyPresenceSample(presence, pomodoro, sample('absent'), 0);
        expect(pomodoro.getState()).toMatchObject({
            currentPhase: 'focus',
            remainingSeconds: remaining,
            isRunning: false,
            presenceOwnedPause: true,
            lastEndEvent: null,
        });

        applyPresenceSample(presence, pomodoro, sample('present'), 30_000);
        expect(pomodoro.getState()).toMatchObject({
            remainingSeconds: remaining,
            isRunning: true,
            presenceOwnedPause: false,
        });

        pomodoro.getState().pause();
        applyPresenceSample(presence, pomodoro, sample('present'), 120_000);
        expect(pomodoro.getState().isRunning).toBe(false);
    });

    it('never changes completed or initial stopped focus states', () => {
        const { presence, pomodoro } = freshStores();
        presence.setState({ enabled: true, intervalSeconds: 30 });

        applyPresenceSample(presence, pomodoro, sample('present'), 0);
        expect(pomodoro.getState()).toMatchObject({ currentPhase: 'focus', isRunning: false });

        pomodoro.setState({ currentPhase: 'completed', remainingSeconds: 0 });
        applyPresenceSample(presence, pomodoro, sample('present'), 60_000);
        expect(pomodoro.getState()).toMatchObject({ currentPhase: 'completed', isRunning: false });
    });
});

describe('presence monitor scheduling', () => {
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
        expect(invokeSample).toHaveBeenCalledWith(30);
        expect(presence.getState().availability).toBe('ready');

        intervalCallback();
        expect(invokeSample).toHaveBeenCalledTimes(1);

        pending.resolve(sample('present'));
        await flushPromises();
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
        expect(presence.getState().latestObservation).toBe('present');

        now = 30_000;
        intervalCallback();
        await flushPromises();
        expect(presence.getState().latestObservation).toBe('absent');
        expect(pomodoro.getState()).toMatchObject({
            isRunning: false,
            presenceOwnedPause: true,
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
        presence.setState({ generation: 5, latestObservation: 'unknown' });
        pending.resolve(sample('present'));
        await flushPromises();

        expect(presence.getState().latestObservation).toBe('unknown');
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
            latestObservation: 'unknown',
            lastError: 'sampleTimeout',
            inFlight: false,
        });
        cleanup();
    });
});
