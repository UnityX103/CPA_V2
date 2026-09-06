import { describe, expect, it, vi } from 'vitest';
import { startCockroachModuleController, type CockroachRuleAdapter } from './controller';
import type { CockroachRule } from '../../domain/cockroachAutomation';
import type { PomodoroBroadcastEvent } from '../../domain/pomodoroBroadcast';
import { createPomodoroBroadcast } from '../../domain/pomodoroBroadcast';
import { createPomodoroStore } from '../../domain/pomodoro';
import { applyPresenceSample, createPresenceStore } from '../../domain/presence';

async function fixture(initial: CockroachRule[]) {
    let listener!: (event: PomodoroBroadcastEvent) => void;
    let changed!: (rules: CockroachRule[]) => void;
    const adapter: CockroachRuleAdapter = {
        read: async () => initial,
        listen: async (callback) => { changed = callback; return vi.fn(() => {}); },
        execute: vi.fn(async () => {}), stop: vi.fn(async () => {}), report: vi.fn(),
    };
    const event: PomodoroBroadcastEvent = { v: 1, sequence: 1, emittedAt: 0, type: 'presence.changed',
        phase: 'break', previousPhase: null, isRunning: true, round: 1, totalRounds: 2,
        remainingSeconds: 30, reason: 'presence', signals: ['break.present'] };
    const stop = startCockroachModuleController(null, adapter, {
        current: () => event, start: () => () => {}, subscribe: (callback) => { listener = callback; return vi.fn(() => {}); },
    });
    await Promise.resolve(); await Promise.resolve();
    return { adapter, event, emit: (patch: Partial<PomodoroBroadcastEvent> = {}) => listener({ ...event, ...patch }), changed: (rules: CockroachRule[]) => changed(rules), stop };
}

describe('Cockroach event/action rules', () => {
    it('spawns immediately on every presence-owned break pause, including leaving and returning', async () => {
        const pomodoro = createPomodoroStore({ isSettingsWindow: false });
        const presence = createPresenceStore({ isSettingsWindow: false });
        presence.setState({ enabled: true, confirmedPresence: 'present', absenceSensitivity: 'off' });
        pomodoro.setState({ currentPhase: 'break', remainingSeconds: 30, isRunning: true });
        const broadcast = createPomodoroBroadcast(pomodoro, () => 1234, presence);
        const observed: PomodoroBroadcastEvent[] = [];
        broadcast.subscribe((event) => observed.push(event));
        const stopBroadcast = broadcast.start();
        const control: CockroachRuleAdapter = {
            read: vi.fn(async () => [{ event: 'break.present', action: 'spawn-one' }] as CockroachRule[]),
            listen: async () => () => {},
            execute: vi.fn(async () => {}), stop: vi.fn(async () => {}), report: vi.fn(),
        };
        const stopController = startCockroachModuleController(null, control, broadcast);
        await Promise.resolve(); await Promise.resolve();
        const sample = (observation: 'present' | 'absent') => applyPresenceSample(
            presence, pomodoro, { observation, availability: 'ready', errorCode: null }, 1234,
        );
        try {
            expect(control.execute).not.toHaveBeenCalled();
            sample('present');
            expect(pomodoro.getState().isRunning).toBe(false);
            await vi.waitFor(() => expect(control.execute).toHaveBeenCalledTimes(1));
            sample('present');
            sample('absent');
            expect(pomodoro.getState().isRunning).toBe(true);
            await Promise.resolve();
            expect(control.execute).toHaveBeenCalledTimes(1);
            sample('present');
            expect(pomodoro.getState().isRunning).toBe(false);
            await vi.waitFor(() => expect(control.execute).toHaveBeenCalledTimes(2));
            expect(vi.mocked(control.execute).mock.calls).toEqual([['spawn-one'], ['spawn-one']]);
            expect(observed.filter((event) => event.signals?.includes('break.present')))
                .toEqual([
                    expect.objectContaining({ type: 'timer.paused', reason: 'presence', isRunning: false }),
                    expect.objectContaining({ type: 'timer.paused', reason: 'presence', isRunning: false }),
                ]);
        } finally {
            stopController(); stopBroadcast();
        }
    });

    it('executes matching rows in order and ignores duplicate event deliveries', async () => {
        const f = await fixture([
            { event: 'break.present', action: 'spawn-one' },
            { event: 'focus.started', action: 'kill-all' },
            { event: 'break.present', action: 'stop-simulation' },
        ]);
        f.emit(); f.emit();
        await vi.waitFor(() => expect(f.adapter.execute).toHaveBeenCalledTimes(2));
        expect(vi.mocked(f.adapter.execute).mock.calls).toEqual([['spawn-one'], ['stop-simulation']]);
        f.stop();
    });
    it('updates rules without replaying the current phase, and empty rules disable automatic actions', async () => {
        const f = await fixture([{ event: 'break.present', action: 'spawn-one' }]);
        f.changed([]); f.emit();
        await Promise.resolve();
        expect(f.adapter.execute).not.toHaveBeenCalled();
        f.changed([{ event: 'break.present', action: 'kill-all' }]);
        f.emit({ sequence: 2, type: 'snapshot' });
        expect(f.adapter.execute).not.toHaveBeenCalled();
        f.emit({ sequence: 3 });
        await vi.waitFor(() => expect(f.adapter.execute).toHaveBeenCalledWith('kill-all'));
        f.stop();
    });
    it('cancels queued starts on disable and stops after an in-flight action finishes', async () => {
        const f = await fixture([{ event: 'break.present', action: 'start-simulation' }, { event: 'break.present', action: 'spawn-one' }]);
        let finish!: () => void;
        vi.mocked(f.adapter.execute).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
        f.emit(); await Promise.resolve();
        f.stop();
        expect(f.adapter.stop).not.toHaveBeenCalled();
        finish();
        await vi.waitFor(() => expect(f.adapter.stop).toHaveBeenCalledOnce());
        expect(f.adapter.execute).toHaveBeenCalledTimes(1);
    });
    it('surfaces action errors instead of silently losing a rule', async () => {
        const f = await fixture([{ event: 'break.present', action: 'spawn-one' }]);
        vi.mocked(f.adapter.execute).mockRejectedValueOnce(new Error('请升级扩展包'));
        f.emit();
        await vi.waitFor(() => expect(f.adapter.report).toHaveBeenCalledWith('请升级扩展包'));
        f.stop();
    });
});
