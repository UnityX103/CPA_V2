import { describe, expect, it } from 'vitest';
import { createPomodoroStore } from './pomodoro';
import { createPomodoroBroadcast } from './pomodoroBroadcast';

describe('pomodoro broadcast', () => {
    it('publishes a versioned phase event for extension subscribers', () => {
        const pomodoro = createPomodoroStore({ isSettingsWindow: false });
        pomodoro.getState().applySettings(1, 5, 1, true, false);
        const broadcast = createPomodoroBroadcast(pomodoro, () => 1234);
        const events: ReturnType<typeof broadcast.current>[] = [];
        const unsubscribe = broadcast.subscribe((event) => events.push(event));
        const stop = broadcast.start();

        pomodoro.getState().start();
        pomodoro.getState().tick(1);

        expect(events[events.length - 1]).toEqual(expect.objectContaining({
            v: 1,
            type: 'phase.entered',
            emittedAt: 1234,
            previousPhase: 'focus',
            phase: 'break',
            reason: 'timer',
        }));
        stop();
        unsubscribe();
    });
});
