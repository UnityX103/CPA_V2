import { useEffect } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useBridgeClient } from './domain/bridge/client';
import { useNetworkStore } from './domain/network';
import { saveRemotePlayerCardPosition } from './domain/remotePlayerCardPositions';
import { PlayerCard } from './ui/PlayerCard';
import './styles/global.css';

function routePlayerId(): string {
    return new URLSearchParams(window.location.search).get('playerId') ?? '';
}

export default function RemotePlayerCardApp() {
    useBridgeClient();
    const playerId = routePlayerId();
    const player = useNetworkStore((s) => s.players[playerId]);

    useEffect(() => {
        if (!playerId) return;

        let cancelled = false;
        let unlisten = () => {};
        const currentWindow = getCurrentWindow();

        currentWindow.onMoved(async () => {
            if (cancelled) return;

            const position = await currentWindow.outerPosition();
            if (cancelled) return;

            await saveRemotePlayerCardPosition(playerId, { x: position.x, y: position.y });
        })
            .then((cleanup) => {
                if (cancelled) {
                    cleanup();
                    return;
                }
                unlisten = cleanup;
            })
            .catch((error) => {
                console.warn('[remote-player] onMoved failed', error);
            });

        return () => {
            cancelled = true;
            unlisten();
        };
    }, [playerId]);

    if (!player) return null;

    return (
        <main className="remote-player-card-root" aria-label="远端玩家卡牌">
            <PlayerCard player={player} />
        </main>
    );
}
