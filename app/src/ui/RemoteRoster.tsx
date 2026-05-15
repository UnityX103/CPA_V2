import { useNetworkStore } from '../domain/network';
import { PlayerCard } from './PlayerCard';
import './RemoteRoster.css';

export function RemoteRoster() {
    const players = useNetworkStore((s) => s.players);
    const playerId = useNetworkStore((s) => s.playerId);
    const others = Object.values(players).filter((p) => p.playerId !== playerId);
    if (others.length === 0) return null;

    return (
        <div className="remote-roster">
            {others.map((p) => (
                <PlayerCard key={p.playerId} player={p} />
            ))}
        </div>
    );
}
