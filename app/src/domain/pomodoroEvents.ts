import type { PomodoroBroadcastEvent } from './pomodoroBroadcast';

export const POMODORO_RULE_EVENTS = [
    { id: 'focus.started', label: '专注开始' },
    { id: 'focus.ended', label: '专注结束' },
    { id: 'break.started', label: '休息开始' },
    { id: 'break.ended', label: '休息结束' },
    { id: 'break.present', label: '休息时在工位上' },
    { id: 'focus.present', label: '专注时在工位上' },
] as const;
export type PomodoroRuleEvent = typeof POMODORO_RULE_EVENTS[number]['id'];

/** Turns public timer/presence observations into one-shot events, never per-tick actions. */
export function createPomodoroEventDetector() {
    let session = '';
    let started = false;
    let present = false;
    return (event: PomodoroBroadcastEvent): PomodoroRuleEvent[] => {
        const nextSession = `${event.phase}:${event.round}`;
        const changed = nextSession !== session;
        if (changed || event.type === 'timer.reset') {
            session = nextSession;
            started = false;
            present = false;
        }
        if (event.type === 'snapshot') {
            started = event.isRunning;
            present = event.isRunning && event.workstationPresence === 'present';
            return [];
        }
        const events: PomodoroRuleEvent[] = [];
        if (event.type === 'phase.entered' && (event.reason === 'timer' || event.reason === 'skip')) {
            if (event.previousPhase === 'focus') events.push('focus.ended');
            if (event.previousPhase === 'break') events.push('break.ended');
        }
        if (event.phase === 'completed') return events;
        if (event.isRunning && !started) {
            started = true;
            events.push(`${event.phase}.started`);
        }
        if (event.phase === 'break') {
            // A successful automatic pause is the trigger, even when presence was already known.
            // Do not also emit on the preceding presence observation or on manual pauses/resumes.
            if (event.type === 'timer.paused' && event.reason === 'presence') {
                events.push('break.present');
            }
            return events;
        }
        if (event.workstationPresence !== 'present') present = false;
        else if (event.isRunning && !present) {
            present = true;
            events.push(`${event.phase}.present`);
        }
        return events;
    };
}
