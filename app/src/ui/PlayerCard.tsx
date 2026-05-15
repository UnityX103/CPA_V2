import type { RemotePlayer, RemoteState } from '../domain/network';
import { formatMmSs } from '../domain/pomodoro';
import './PlayerCard.css';

interface PlayerCardProps {
    player: RemotePlayer;
}

const PHASE_BADGE: Record<number, { label: string; color: string }> = {
    0: { label: '专注中', color: '#D15F3D' },
    1: { label: '休息中', color: '#34A853' },
    2: { label: '已完成', color: '#6366F1' },
};

function deriveBadge(state: RemoteState | null): { label: string; color: string } {
    if (!state) return { label: '待加入', color: '#B5A49A' };
    if (!state.pomodoro.isRunning) {
        if (state.pomodoro.phase === 2) return PHASE_BADGE[2];
        return { label: '已暂停', color: '#E08C10' };
    }
    return PHASE_BADGE[state.pomodoro.phase] ?? { label: '未开始', color: '#B5A49A' };
}

export function PlayerCard({ player }: PlayerCardProps) {
    const badge = deriveBadge(player.state);
    const remaining = player.state?.pomodoro.remainingSeconds ?? 0;
    const appName = player.state?.activeApp?.name ?? '待加入';
    const binding = player.state?.bindingKey ?? null;

    return (
        <div className="pc-card">
            <div className="pc-content">
                <div className="pc-row pc-row-head">
                    <span className="pc-name">{player.playerName || '远端玩家'}</span>
                    {binding && (
                        <span className="pc-pill" title={`${binding.keyLabel} × ${binding.pressCount}`}>
                            {binding.keyLabel}
                            <span className="pc-pill-count">{binding.pressCount}</span>
                        </span>
                    )}
                </div>
                <div className="pc-row">
                    <span className="pc-badge" style={{ backgroundColor: badge.color }}>
                        {badge.label}
                    </span>
                    <span className="pc-time">{formatMmSs(remaining)}</span>
                </div>
                <div className="pc-row pc-row-app">
                    <span className="pc-app-name">{appName}</span>
                </div>
            </div>
        </div>
    );
}
