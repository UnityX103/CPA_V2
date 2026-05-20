import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RemotePlayer } from './network';
import { useNetworkStore } from './network';

const { constructorMock, getByLabelMock, onceMock } = vi.hoisted(() => ({
    constructorMock: vi.fn(),
    getByLabelMock: vi.fn(),
    onceMock: vi.fn(() => Promise.resolve(() => {})),
}));

const { loadPositionsMock } = vi.hoisted(() => ({
    loadPositionsMock: vi.fn(),
}));

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((r) => {
        resolve = r;
    });
    return { promise, resolve };
}

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
        useNetworkStore.setState({
            playerId: null,
            players: {},
        });
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it('exports seven fixed remote player window labels', async () => {
        const { REMOTE_PLAYER_WINDOW_LABELS } = await import('./remotePlayerWindowLabels');

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
            preventOverflow: true,
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

    it('loads freshly saved positions when a closed player window is reopened', async () => {
        const { syncRemotePlayerWindows } = await import('./remotePlayerWindows');
        loadPositionsMock
            .mockResolvedValueOnce({ remote: { x: 321, y: 654 } })
            .mockResolvedValueOnce({ remote: { x: 987, y: 123 } });

        await syncRemotePlayerWindows({
            localPlayerId: 'local',
            players: {
                local: player('local'),
                remote: player('remote'),
            },
        });
        await syncRemotePlayerWindows({
            localPlayerId: 'local',
            players: {
                local: player('local'),
            },
        });
        await syncRemotePlayerWindows({
            localPlayerId: 'local',
            players: {
                local: player('local'),
                remote: player('remote'),
            },
        });

        expect(loadPositionsMock).toHaveBeenCalledTimes(2);
        expect(constructorMock).toHaveBeenNthCalledWith(2, 'remote-player-0', expect.objectContaining({
            x: 987,
            y: 123,
        }));
    });

    it('lets newer state win when an older sync is still loading positions', async () => {
        const { syncRemotePlayerWindows } = await import('./remotePlayerWindows');
        const firstPositions = deferred<Record<string, never>>();
        loadPositionsMock
            .mockReturnValueOnce(firstPositions.promise)
            .mockResolvedValueOnce({});

        const firstSync = syncRemotePlayerWindows({
            localPlayerId: 'local',
            players: {
                local: player('local'),
                a: player('a'),
            },
        });
        const secondSync = syncRemotePlayerWindows({
            localPlayerId: 'local',
            players: {
                local: player('local'),
                b: player('b'),
            },
        });

        firstPositions.resolve({});
        await Promise.all([firstSync, secondSync]);

        expect(constructorMock).toHaveBeenCalledTimes(1);
        expect(constructorMock).toHaveBeenCalledWith('remote-player-0', expect.objectContaining({
            url: 'index.html?window=remote-player&playerId=b',
        }));
    });

    it('closes any existing same-label window before creating a remote player window', async () => {
        const { syncRemotePlayerWindows } = await import('./remotePlayerWindows');
        const close = vi.fn().mockResolvedValue(undefined);
        getByLabelMock.mockResolvedValue({ close });

        await syncRemotePlayerWindows({
            localPlayerId: 'local',
            players: {
                local: player('local'),
                remote: player('remote'),
            },
        });

        expect(getByLabelMock).toHaveBeenCalledWith('remote-player-0');
        expect(close).toHaveBeenCalledTimes(1);
        expect(close.mock.invocationCallOrder[0]).toBeLessThan(
            constructorMock.mock.invocationCallOrder[0],
        );
    });

    it('does not keep an assignment when creating the window fails before construction completes', async () => {
        const { syncRemotePlayerWindows } = await import('./remotePlayerWindows');
        constructorMock
            .mockImplementationOnce(() => {
                throw new Error('boom');
            })
            .mockImplementation(() => {});

        await syncRemotePlayerWindows({
            localPlayerId: 'local',
            players: {
                local: player('local'),
                remote: player('remote'),
            },
        });
        await syncRemotePlayerWindows({
            localPlayerId: 'local',
            players: {
                local: player('local'),
                remote: player('remote'),
            },
        });

        expect(constructorMock).toHaveBeenCalledTimes(2);
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
        closeByLabel.forEach((close) => close.mockClear());
        await syncRemotePlayerWindows({
            localPlayerId: 'local',
            players: {
                b: player('b'),
                c: player('c'),
                local: player('local'),
            },
        });

        expect(closeByLabel.get('remote-player-0')).toHaveBeenCalledTimes(2);
        expect(closeByLabel.get('remote-player-1')?.mock.calls.length ?? 0).toBe(0);
        expect(constructorMock).toHaveBeenCalledTimes(3);
        expect(constructorMock).toHaveBeenNthCalledWith(3, 'remote-player-0', expect.objectContaining({
            url: 'index.html?window=remote-player&playerId=c',
        }));
    });

    it('cancels a pending hook sync on unmount before it can open a window', async () => {
        const { useRemotePlayerWindowController } = await import('./remotePlayerWindows');
        const positions = deferred<Record<string, never>>();
        loadPositionsMock.mockReturnValueOnce(positions.promise);
        useNetworkStore.setState({
            playerId: 'local',
            players: {
                local: player('local'),
                remote: player('remote'),
            },
        });

        const rendered = renderHook(() => useRemotePlayerWindowController());
        await waitFor(() => expect(loadPositionsMock).toHaveBeenCalledTimes(1));

        rendered.unmount();
        positions.resolve({});
        await act(async () => {
            await positions.promise;
            await Promise.resolve();
        });

        expect(constructorMock).not.toHaveBeenCalled();
    });
});
