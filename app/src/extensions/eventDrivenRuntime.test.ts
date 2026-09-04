import { describe, expect, it, vi } from 'vitest';
import type { PomodoroBroadcast, PomodoroBroadcastEvent } from '../domain/pomodoroBroadcast';
import { usePresenceStore } from '../domain/presence';
import { useSettingsStore } from '../domain/settings';
import { startEventDrivenRuntime } from './eventDrivenRuntime';

describe('event-driven extension runtime', () => {
    it('uses the feature manifest policy to react to the public Pomodoro contract', () => {
        useSettingsStore.setState({ breakPetMode: 'cockroachInvasion' });
        usePresenceStore.setState({
            enabled: true,
            restDeskReminderEnabled: true,
            restDeskReminderMode: 'cockroachInvasion',
            confirmedPresence: 'present',
        });
        let nowMs = 0;
        let wake: (() => void) | null = null;
        let listener: ((event: PomodoroBroadcastEvent) => void) | null = null;
        const setActive = vi.fn();
        const snapshot: PomodoroBroadcastEvent = {
            v: 1,
            sequence: 1,
            emittedAt: 0,
            type: 'snapshot',
            phase: 'break',
            previousPhase: null,
            isRunning: false,
            round: 1,
            totalRounds: 4,
            remainingSeconds: 300,
            reason: 'hydrate',
        };
        const broadcast: PomodoroBroadcast = {
            current: () => snapshot,
            start: () => () => {},
            subscribe: (next) => {
                listener = next;
                return () => { listener = null; };
            },
        };
        const stop = startEventDrivenRuntime(
            'pet.cockroach-invasion',
            {
                eventContract: 'pomodoro-broadcast-v1',
                activationPhase: 'break',
                delayMs: 60_000,
                requiresPresence: true,
                settingsGate: 'cockroachInvasion',
            },
            {
                now: () => nowMs,
                setTimeout: (callback) => {
                    wake = callback;
                    return 1;
                },
                clearTimeout: () => {},
                setActive,
            },
            broadcast,
        );

        nowMs = 60_000;
        (wake as unknown as () => void)();
        expect(setActive).toHaveBeenCalledWith('pet.cockroach-invasion', true);

        const emit = listener as unknown as (event: PomodoroBroadcastEvent) => void;
        emit({ ...snapshot, sequence: 2, phase: 'focus', previousPhase: 'break' });
        expect(setActive).toHaveBeenCalledWith('pet.cockroach-invasion', false);
        stop();
    });
});
