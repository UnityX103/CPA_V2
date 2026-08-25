import { useEffect, useRef } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { invoke } from '@tauri-apps/api/core';
import { usePomodoroStore, formatMmSs, type PomodoroPhase } from '../domain/pomodoro';
import { usePresenceStore, type ConfirmedPresence } from '../domain/presence';
import { shouldStartWindowDrag } from './windowDrag';
import './PomodoroPanel.css';

type ClockState = 'focus' | 'rest' | 'paused' | 'off';

function clockStateOf(phase: PomodoroPhase, isRunning: boolean): ClockState {
    if (phase === 'completed') return 'off';
    if (!isRunning) return 'paused';
    return phase === 'focus' ? 'focus' : 'rest';
}

function phaseLabel(phase: PomodoroPhase, isRunning: boolean): string {
    if (phase === 'completed') return '已完成';
    if (!isRunning) return '已暂停';
    return phase === 'focus' ? '专注中' : '休息中';
}

export function PomodoroPanel() {
    const state = usePomodoroStore();
    const presence = usePresenceStore();
    const tickRef = useRef<number | null>(null);

    useEffect(() => {
        let last = performance.now();
        let rafId = 0;
        const loop = (now: number) => {
            const delta = (now - last) / 1000;
            last = now;
            usePomodoroStore.getState().tick(delta);
            rafId = requestAnimationFrame(loop);
        };
        rafId = requestAnimationFrame(loop);
        tickRef.current = rafId;
        return () => cancelAnimationFrame(rafId);
    }, []);

    useEffect(() => {
        void invoke('set_main_window_pinned', { onTop: state.isPinned })
            .catch((error) => {
                console.error('[pin] set_main_window_pinned failed', error);
            });
    }, [state.isPinned]);

    const totalSeconds =
        state.currentPhase === 'break'
            ? state.breakDurationSeconds
            : state.focusDurationSeconds;
    const progress = state.currentPhase === 'completed'
        ? 1
        : Math.min(1, Math.max(0, 1 - state.remainingSeconds / Math.max(1, totalSeconds)));

    const clockState = clockStateOf(state.currentPhase, state.isRunning);
    const startLabel = state.isRunning ? '暂停' : '开始';
    const showSkip = state.isRunning && state.currentPhase !== 'completed';
    const confirmedPresence = presence.enabled
        && (presence.availability === 'ready' || presence.availability === 'checking')
        && presence.lastSuccessfulAt != null
        && presence.confirmedPresence !== 'unknown'
        ? presence.confirmedPresence
        : null;

    const onStartClick = () => {
        const s = usePomodoroStore.getState();
        if (s.isRunning) s.pause(); else s.start();
    };

    const onSkipClick = () => usePomodoroStore.getState().skip();
    const onTogglePin = () => usePomodoroStore.getState().togglePin();

    const onPanelPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
        if (!shouldStartWindowDrag(e.button, e.target)) return;
        void getCurrentWindow().startDragging().catch(() => {
            /* drag may fail in non-Tauri/test env; swallow */
        });
    };

    return (
        <div
            className="pomo-panel"
            data-clock-state={clockState}
            onPointerDown={onPanelPointerDown}
        >
            <div className="pomo-content">
                <div className="pomo-header">
                    <div className="pomo-title">
                        <span className="pomo-title-text">番茄钟</span>
                        <button
                            className="pomo-icon-btn"
                            aria-label="设置"
                            title="设置"
                            onClick={() => { void invoke('open_settings_window'); }}
                        >
                            <SettingsIcon />
                        </button>
                    </div>
                    <div className="pomo-streak">
                        <span className="pomo-streak-label">连续专注</span>
                        <span className="pomo-streak-num">{state.consecutiveCompletedFocus} 次</span>
                    </div>
                </div>

                <div className="pomo-body">
                    <ClockRing
                        progress={progress}
                        label={formatMmSs(state.remainingSeconds)}
                        sub={phaseLabel(state.currentPhase, state.isRunning)}
                        clockState={clockState}
                    />
                    <div className="pomo-actions">
                        <button
                            className="btn btn-primary"
                            data-timer-state={state.isRunning ? 'running' : 'idle'}
                            onClick={onStartClick}
                        >
                            {startLabel}
                        </button>
                        <button
                            className="btn btn-secondary"
                            disabled={!showSkip}
                            onClick={onSkipClick}
                        >
                            跳过
                        </button>
                    </div>
                </div>
                {confirmedPresence && (
                    <ConfirmedPresenceStatus presence={confirmedPresence} />
                )}
            </div>
            <button
                className={`pomo-pin ${state.isPinned ? 'is-pinned' : ''}`}
                onClick={onTogglePin}
                aria-label="置顶"
                title={state.isPinned ? '取消置顶' : '置顶'}
            >
                <PinIcon active={state.isPinned} />
            </button>
        </div>
    );
}

