import { useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import cockroachAnimationUrl from './assets/cockroach/american-cockroach-crawl.gif';
import {
    COCKROACH_ESCAPE_DURATION_MS,
    createCockroachMotionState,
    fleeFromCockroachClick,
    stepCockroachMotion,
    type CockroachMotionState,
    type ScreenRect,
    type ViewportSize,
} from './domain/cockroachMotion';
import {
    COCKROACH_INVASION_ACTIVE_EVENT,
    type CockroachInvasionActivation,
} from './domain/cockroachInvasionController';
import './CockroachInvasionApp.css';

const MAX_FRAME_DELTA_MS = 100;

interface CockroachWindowContext {
    screens: ScreenRect[];
    width: number;
    height: number;
    scaleFactor: number;
}

export default function CockroachInvasionApp() {
    const imageRef = useRef<HTMLImageElement>(null);
    const motionRef = useRef<CockroachMotionState | null>(null);
    const viewportRef = useRef<ViewportSize>({ width: 180, height: 180 });
    const scaleFactorRef = useRef(1);
    const escapeClassTimerRef = useRef<number | null>(null);

    useEffect(() => {
        let unlisten: UnlistenFn | null = null;
        let requestId: number | null = null;
        let generation = 0;
        let active = false;
        let lastFrameAt = 0;
        let screens: ScreenRect[] = [];
        let moveInFlight = false;

        const stopAnimation = () => {
            active = false;
            motionRef.current = null;
            if (requestId != null) {
                cancelAnimationFrame(requestId);
                requestId = null;
            }
            if (escapeClassTimerRef.current != null) {
                window.clearTimeout(escapeClassTimerRef.current);
                escapeClassTimerRef.current = null;
            }
            imageRef.current?.classList.remove('is-fleeing');
        };

        const applyOrientation = (motion: CockroachMotionState) => {
            const degrees = motion.headingRadians * 180 / Math.PI + 90;
            if (imageRef.current) {
                imageRef.current.style.transform = `rotate(${degrees}deg)`;
            }
        };

        const animate = (nowMs: number) => {
            if (!active || !motionRef.current) return;
            const deltaMs = lastFrameAt === 0
                ? 0
                : Math.min(MAX_FRAME_DELTA_MS, nowMs - lastFrameAt);
            lastFrameAt = nowMs;
            const motion = stepCockroachMotion({
                state: motionRef.current,
                screens,
                viewport: viewportRef.current,
                nowMs,
                deltaMs,
            });
            motionRef.current = motion;
            applyOrientation(motion);
            if (!moveInFlight) {
                moveInFlight = true;
                void invoke('move_cockroach_invasion_window', {
                    x: Math.round(motion.x),
                    y: Math.round(motion.y),
                })
                    .catch(() => {})
                    .finally(() => { moveInFlight = false; });
            }
            requestId = requestAnimationFrame(animate);
        };

        const setActive = async (shouldActivate: boolean) => {
            const currentGeneration = ++generation;
            if (!shouldActivate) {
                stopAnimation();
                return;
            }

            const context = await invoke<CockroachWindowContext>(
                'cockroach_invasion_window_context',
            );
            if (currentGeneration !== generation) return;
            screens = context.screens;
            if (!screens.length) return;
            viewportRef.current = {
                width: context.width,
                height: context.height,
            };
            scaleFactorRef.current = context.scaleFactor;
            const nowMs = performance.now();
            const motion = createCockroachMotionState({
                screens,
                viewport: viewportRef.current,
                nowMs,
            });
            motionRef.current = motion;
            applyOrientation(motion);
            await invoke('move_cockroach_invasion_window', {
                x: Math.round(motion.x),
                y: Math.round(motion.y),
            });
            if (currentGeneration !== generation) return;
            await invoke('show_cockroach_invasion_window');
            active = true;
            lastFrameAt = nowMs;
            requestId = requestAnimationFrame(animate);
        };

        void listen<CockroachInvasionActivation>(
            COCKROACH_INVASION_ACTIVE_EVENT,
            (event) => { void setActive(event.payload.active); },
        ).then((dispose) => { unlisten = dispose; });

        return () => {
            generation += 1;
            stopAnimation();
            unlisten?.();
        };
    }, []);

    const flee = (event: React.PointerEvent<HTMLButtonElement>) => {
        const motion = motionRef.current;
        if (!motion) return;
        const scaleFactor = scaleFactorRef.current;
        motionRef.current = fleeFromCockroachClick({
            state: motion,
            click: {
                x: event.clientX * scaleFactor,
                y: event.clientY * scaleFactor,
            },
            viewport: viewportRef.current,
            nowMs: performance.now(),
        });
        imageRef.current?.classList.add('is-fleeing');
        if (escapeClassTimerRef.current != null) {
            window.clearTimeout(escapeClassTimerRef.current);
        }
        escapeClassTimerRef.current = window.setTimeout(() => {
            imageRef.current?.classList.remove('is-fleeing');
            escapeClassTimerRef.current = null;
        }, COCKROACH_ESCAPE_DURATION_MS);
    };

    return (
        <main className="cockroach-invasion-root">
            <button
                type="button"
                className="cockroach-hit-target"
                aria-label="赶走蟑螂"
                tabIndex={-1}
                onPointerDown={flee}
            >
                <img
                    ref={imageRef}
                    className="cockroach-animation"
                    src={cockroachAnimationUrl}
                    alt=""
                    draggable={false}
                />
            </button>
        </main>
    );
}
