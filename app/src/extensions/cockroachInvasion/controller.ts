import { startEventDrivenRuntime } from '../eventDrivenRuntime';

const LEGACY_COCKROACH_CONTRIBUTION = {
    eventContract: 'pomodoro-broadcast-v1',
    activationPhase: 'break',
    delayMs: 60_000,
    requiresPresence: true,
    settingsGate: 'cockroachInvasion',
} as const;

export function startCockroachModuleController(): () => void {
    return startEventDrivenRuntime(
        'pet.cockroach-invasion',
        LEGACY_COCKROACH_CONTRIBUTION,
    );
}
