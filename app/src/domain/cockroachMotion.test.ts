import { describe, expect, it } from 'vitest';
import {
    COCKROACH_ESCAPE_SPEED_PX_PER_SECOND,
    createCockroachMotionState,
    fleeFromCockroachClick,
    motionSpeedPxPerSecond,
    stepCockroachMotion,
    type CockroachMotionState,
} from './cockroachMotion';

const screens = [
    { x: 0, y: 0, width: 1_000, height: 800 },
    { x: 1_000, y: 0, width: 1_200, height: 900 },
];
const viewport = { width: 180, height: 180 };

describe('cockroach motion', () => {
    it('chooses any screen, stays in screen bounds, and flees away from a click at boosted speed', () => {
        const spawned = createCockroachMotionState({
            screens,
            viewport,
            nowMs: 0,
            random: () => 0.75,
        });
        expect(spawned.x).toBeGreaterThanOrEqual(1_000);
        expect(spawned.x + viewport.width).toBeLessThanOrEqual(2_200);

        const edgeState: CockroachMotionState = {
            ...spawned,
            x: 2_020,
            y: 300,
            headingRadians: 0,
            nextTurnAtMs: 10_000,
            escapeUntilMs: 0,
        };
        const bounced = stepCockroachMotion({
            state: edgeState,
            screens,
            viewport,
            nowMs: 1_000,
            deltaMs: 1_000,
            random: () => 0.5,
        });
        expect(bounced.x + viewport.width).toBeLessThanOrEqual(2_200);
        expect(Math.cos(bounced.headingRadians)).toBeLessThan(0);

        const fleeing = fleeFromCockroachClick({
            state: bounced,
            click: { x: 0, y: viewport.height / 2 },
            viewport,
            nowMs: 2_000,
        });
        expect(Math.cos(fleeing.headingRadians)).toBeGreaterThan(0);
        expect(motionSpeedPxPerSecond(fleeing, 2_001)).toBe(
            COCKROACH_ESCAPE_SPEED_PX_PER_SECOND,
        );
    });

    it('selects a new random heading after the current travel interval', () => {
        const turned = stepCockroachMotion({
            state: {
                x: 300,
                y: 300,
                headingRadians: 0,
                nextTurnAtMs: 500,
                escapeUntilMs: 0,
            },
            screens,
            viewport,
            nowMs: 1_000,
            deltaMs: 100,
            random: () => 0.25,
        });

        expect(turned.headingRadians).toBeCloseTo(Math.PI / 2);
        expect(turned.y).toBeGreaterThan(300);
    });
});
