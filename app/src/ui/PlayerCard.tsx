import type { RemotePlayer, RemoteState } from '../domain/network';
import './PlayerCard.css';

interface PlayerCardProps {
    player: RemotePlayer;
}

interface PhaseBadge {
    label: string;
    bg: string;        /* UPUHf.fill */
}

/* phase + isRunning → 与 Pencil PlayerCard/States 完全一致的色 + 文案 */
function deriveBadge(state: RemoteState | null): PhaseBadge {
    if (!state) return { label: '待加入', bg: '#B5A49A' };
    if (state.pomodoro.phase === 2) return { label: '已完成', bg: '#6366F1' };
    if (!state.pomodoro.isRunning) return { label: '已暂停', bg: '#E08C10' };
    if (state.pomodoro.phase === 1) return { label: '休息中', bg: '#34A853' };
    return { label: '专注中', bg: '#D15F3D' };
}

export function PlayerCard({ player }: PlayerCardProps) {
    const badge = deriveBadge(player.state);
    const appName = player.state?.activeApp?.name ?? '待加入';
    const binding = player.state?.bindingKey ?? null;

    return (
        <div className="pc-card">
            <div className="pc-content">
                <div className="pc-row pc-row-head">
                    <div className="pc-name-col">
                        <span className="pc-name">{player.playerName || '远端玩家'}</span>
                        <span className="pc-phase-badge" style={{ backgroundColor: badge.bg }}>
                            <span className="pc-phase-dot" />
                            <span className="pc-phase-text">{badge.label}</span>
                        </span>
                    </div>
                    {binding && (
                        <div className="pc-time-row">
                            <span className="pc-pill" title={`${binding.keyLabel} × ${binding.pressCount}`}>
                                <span className="pc-pill-key">{binding.keyLabel}</span>
                                <span className="pc-pill-count">{binding.pressCount}</span>
                            </span>
                        </div>
                    )}
                </div>

                <div className="pc-divider" />

                <div className="pc-footer">
                    <span className="pc-foot-icon" aria-hidden>
                        <AppWindowIcon />
                    </span>
                    <span className="pc-foot-text">{appName}</span>
                </div>
            </div>
        </div>
    );
}

function AppWindowIcon() {
    /* lucide app-window — KN0dX */
    return (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect width="20" height="16" x="2" y="4" rx="2" />
            <path d="M2 10h20M6 7v.01M9 7v.01M12 7v.01" />
        </svg>
    );
}
