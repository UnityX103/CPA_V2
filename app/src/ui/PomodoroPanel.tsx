import { useEffect, useRef, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { invoke } from '@tauri-apps/api/core';
import { usePomodoroStore, formatMmSs, type PomodoroPhase } from '../domain/pomodoro';
import { usePresenceStore, type ConfirmedPresence } from '../domain/presence';
import { shouldStartWindowDrag } from './windowDrag';
import './PomodoroPanel.css';
import { usePomodoroDocking } from './usePomodoroDocking';

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

export function PomodoroPanel({ preferencesReady = true }: { preferencesReady?: boolean } = {}) {
    const state = usePomodoroStore();
    const presence = usePresenceStore();
    const tickRef = useRef<number | null>(null);
    const resumeRef = useRef<HTMLButtonElement>(null);
    const startRef = useRef<HTMLButtonElement>(null);
    const [pausedDuringSession, setPausedDuringSession] = useState(false);
    const [autoDock, setAutoDock] = useState(() => localStorage.getItem('pomo-auto-dock') === 'true');
    const [touchActions, setTouchActions] = useState(false);

    useEffect(() => usePomodoroStore.subscribe((next, previous) => {
        if (next.isRunning || next.currentPhase !== previous.currentPhase
            || next.currentRound !== previous.currentRound
            || next.remainingSeconds !== previous.remainingSeconds
            || next.totalRounds !== previous.totalRounds
            || next.focusDurationSeconds !== previous.focusDurationSeconds
            || next.breakDurationSeconds !== previous.breakDurationSeconds) {
            setPausedDuringSession(false);
        } else if (previous.isRunning && !next.isRunning) {
            setPausedDuringSession(true);
        }
    }), []);

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
        void invoke('set_main_window_pinned', { onTop: state.isPinned || autoDock })
            .catch((error) => {
                console.error('[pin] set_main_window_pinned failed', error);
            });
    }, [state.isPinned, autoDock]);

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
    const confirmedPresence = (presence.enabled || (presence.inputActivityEnabled && state.currentPhase === 'break'))
        && (presence.inputActivityAvailability === 'ready' || presence.availability === 'ready' || presence.availability === 'checking')
        && presence.lastSuccessfulAt != null
        && presence.confirmedPresence !== 'unknown'
        ? presence.confirmedPresence
        : null;
    const cameraAvailable = presence.enabled
        && (presence.availability === 'ready' || presence.availability === 'checking');
    const inputAvailable = presence.inputActivityEnabled && presence.inputActivityAvailability === 'ready';
    const automaticPause = state.currentPhase === 'focus'
        ? cameraAvailable && state.presenceAutomationState === 'focusPaused'
        : (cameraAvailable || inputAvailable)
            && (state.presenceAutomationState === 'breakPaused'
                || (state.presenceAutomationState === 'breakResumeEligible' && confirmedPresence === 'present'));
    const showPauseOverlay = !state.isRunning && state.currentPhase !== 'completed'
        && (pausedDuringSession || state.remainingSeconds < totalSeconds || automaticPause);
    const showStartOverlay = !state.isRunning && !showPauseOverlay && state.currentPhase !== 'completed';
    const docking = usePomodoroDocking(autoDock, showPauseOverlay, state.currentPhase, preferencesReady);
    const windowMode = autoDock ? '停靠' : state.isPinned ? '置顶' : '取消置顶';

    useEffect(() => {
        if (showPauseOverlay && !automaticPause && document.activeElement === startRef.current) {
            resumeRef.current?.focus();
        }
    }, [showPauseOverlay, automaticPause]);

    const onStartClick = () => {
        const s = usePomodoroStore.getState();
        if (s.isRunning) s.pause(); else s.start();
    };

    const onSkipClick = () => usePomodoroStore.getState().skip();
    const onTogglePin = () => {
        if (autoDock) { setAutoDock(false); localStorage.setItem('pomo-auto-dock', 'false'); usePomodoroStore.getState().setPinned(false); }
        else if (state.isPinned) { setAutoDock(true); localStorage.setItem('pomo-auto-dock', 'true'); }
        else usePomodoroStore.getState().setPinned(true);
    };

    const onPanelPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
        if (!shouldStartWindowDrag(e.button, e.target)) return;
        const dragging = ('__TAURI_INTERNALS__' in window) ? invoke('drag_pomodoro_window') : getCurrentWindow().startDragging();
        void dragging.catch(() => {
            /* drag may fail in non-Tauri/test env; swallow */
        });
    };

    if (docking.side) {
        const label = showPauseOverlay ? '已暂停' : showStartOverlay ? '待开始'
            : state.currentPhase === 'completed' ? '已完成' : formatMmSs(state.remainingSeconds);
        return <div className="pomo-dock-frame"><div className="pomo-dock" data-side={docking.side}
            data-phase={state.currentPhase} data-paused={showPauseOverlay || undefined}
            data-expanded={docking.expanded || undefined}
            onPointerDown={onPanelPointerDown}
            onPointerEnter={() => docking.hover(true)}
            onPointerLeave={() => {
                if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
                docking.hover(false);
            }}>
            <div className="pomo-dock-bar" role="progressbar" aria-label="本轮已完成进度"
                aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
                <div style={{ height: `${progress * 100}%` }} />
            </div>
            <div className="pomo-dock-info" inert={!docking.expanded}>
                <div className="pomo-dock-time-zone">
                    <span className="pomo-dock-label" data-time={state.isRunning || undefined}>
                        {state.isRunning ? <>
                            <span>{String(Math.floor(state.remainingSeconds / 60)).padStart(2, '0')}</span>
                            <span className="pomo-dock-colon">··</span>
                            <span>{String(state.remainingSeconds % 60).padStart(2, '0')}</span>
                        </> : label}
                    </span>
                    <button className="pomo-dock-action" onClick={onStartClick}>
                        {state.isRunning ? '暂停' : showPauseOverlay ? '恢复' : '开始'}
                    </button>
                </div>
                <button className="pomo-dock-settings" aria-label="设置" onClick={() => { void invoke('open_settings_window'); }}><SettingsIcon /></button>
            </div>
        </div></div>;
    }

    return (
        <div
            className="pomo-panel"
            data-clock-state={clockState}
            onPointerDown={onPanelPointerDown}
        >
            <div className="pomo-content">
                <div className="pomo-header">
                    <div className="pomo-streak">
                        <span className="pomo-streak-label">连续专注</span>
                        <span className="pomo-streak-num">{state.consecutiveCompletedFocus} 次</span>
                    </div>
                </div>

                {!showStartOverlay && <div className="pomo-body" inert={showPauseOverlay} data-no-window-drag
                    data-show-actions={touchActions || undefined}
                    onPointerDown={(event) => {
                        if (event.pointerType === 'touch') setTouchActions(true);
                    }}
                    onPointerLeave={() => setTouchActions(false)}
                >
                    <ClockRing
                        progress={progress}
                        label={formatMmSs(state.remainingSeconds)}
                        sub={!state.isRunning && !showPauseOverlay && state.currentPhase !== 'completed' ? '待开始' : phaseLabel(state.currentPhase, state.isRunning)}
                        clockState={clockState}
                    />
                    <div className="pomo-actions">
                        <button
                            className="btn btn-primary"
                            ref={startRef}
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
                </div>}
            </div>
            <button className="pomo-icon-btn" aria-label="设置" title="设置"
                onClick={() => { void invoke('open_settings_window'); }}>
                <SettingsIcon />
            </button>
            {confirmedPresence && <ConfirmedPresenceStatus presence={confirmedPresence} />}
            <button
                className={`pomo-pin ${state.isPinned ? 'is-pinned' : ''} ${autoDock ? 'is-docking' : ''}`}
                onClick={onTogglePin}
                aria-label="置顶"
                title={`${windowMode}；点击切换为${autoDock ? '取消置顶' : state.isPinned ? '停靠' : '置顶'}`}
            >
                <PinIcon active={state.isPinned} />
            </button>
            {showStartOverlay && (
                <div className="pomo-pause-overlay pomo-start-overlay" role="region" aria-label="番茄钟待开始">
                    <div className="pomo-pause-title">待开始</div>
                    <dl className="pomo-start-summary">
                        <div><dt>专注轮次</dt><dd>{state.totalRounds}<span>次</span></dd></div>
                        <div><dt>每次专注</dt><dd>{state.focusDurationSeconds / 60}<span>分钟</span></dd></div>
                        <div><dt>每次休息</dt><dd>{state.breakDurationSeconds / 60}<span>分钟</span></dd></div>
                    </dl>
                    <button className="btn pomo-resume" onClick={() => {
                        setTouchActions(false);
                        usePomodoroStore.getState().start();
                    }}>开始</button>
                </div>
            )}
            {showPauseOverlay && (
                <div className="pomo-pause-overlay" role="region" aria-label="番茄钟已暂停">
                    <div className="pomo-pause-title">已暂停</div>
                    <button className="btn pomo-resume" ref={resumeRef} onClick={() => {
                        setTouchActions(false);
                        usePomodoroStore.getState().start();
                    }}>恢复</button>
                </div>
            )}
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
