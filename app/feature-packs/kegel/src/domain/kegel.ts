export interface KegelSettings {
    enabled: boolean;
    repetitions: number;
    contractSeconds: number;
    relaxSeconds: number;
    volume: number;
    muted: boolean;
}

export const DEFAULT_KEGEL_SETTINGS: KegelSettings = {
    enabled: false, repetitions: 15, contractSeconds: 3, relaxSeconds: 3, volume: 0.5, muted: false,
};
export const KEGEL_RESET_SECONDS = 0.6;
export type KegelPhase = 'waiting' | 'contract' | 'relax' | 'resetting' | 'finished' | 'skipped';
export interface KegelSession {
    id: string;
    phase: KegelPhase;
    elapsed: number;
    completedReps: number;
    paused: boolean;
    resetFromScale: number;
    // Capture the exercise plan at start, so settings changes cannot rewrite a running group.
    plan: Pick<KegelSettings, 'repetitions' | 'contractSeconds' | 'relaxSeconds'>;
}

export function normalizeKegelSettings(value: unknown): KegelSettings {
    const s = (value && typeof value === 'object' ? value : {}) as Partial<KegelSettings>;
    const integer = (n: unknown, fallback: number, max: number) =>
        typeof n === 'number' && Number.isFinite(n) ? Math.max(1, Math.min(max, Math.round(n))) : fallback;
    return {
        enabled: s.enabled === true,
        repetitions: integer(s.repetitions, 15, 99),
        contractSeconds: integer(s.contractSeconds, 3, 60),
        relaxSeconds: integer(s.relaxSeconds, 3, 60),
        volume: typeof s.volume === 'number' && Number.isFinite(s.volume)
            ? Math.max(0, Math.min(1, s.volume)) : 0.5,
        muted: s.muted === true,
    };
}

export function createKegelSession(settings: KegelSettings): KegelSession {
    return {
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        phase: 'waiting', elapsed: 0, completedReps: 0, paused: false, resetFromScale: 1,
        plan: { repetitions: settings.repetitions, contractSeconds: settings.contractSeconds, relaxSeconds: settings.relaxSeconds },
    };
}

export function kegelOwnsBreak(session: KegelSession | null | undefined): boolean {
    return !!session && session.phase !== 'finished' && session.phase !== 'skipped';
}

export function kegelColors(session: KegelSession | null) {
    const paletteHash = (repetition: number) => {
        let hash = 2166136261;
        const key = `${session?.id ?? 'waiting'}:${repetition}`;
        for (const char of key) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
        return hash >>> 0;
    };
    const repetition = session?.completedReps ?? 0;
    // Keep the outgoing warm layer's color while it fades into the next cold
    // contraction. New warm colors are selected while that layer is hidden.
    const warmRepetition = session?.phase === 'contract' || session?.phase === 'finished'
        ? Math.max(0, repetition - 1) : repetition;
    const cold = [185, 198, 213, 228, 242, 256][paletteHash(repetition) % 6];
    const warm = [8, 18, 28, 38, 48][(paletteHash(warmRepetition) >>> 5) % 5];
    return {
        coldLight: `hsl(${cold} 65% 66%)`, coldDark: `hsl(${cold + 12} 48% 43%)`,
        warmLight: `hsl(${warm} 82% 73%)`, warmDark: `hsl(${warm - 5} 64% 48%)`,
        warm: session?.phase === 'relax' || session?.phase === 'resetting' || session?.phase === 'finished',
    };
}

const smooth = (t: number) => t * t * (3 - 2 * t);
export function kegelScale(session: KegelSession | null): number {
    if (!session) return 1;
    if (session.phase === 'contract') {
        const fast = Math.min(0.4, session.plan.contractSeconds / 2);
        if (session.elapsed <= fast) return 1 - 0.43 * (1 - (1 - session.elapsed / fast) ** 3);
        return 0.57 - 0.05 * Math.min(1, (session.elapsed - fast) / (session.plan.contractSeconds - fast));
    }
    if (session.phase === 'relax') return 0.52 + 0.48 * smooth(Math.min(1, session.elapsed / session.plan.relaxSeconds));
    if (session.phase === 'resetting') return session.resetFromScale
        + (1 - session.resetFromScale) * smooth(Math.min(1, session.elapsed / KEGEL_RESET_SECONDS));
    return 1;
}

/** Advances every crossed boundary, including when a frame is delayed. */
export function advanceKegel(session: KegelSession, delta: number): { session: KegelSession; restDelta: number } {
    if (!kegelOwnsBreak(session) || session.paused || session.phase === 'waiting' || !Number.isFinite(delta) || delta <= 0) {
        return { session, restDelta: 0 };
    }
    const next = { ...session };
    let remaining = delta;
    let restDelta = delta;
    while (remaining > 0 && kegelOwnsBreak(next)) {
        const duration = next.phase === 'resetting' ? KEGEL_RESET_SECONDS
            : next.phase === 'contract' ? next.plan.contractSeconds : next.plan.relaxSeconds;
        const step = Math.min(remaining, Math.max(0, duration - next.elapsed));
        if (next.phase === 'resetting') restDelta -= step;
        next.elapsed += step;
        remaining -= step;
        if (next.elapsed < duration - 1e-9) break;
        next.elapsed = 0;
        if (next.phase === 'resetting') next.phase = 'contract';
        else if (next.phase === 'contract') next.phase = 'relax';
        else {
            next.completedReps++;
            next.phase = next.completedReps >= next.plan.repetitions ? 'finished' : 'contract';
        }
    }
    return { session: next, restDelta: Math.max(0, restDelta) };
}
