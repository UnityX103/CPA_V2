import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPomodoroStore } from './pomodoro';
import { applyCombinedPresence, applyInputActivitySample, createPresenceStore } from './presence';
import { createPomodoroBroadcast } from './pomodoroBroadcast';
import { startInputActivityMonitor } from './inputActivity';

vi.mock('./presencePersistence', async (original) => ({
    ...await original<typeof import('./presencePersistence')>(),
    savePresencePreferences: vi.fn(async () => {}),
}));

function fixture() {
    const store = createPresenceStore({ isSettingsWindow: false });
    const pomodoro = createPomodoroStore({ isSettingsWindow: false });
    store.setState({ inputActivityEnabled: true });
    pomodoro.setState({ currentPhase: 'break', isRunning: true, remainingSeconds: 300 });
    const input = (idleMs: number | null, time = 0) => applyInputActivitySample(store, pomodoro, idleMs, time);
    return { store, pomodoro, input };
}

describe('keyboard and mouse evidence', () => {

    it('rest recovery resumes input-only breaks on the first idle poll after five seconds', () => {
        const f = fixture();
        f.input(0, 0);
        expect(f.pomodoro.getState().presenceAutomationState).toBe('breakPaused');
        f.input(5000, 5000);
        expect(f.pomodoro.getState().isRunning).toBe(true);
    });

    it('emits one break.present signal per automatic pause', () => {
        const f = fixture();
        const events: string[] = [];
        const broadcast = createPomodoroBroadcast(f.pomodoro, () => 0, f.store);
        broadcast.subscribe((event) => events.push(...event.signals ?? []));
        const stop = broadcast.start();
        f.input(0);
        f.input(0, 5000);
        expect(f.pomodoro.getState().isRunning).toBe(false);
        f.input(30_000, 35_000);
        expect(f.pomodoro.getState().isRunning).toBe(true);
        f.input(0, 40_000);
        expect(events.filter((event) => event === 'break.present')).toHaveLength(2);
        stop();
    });


    it('keeps rest paused during continuous input, resuming after the first idle poll', () => {
        const f = fixture();
        f.input(0);
        for (let time = 5000; time <= 60_000; time += 5000) {
            f.input(100, time);
            expect(f.pomodoro.getState().presenceAutomationState).toBe('breakPaused');
        }
        f.input(5100, 65_000);
        expect(f.pomodoro.getState().isRunning).toBe(true);
    });



    it('preserves manual pause and manual continue overrides', () => {
        const f = fixture();
        f.input(0);
        f.pomodoro.getState().start();
        f.input(0, 5000);
        expect(f.pomodoro.getState().isRunning).toBe(true);
        f.input(30_000, 35_000);
        f.input(0, 40_000);
        expect(f.pomodoro.getState().isRunning).toBe(false);
        f.pomodoro.getState().pause();
        f.input(30_000, 75_000);
        expect(f.pomodoro.getState().isRunning).toBe(false);
    });

    it('input starts a waiting focus without camera access and does not pause it on inactivity', () => {
        const f = fixture();
        f.pomodoro.getState().reset();
        f.input(60_000);
        expect(f.pomodoro.getState().isRunning).toBe(false);
        f.input(0);
        expect(f.pomodoro.getState()).toMatchObject({
            currentPhase: 'focus', isRunning: true, remainingSeconds: 1500,
            lastEndEvent: null, consecutiveCompletedFocus: 0,
        });
        expect(f.store.getState().confirmedPresence).toBe('present');
        f.pomodoro.getState().tick(7);
        f.input(60_000, 60_000);
        expect(f.pomodoro.getState()).toMatchObject({ isRunning: true, remainingSeconds: 1493 });
        expect(f.store.getState().confirmedPresence).toBe('unknown');
    });

    it('resumes a previously automatically paused focus from input', () => {
        const f = fixture();
        f.pomodoro.getState().reset();
        f.pomodoro.getState().start();
        f.pomodoro.getState().tick(7);
        f.pomodoro.getState().pauseFocusFromPresence();

        f.input(0, 5000);
        expect(f.pomodoro.getState()).toMatchObject({
            isRunning: true, remainingSeconds: 1493, presenceAutomationState: 'none', lastEndEvent: null,
        });
        expect(f.store.getState().notice?.message).toBe('检测到键鼠活动，已继续专注');
    });


    it('never resumes a manual focus pause or restarts a completed timer from input', () => {
        const f = fixture();
        f.pomodoro.getState().reset();
        f.pomodoro.getState().pause();
        f.input(0);
        expect(f.pomodoro.getState().isRunning).toBe(false);
        f.pomodoro.setState({ currentPhase: 'completed', remainingSeconds: 0 });
        f.input(0, 5000);
        expect(f.pomodoro.getState()).toMatchObject({ currentPhase: 'completed', isRunning: false });
    });

    it('requires enabled, valid, fresh input evidence to start focus', () => {
        const f = fixture();
        f.pomodoro.getState().reset();
        f.input(null);
        f.input(Number.NaN);
        f.input(-1);
        f.input(5000);
        expect(f.pomodoro.getState().isRunning).toBe(false);
        f.store.setState({ inputActivityAvailability: 'ready', inputIdleMs: 0, inputSampleAt: 0 });
        applyCombinedPresence(f.store, f.pomodoro, 10_001);
        expect(f.pomodoro.getState().isRunning).toBe(false);
        f.store.setState({ inputActivityEnabled: false });
        f.input(0);
        expect(f.pomodoro.getState().isRunning).toBe(false);
    });
});

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function monitor() {
    const f = fixture();
    const sample = vi.fn(async () => 60_000);
    const stop = startInputActivityMonitor({ ...f, runtime: {
        sample, now: () => Date.now(),
        setInterval: (cb, ms) => window.setInterval(cb, ms),
        clearInterval: (id) => window.clearInterval(id),
    } });
    return { ...f, sample, stop };
}

