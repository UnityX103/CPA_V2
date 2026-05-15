import { useEffect, useRef } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { usePomodoroStore, formatMmSs, type PomodoroPhase } from '../domain/pomodoro';
import { useSettingsStore } from '../domain/settings';
import { useHitRegion } from '../domain/passthrough';
import './PomodoroPanel.css';

type ClockState = 'focus' | 'rest' | 'paused' | 'off';

function clockStateOf(phase: PomodoroPhase, isRunning: boolean): ClockState {
    if (phase === 'completed') return 'off';
    if (!isRunning) {
        // 「未开始」与「已暂停」区分：远端样式上一致用 paused，UI 这里按是否还有剩余区分。
        // 这里采用与设计变量一致的命名：暂停 → paused；首次未开始 → focus 但底色淡
        return 'paused';
    }
    return phase === 'focus' ? 'focus' : 'rest';
}

function phaseLabel(phase: PomodoroPhase, isRunning: boolean): string {
    if (phase === 'completed') return '已完成';
    if (!isRunning) return '已暂停';
    return phase === 'focus' ? '专注中' : '休息中';
}

export function PomodoroPanel() {
    const state = usePomodoroStore();
    const tickRef = useRef<number | null>(null);
    const hitRef = useHitRegion('pomodoro-panel');

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

    const onStartClick = () => {
        const s = usePomodoroStore.getState();
        if (s.isRunning) s.pause(); else s.start();
    };

    const onSkipClick = () => usePomodoroStore.getState().skip();
    const onTogglePin = () => usePomodoroStore.getState().togglePin();

    const onHeaderPointerDown = async (e: React.PointerEvent) => {
        // 拖动整个窗口
        if (e.button !== 0) return;
        try { await getCurrentWindow().startDragging(); } catch {}
    };

    return (
        <div ref={hitRef} className="pomo-panel" data-clock-state={clockState}>
            <div className="pomo-content">
                <div className="pomo-header" onPointerDown={onHeaderPointerDown}>
                    <div className="pomo-title">
                        <span className="pomo-title-text">番茄钟</span>
                        <button
                            className="pomo-icon-btn"
                            aria-label="设置"
                            title="设置"
                            onClick={() => useSettingsStore.getState().open()}
                        >
                            <SettingsIcon />
                        </button>
                    </div>
                    <div className="pomo-streak">
                        连续专注 <span className="pomo-streak-num">{state.consecutiveCompletedFocus}</span> 次
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

                <button
                    className={`pomo-pin ${state.isPinned ? 'is-pinned' : ''}`}
                    onClick={onTogglePin}
                    aria-label="置顶"
                    title={state.isPinned ? '取消置顶' : '置顶'}
                >
                    <PinIcon active={state.isPinned} />
                </button>
            </div>
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
    const size = 78;
    const stroke = 8;
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
            <div className="pomo-clock-text" style={{ color: labelColor }}>
                <div className="pomo-clock-time">{label}</div>
                <div className="pomo-clock-sub">{sub}</div>
            </div>
        </div>
    );
}

function SettingsIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
    );
}

function PinIcon({ active }: { active: boolean }) {
    if (active) {
        return (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <path d="M14 4v5l3 3v2h-5v6l-1 1-1-1v-6H5v-2l3-3V4h-1V2h8v2h-1z" />
            </svg>
        );
    }
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 4v5l3 3v2h-5v6l-1 1-1-1v-6H5v-2l3-3V4h-1V2h8v2h-1z" />
        </svg>
    );
}
