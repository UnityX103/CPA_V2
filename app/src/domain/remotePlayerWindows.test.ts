import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RemotePlayer } from './network';

const { constructorMock, getByLabelMock, onceMock } = vi.hoisted(() => ({
    constructorMock: vi.fn(),
    getByLabelMock: vi.fn(),
    onceMock: vi.fn(() => Promise.resolve(() => {})),
}));

const { loadPositionsMock } = vi.hoisted(() => ({
    loadPositionsMock: vi.fn(),
}));

vi.mock('@tauri-apps/api/webviewWindow', () => ({
    WebviewWindow: class {
        static getByLabel = getByLabelMock;
        once = onceMock;

        constructor(label: string, options: unknown) {
            constructorMock(label, options);
        }
    },
}));

vi.mock('./remotePlayerCardPositions', () => ({
    loadRemotePlayerCardPositions: loadPositionsMock,
}));

function player(playerId: string, playerName = playerId): RemotePlayer {
    return {
        playerId,
        playerName,
        state: null,
    };
}

describe('remote player windows', () => {
    beforeEach(async () => {
        constructorMock.mockReset();
        getByLabelMock.mockReset();
        getByLabelMock.mockResolvedValue(null);
        onceMock.mockReset();
        onceMock.mockResolvedValue(() => {});
        loadPositionsMock.mockReset();
        loadPositionsMock.mockResolvedValue({});

        const module = await import('./remotePlayerWindows');
        module.resetRemotePlayerWindowControllerForTest();
    });

    it('exports seven fixed remote player window labels', async () => {
        const { REMOTE_PLAYER_WINDOW_LABELS } = await import('./remotePlayerWindows');

        expect(REMOTE_PLAYER_WINDOW_LABELS).toEqual([
            'remote-player-0',
            'remote-player-1',
            'remote-player-2',
            'remote-player-3',
            'remote-player-4',
            'remote-player-5',
            'remote-player-6',
        ]);
    });

    it('opens transparent always-on-top windows for non-local players in stable sorted slots', async () => {
        const { syncRemotePlayerWindows } = await import('./remotePlayerWindows');

        await syncRemotePlayerWindows({
            localPlayerId: 'local',
            players: {
                local: player('local', 'Me'),
                zed: player('zed', 'Zed'),
                ann: player('ann', 'Ann'),
            },
        });

        expect(constructorMock).toHaveBeenCalledTimes(2);
        expect(constructorMock).toHaveBeenNthCalledWith(1, 'remote-player-0', expect.objectContaining({
            url: 'index.html?window=remote-player&playerId=ann',
            width: 153,
            height: 94,
            transparent: true,
            decorations: false,
            alwaysOnTop: true,
            resizable: false,
            shadow: false,
            skipTaskbar: true,
            focus: false,
            backgroundColor: [0, 0, 0, 0],
            dragDropEnabled: false,
        }));
        expect(constructorMock).toHaveBeenNthCalledWith(2, 'remote-player-1', expect.objectContaining({
            url: 'index.html?window=remote-player&playerId=zed',
        }));
    });

    it('uses a persisted position for a player when available', async () => {
        const { syncRemotePlayerWindows } = await import('./remotePlayerWindows');
        loadPositionsMock.mockResolvedValue({
            remote: { x: 321, y: 654 },
        });

        await syncRemotePlayerWindows({
            localPlayerId: 'local',
            players: {
                local: player('local'),
                remote: player('remote'),
            },
        });

        expect(constructorMock).toHaveBeenCalledWith('remote-player-0', expect.objectContaining({
            x: 321,
            y: 654,
        }));
    });

    it('does not recreate assigned windows on later state updates', async () => {
        const { syncRemotePlayerWindows } = await import('./remotePlayerWindows');

        await syncRemotePlayerWindows({
            localPlayerId: 'local',
            players: {
                local: player('local'),
                remote: player('remote', 'Remote v1'),
            },
        });
        await syncRemotePlayerWindows({
            localPlayerId: 'local',
            players: {
                local: player('local'),
                remote: player('remote', 'Remote v2'),
            },
        });

        expect(constructorMock).toHaveBeenCalledOnce();
    });

    it('closes only the leaving player window and frees its slot', async () => {
        const { syncRemotePlayerWindows } = await import('./remotePlayerWindows');
        const closeByLabel = new Map<string, ReturnType<typeof vi.fn>>();
        getByLabelMock.mockImplementation(async (label: string) => ({
            close: closeByLabel.get(label) ?? closeByLabel.set(label, vi.fn().mockResolvedValue(undefined)).get(label),
        }));

        await syncRemotePlayerWindows({
            localPlayerId: 'local',
            players: {
                a: player('a'),
                b: player('b'),
                local: player('local'),
            },
        });
        await syncRemotePlayerWindows({
            localPlayerId: 'local',
            players: {
                b: player('b'),
                c: player('c'),
                local: player('local'),
            },
        });

        expect(closeByLabel.get('remote-player-0')).toHaveBeenCalledOnce();
        expect(closeByLabel.get('remote-player-1')?.mock.calls.length ?? 0).toBe(0);
        expect(constructorMock).toHaveBeenCalledTimes(3);
        expect(constructorMock).toHaveBeenNthCalledWith(3, 'remote-player-0', expect.objectContaining({
            url: 'index.html?window=remote-player&playerId=c',
        }));
    });
});
