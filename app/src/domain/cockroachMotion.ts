export const COCKROACH_NORMAL_SPEED_PX_PER_SECOND = 120;
export const COCKROACH_ESCAPE_SPEED_PX_PER_SECOND = 360;
export const COCKROACH_ESCAPE_DURATION_MS = 1_600;

const MIN_RANDOM_TURN_DELAY_MS = 900;
const RANDOM_TURN_DELAY_RANGE_MS = 1_800;
const FULL_TURN_RADIANS = Math.PI * 2;

export interface ScreenRect {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface ViewportSize {
    width: number;
    height: number;
}

export interface Point {
    x: number;
    y: number;
}

export interface CockroachMotionState {
    x: number;
    y: number;
    headingRadians: number;
    nextTurnAtMs: number;
    escapeUntilMs: number;
}

type RandomSource = () => number;

function randomTurnDelayMs(random: RandomSource): number {
    return MIN_RANDOM_TURN_DELAY_MS + random() * RANDOM_TURN_DELAY_RANGE_MS;
}

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

function screenIndexForCenter(
    x: number,
    y: number,
    screens: ScreenRect[],
    viewport: ViewportSize,
): number {
    const centerX = x + viewport.width / 2;
    const centerY = y + viewport.height / 2;
    return screens.findIndex((screen) => (
        centerX >= screen.x
        && centerX <= screen.x + screen.width
        && centerY >= screen.y
        && centerY <= screen.y + screen.height
    ));
}

export function createCockroachMotionState({
    screens,
    viewport,
    nowMs,
    random = Math.random,
}: {
    screens: ScreenRect[];
    viewport: ViewportSize;
    nowMs: number;
    random?: RandomSource;
}): CockroachMotionState {
    const selected = screens.length
        ? screens[Math.min(screens.length - 1, Math.floor(random() * screens.length))]
        : { x: 0, y: 0, width: viewport.width, height: viewport.height };
    const availableWidth = Math.max(0, selected.width - viewport.width);
    const availableHeight = Math.max(0, selected.height - viewport.height);
    return {
        x: selected.x + random() * availableWidth,
        y: selected.y + random() * availableHeight,
        headingRadians: random() * FULL_TURN_RADIANS,
        nextTurnAtMs: nowMs + randomTurnDelayMs(random),
        escapeUntilMs: 0,
    };
}

export function motionSpeedPxPerSecond(
    state: CockroachMotionState,
    nowMs: number,
): number {
    return nowMs < state.escapeUntilMs
        ? COCKROACH_ESCAPE_SPEED_PX_PER_SECOND
        : COCKROACH_NORMAL_SPEED_PX_PER_SECOND;
}

export function stepCockroachMotion({
    state,
    screens,
    viewport,
    nowMs,
    deltaMs,
    random = Math.random,
}: {
    state: CockroachMotionState;
    screens: ScreenRect[];
    viewport: ViewportSize;
    nowMs: number;
    deltaMs: number;
    random?: RandomSource;
}): CockroachMotionState {
    if (!screens.length || deltaMs <= 0) return state;

    let headingRadians = state.headingRadians;
    let nextTurnAtMs = state.nextTurnAtMs;
    if (nowMs >= nextTurnAtMs && nowMs >= state.escapeUntilMs) {
        headingRadians = random() * FULL_TURN_RADIANS;
        nextTurnAtMs = nowMs + randomTurnDelayMs(random);
    }

    const distance = motionSpeedPxPerSecond(state, nowMs) * deltaMs / 1_000;
    let x = state.x + Math.cos(headingRadians) * distance;
    let y = state.y + Math.sin(headingRadians) * distance;
    const currentScreenIndex = screenIndexForCenter(state.x, state.y, screens, viewport);
    const targetScreenIndex = screenIndexForCenter(x, y, screens, viewport);

    if (targetScreenIndex < 0 || targetScreenIndex === currentScreenIndex) {
        const screen = screens[Math.max(0, currentScreenIndex)];
        const minX = screen.x;
        const maxX = screen.x + Math.max(0, screen.width - viewport.width);
        const minY = screen.y;
        const maxY = screen.y + Math.max(0, screen.height - viewport.height);
        if (x < minX || x > maxX) {
            x = clamp(x, minX, maxX);
            headingRadians = Math.PI - headingRadians;
        }
        if (y < minY || y > maxY) {
            y = clamp(y, minY, maxY);
            headingRadians = -headingRadians;
        }
    }

    return {
        ...state,
        x,
        y,
        headingRadians,
        nextTurnAtMs,
    };
}

export function fleeFromCockroachClick({
    state,
    click,
    viewport,
    nowMs,
}: {
    state: CockroachMotionState;
    click: Point;
    viewport: ViewportSize;
    nowMs: number;
}): CockroachMotionState {
    const awayX = viewport.width / 2 - click.x;
    const awayY = viewport.height / 2 - click.y;
    const headingRadians = Math.abs(awayX) + Math.abs(awayY) < 0.001
        ? state.headingRadians + Math.PI
        : Math.atan2(awayY, awayX);
    const escapeUntilMs = nowMs + COCKROACH_ESCAPE_DURATION_MS;
    return {
        ...state,
        headingRadians,
        escapeUntilMs,
        nextTurnAtMs: Math.max(state.nextTurnAtMs, escapeUntilMs),
    };
}
