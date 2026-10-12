import { describe, expect, it } from 'vitest';
import { advanceKegel, createKegelSession, DEFAULT_KEGEL_SETTINGS, kegelColors, kegelScale } from '../../feature-packs/kegel/src/domain/kegel';
import { BELL_PITCHES, nextBellPitch } from '../../feature-packs/kegel/src/domain/kegelAudio';
import { kegelStats, recordKegelReps } from '../../feature-packs/kegel/src/domain/kegelHistory';
describe('animation and local calendar history', () => {
    it('keeps a random cold palette through contraction, and switches to warm on relaxation', () => {
        const session = { ...createKegelSession(DEFAULT_KEGEL_SETTINGS), phase: 'contract' as const };
        expect(kegelColors(session).warm).toBe(false);
        expect(kegelColors({ ...session, elapsed: 2.9 })).toEqual(kegelColors(session));
        expect(kegelColors({ ...session, phase: 'relax' }).warm).toBe(true);
        expect(kegelColors({ ...session, phase: 'resetting' }).warm).toBe(true);
    });
    it('chooses pitched bells from a compatible palette without repeating the previous pitch', () => {
        for (const previous of BELL_PITCHES) {
            for (const random of [0, 0.2, 0.5, 0.999]) {
                const next = nextBellPitch(previous, () => random);
                expect(BELL_PITCHES).toContain(next);
                expect(next).not.toBe(previous);
            }
        }
    });
    it('has fast contraction followed by slow tension and gradual relaxation', () => {
        const initial = { ...createKegelSession(DEFAULT_KEGEL_SETTINGS), phase: 'contract' as const };
        const fast = advanceKegel(initial, 0.4).session;
        const hold = advanceKegel(initial, 2.9).session;
        expect(kegelScale(fast)).toBeCloseTo(0.57);
        expect(kegelScale(hold)).toBeLessThan(kegelScale(fast));
        const relaxed = advanceKegel(initial, 4.5).session;
        expect(relaxed.phase).toBe('relax');
        expect(kegelScale(relaxed)).toBeCloseTo(0.76);
    });
    it('preserves yesterday streak, breaks it after missed days, and credits a cross-midnight set on completion day', () => {
        let records = recordKegelReps([], 'a', 15, 15, true, '2026-10-08');
        records = recordKegelReps(records, 'b', 15, 14, false, '2026-10-09');
        expect(kegelStats(records, '2026-10-09')).toMatchObject({ streak: 1, sets: 0, repetitions: 14 });
        expect(kegelStats(records, '2026-10-10').streak).toBe(0);
        records = recordKegelReps(records, 'b', 15, 1, true, '2026-10-10');
        expect(kegelStats(records, '2026-10-10')).toMatchObject({ streak: 1, sets: 1, repetitions: 1 });
        records = recordKegelReps(records, 'c', 10, 10, true, '2026-10-11');
        expect(kegelStats(records, '2026-10-11')).toMatchObject({ streak: 2, sets: 1, repetitions: 10 });
    });
});