function ConfirmedPresenceStatus({
    presence,
}: {
    presence: Exclude<ConfirmedPresence, 'unknown'>;
}) {
    const present = presence === 'present';
    return (
        <div
            className={`pomo-presence-status is-${presence}`}
            role="status"
            aria-label={present ? '检测到人，在工位' : '未检测到人，已离开'}
            data-confirmed-presence={presence}
        >
            <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
            >
                {present ? (
                    <>
                        <path d="M2 21a8 8 0 0 1 13.292-6" />
                        <circle cx="10" cy="8" r="5" />
                        <path d="m16 19 2 2 4-4" />
                    </>
                ) : (
                    <>
                        <path d="M2 21a8 8 0 0 1 11.873-7" />
                        <circle cx="10" cy="8" r="5" />
                        <path d="m17 17 5 5" />
                        <path d="m22 17-5 5" />
                    </>
                )}
            </svg>
        </div>
    );
}

interface ClockRingProps {
    progress: number;
    label: string;
    sub: string;
    clockState: ClockState;
}

function ClockRing({ progress, label, sub, clockState }: ClockRingProps) {
    /* PUI.pen nNt9z: 78x78 ellipse, innerRadius 0.77 → stroke = (1-0.77)/2 * 78 = 8.97px ≈ 9 */
    const size = 78;
    const stroke = 9;
    const radius = (size - stroke) / 2;
    const circumference = 2 * Math.PI * radius;
    const offset = circumference * (1 - progress);
    const cx = size / 2;
    const cy = size / 2;
    const ringBg = `var(--clock-${clockState}-ring-bg)`;
    const ringFg = `var(--clock-${clockState}-ring-progress)`;
    const labelColor = `var(--clock-${clockState}-label)`;

    return (
        <div className="pomo-clock" aria-label={`${sub} ${label}`}>
            <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
                <circle cx={cx} cy={cy} r={radius} stroke={ringBg} strokeWidth={stroke} fill="none" />
                <circle
                    cx={cx} cy={cy} r={radius}
                    stroke={ringFg}
                    strokeWidth={stroke}
                    fill="none"
                    strokeDasharray={circumference}
                    strokeDashoffset={offset}
                    strokeLinecap="round"
                    transform={`rotate(-90 ${cx} ${cy})`}
                />
            </svg>
            <div className="pomo-clock-text">
                <div className="pomo-clock-time">{label}</div>
                <div className="pomo-clock-sub" style={{ color: labelColor }}>{sub}</div>
            </div>
        </div>
    );
}

function SettingsIcon() {
    /* lucide `settings` (cHy9C) — height fill_container of 14px gives this size */
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
            <circle cx="12" cy="12" r="3" />
        </svg>
    );
}

function PinIcon({ active }: { active: boolean }) {
    /* lucide `pin` (active) / `pin-off` */
    if (active) {
        return (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                <path d="M14 4v5l3 3v2h-5v6l-1 1-1-1v-6H5v-2l3-3V4h-1V2h8v2h-1z" />
            </svg>
        );
    }
    return (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="3" y1="3" x2="21" y2="21" />
            <path d="M14 4v5l3 3v2h-5v6l-1 1-1-1v-6H5v-2l3-3V4" />
        </svg>
    );
}
