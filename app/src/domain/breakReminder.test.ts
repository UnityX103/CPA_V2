import { describe, expect, it } from 'vitest';
import { createPomodoroStore } from './pomodoro';
import { applyInputActivitySample, createPresenceStore } from './presence';
import { startBreakReminderMonitor } from './breakReminder';

function fixture() {
    const presence = createPresenceStore({ isSettingsWindow: false });
    const pomodoro = createPomodoroStore({ isSettingsWindow: false });
    presence.setState({ inputActivityEnabled: true });
    pomodoro.setState({ currentPhase: 'break', isRunning: true, remainingSeconds: 300 });
    let time = 0;
    const levels: number[] = [];
    const stop = startBreakReminderMonitor({ presence, pomodoro, now: () => time, onLevelChange: level => levels.push(level) });
    const sample = (at: number, idle = 0) => {
        time = at;
        applyInputActivitySample(presence, pomodoro, idle, time);
    };
    return { presence, pomodoro, levels, sample, stop };
}

describe('rest reminder escalation', () => {
    it('freezes the full five-minute break and escalates at 30, 60, and 90 seconds of continued activity', () => {
        const f = fixture();
        for (let time = 0; time <= 300_000; time += 5000) {
            f.sample(time);
            f.pomodoro.getState().tick(5);
            if (time === 25_000) expect(f.levels).toEqual([0]);
            if (time === 30_000) expect(f.levels).toEqual([0, 1]);
            if (time === 60_000) expect(f.levels).toEqual([0, 1, 2]);
        }
        expect(f.levels).toEqual([0, 1, 2, 3]);
        expect(f.pomodoro.getState()).toMatchObject({ currentPhase: 'break', remainingSeconds: 300, isRunning: false });
        f.stop();
    });

    it('continues the remaining break after departure while keeping the reminder visible until completion', () => {
        const f = fixture();
        for (let time = 0; time <= 60_000; time += 5000) f.sample(time);
        f.sample(65_000, 30_000);
        expect(f.pomodoro.getState().isRunning).toBe(true);
        expect(f.levels).toEqual([0, 1, 2]);
        f.pomodoro.getState().tick(299);
        expect(f.pomodoro.getState().remainingSeconds).toBe(1);
        f.pomodoro.getState().tick(1);
        expect(f.levels).toEqual([0, 1, 2, 0]);
        f.stop();
    });

    it('lets an explicitly skipped, automatically paused break finish and resets escalation for the next break', () => {
        const f = fixture();
        for (let time = 0; time <= 90_000; time += 5000) f.sample(time);
        f.pomodoro.getState().skip();
        expect(f.pomodoro.getState()).toMatchObject({ currentPhase: 'focus', currentRound: 2, lastEndEvent: { triggeredBy: 'skip' } });
        expect(f.levels[f.levels.length - 1]).toBe(0);
        f.pomodoro.setState({ currentPhase: 'break', isRunning: true });
        f.sample(100_000);
        expect(f.levels[f.levels.length - 1]).toBe(0);
        f.stop();
    });

    it('does not escalate from errors, stale evidence, or non-continuous activity', () => {
        const f = fixture();
        f.sample(0);
        f.sample(5000);
        f.sample(60_000); // A suspended sampler cannot count the intervening minute.
        expect(f.levels).toEqual([0]);
        f.presence.setState({ inputActivityAvailability: 'error', confirmedPresence: 'unknown' });
        f.sample(120_000);
        f.sample(125_000, 30_000);
        f.sample(150_000);
        expect(f.levels).toEqual([0]);
        f.stop();
    });

    it('stops reacting after cleanup', () => {
        const f = fixture();
        for (let time = 0; time <= 30_000; time += 5000) f.sample(time);
        expect(f.levels).toEqual([0, 1]);
        f.stop(); f.pomodoro.getState().skip();
        expect(f.levels).toEqual([0, 1]);
    });

});