describe('input sampling lifecycle', () => {
    it('automatically resumes a paused break at the next idle poll and keeps counting down', async () => {
        const f = monitor();
        f.sample.mockResolvedValue(0);
        await vi.advanceTimersByTimeAsync(5000);
        expect(f.pomodoro.getState().presenceAutomationState).toBe('breakPaused');
        f.sample.mockResolvedValue(5000);
        await vi.advanceTimersByTimeAsync(5000);
        expect(f.pomodoro.getState().isRunning).toBe(true);
        f.pomodoro.getState().tick(1);
        expect(f.pomodoro.getState().remainingSeconds).toBe(299);
        await vi.advanceTimersByTimeAsync(5000);
        expect(f.pomodoro.getState().isRunning).toBe(true);
        f.stop();
    });

    it('polls focus and eligible breaks every five seconds, stopping for manual pause or completion', async () => {
        const f = monitor();
        await vi.advanceTimersByTimeAsync(4999);
        expect(f.sample).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(1);
        expect(f.sample).toHaveBeenCalledTimes(2);
        f.sample.mockResolvedValue(0);
        await vi.advanceTimersByTimeAsync(5000);
        expect(f.pomodoro.getState().presenceAutomationState).toBe('breakPaused');
        await vi.advanceTimersByTimeAsync(5000);
        expect(f.sample).toHaveBeenCalledTimes(4);
        f.pomodoro.getState().pause();
        await vi.advanceTimersByTimeAsync(60_000);
        expect(f.sample).toHaveBeenCalledTimes(4);
        f.pomodoro.getState().reset();
        await vi.advanceTimersByTimeAsync(0);
        expect(f.sample).toHaveBeenCalledTimes(5);
        await vi.advanceTimersByTimeAsync(5000);
        expect(f.sample).toHaveBeenCalledTimes(6);
        expect(f.pomodoro.getState().isRunning).toBe(true);
        f.pomodoro.setState({ currentPhase: 'completed', isRunning: false });
        await vi.advanceTimersByTimeAsync(60_000);
        expect(f.sample).toHaveBeenCalledTimes(6);
        f.pomodoro.setState({ currentPhase: 'break', isRunning: true });
        await vi.advanceTimersByTimeAsync(0);
        expect(f.sample).toHaveBeenCalledTimes(7);
        f.store.setState({ inputActivityEnabled: false });
        await vi.advanceTimersByTimeAsync(60_000);
        expect(f.sample).toHaveBeenCalledTimes(7);
        expect(vi.getTimerCount()).toBe(0);
        f.stop();
    });

    it('does not overlap requests or accept results after revocation, stop, or another break', async () => {
        const f = fixture();
        let resolve!: (value: number) => void;
        const sample = vi.fn(() => new Promise<number>((done) => { resolve = done; }));
        const stop = startInputActivityMonitor({ ...f, runtime: {
            sample, now: () => Date.now(),
            setInterval: (cb, ms) => window.setInterval(cb, ms), clearInterval: (id) => window.clearInterval(id),
        } });
        await vi.advanceTimersByTimeAsync(60_000);
        expect(sample).toHaveBeenCalledTimes(1);
        f.store.setState({ inputActivityEnabled: false });
        resolve(0);
        await vi.advanceTimersByTimeAsync(0);
        expect(f.pomodoro.getState().isRunning).toBe(true);
        f.store.setState({ inputActivityEnabled: true });
        f.pomodoro.setState({ currentRound: 2 });
        resolve(0);
        await vi.advanceTimersByTimeAsync(0);
        expect(f.pomodoro.getState().isRunning).toBe(true);
        await vi.advanceTimersByTimeAsync(5000);
        stop();
        resolve(0);
        await vi.advanceTimersByTimeAsync(0);
        expect(f.pomodoro.getState().isRunning).toBe(true);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('never queries before opt-in and can run without camera access', async () => {
        const f = fixture();
        f.store.setState({ inputActivityEnabled: false });
        const sample = vi.fn(async () => 0);
        const stop = startInputActivityMonitor({ ...f, runtime: {
            sample, now: () => Date.now(),
            setInterval: (cb, ms) => window.setInterval(cb, ms), clearInterval: (id) => window.clearInterval(id),
        } });
        await vi.advanceTimersByTimeAsync(60_000);
        expect(sample).not.toHaveBeenCalled();
        f.store.setState({ inputActivityEnabled: true });
        await vi.advanceTimersByTimeAsync(0);
        expect(sample).toHaveBeenCalledTimes(1);
        expect(f.pomodoro.getState().isRunning).toBe(false);
        stop();
    });

    it('keeps polling a waiting focus and an automatic focus pause so input can start or resume it', async () => {
        const f = fixture();
        f.pomodoro.getState().reset();
        const sample = vi.fn(async () => 60_000);
        const stop = startInputActivityMonitor({ ...f, runtime: {
            sample, now: () => Date.now(),
            setInterval: (cb, ms) => window.setInterval(cb, ms), clearInterval: (id) => window.clearInterval(id),
        } });
        await vi.advanceTimersByTimeAsync(0);
        expect(f.pomodoro.getState().isRunning).toBe(false);
        sample.mockResolvedValue(0);
        await vi.advanceTimersByTimeAsync(5000);
        expect(f.pomodoro.getState().isRunning).toBe(true);
        f.pomodoro.getState().tick(7);
        f.pomodoro.getState().pauseFocusFromPresence();
        await vi.advanceTimersByTimeAsync(5000);
        expect(f.pomodoro.getState()).toMatchObject({ isRunning: true, remainingSeconds: 1493 });
        expect(sample).toHaveBeenCalledTimes(3);
        stop();
    });

    it('rejects an in-flight focus result after manual pause, even after input is re-enabled', async () => {
        const f = fixture();
        f.pomodoro.getState().reset();
        let resolve!: (value: number) => void;
        const sample = vi.fn(() => new Promise<number>((done) => { resolve = done; }));
        const stop = startInputActivityMonitor({ ...f, runtime: {
            sample, now: () => Date.now(),
            setInterval: (cb, ms) => window.setInterval(cb, ms), clearInterval: (id) => window.clearInterval(id),
        } });
        expect(sample).toHaveBeenCalledTimes(1);
        f.pomodoro.getState().pause();
        f.store.setState({ inputActivityEnabled: false });
        f.store.setState({ inputActivityEnabled: true });
        resolve(0);
        await vi.advanceTimersByTimeAsync(10_000);
        expect(f.pomodoro.getState().isRunning).toBe(false);
        expect(sample).toHaveBeenCalledTimes(1);
        expect(f.store.getState().inputIdleMs).toBeNull();
        stop();
    });

    it('drops a focus result that arrives after entering a break', async () => {
        const f = fixture();
        f.pomodoro.getState().reset();
        let resolve!: (value: number) => void;
        const sample = vi.fn(() => new Promise<number>((done) => { resolve = done; }));
        const stop = startInputActivityMonitor({ ...f, runtime: {
            sample, now: () => Date.now(),
            setInterval: (cb, ms) => window.setInterval(cb, ms), clearInterval: (id) => window.clearInterval(id),
        } });
        f.pomodoro.setState({ currentPhase: 'break', isRunning: true, remainingSeconds: 300 });
        resolve(0);
        await vi.advanceTimersByTimeAsync(0);
        expect(f.pomodoro.getState()).toMatchObject({ currentPhase: 'break', isRunning: true });
        expect(f.store.getState().inputIdleMs).toBeNull();
        await vi.advanceTimersByTimeAsync(5000);
        expect(sample).toHaveBeenCalledTimes(2);
        stop();
        resolve(0);
        await vi.advanceTimersByTimeAsync(0);
    });
});
