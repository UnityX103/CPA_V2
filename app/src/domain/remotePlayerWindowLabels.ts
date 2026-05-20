export const REMOTE_PLAYER_WINDOW_LABELS = [
    'remote-player-0',
    'remote-player-1',
    'remote-player-2',
    'remote-player-3',
    'remote-player-4',
    'remote-player-5',
    'remote-player-6',
] as const;

export type RemotePlayerWindowLabel = typeof REMOTE_PLAYER_WINDOW_LABELS[number];
