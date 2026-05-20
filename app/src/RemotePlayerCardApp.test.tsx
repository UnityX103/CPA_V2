import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useNetworkStore } from './domain/network';

const {
    onMovedMock,
    savePositionMock,
    useBridgeClientMock,
} = vi.hoisted(() => ({
    onMovedMock: vi.fn(),
    savePositionMock: vi.fn(),
    useBridgeClientMock: vi.fn(),
}));

vi.mock('@tauri-apps/api/window', () => ({
    getCurrentWindow: () => ({
        onMoved: onMovedMock,
        outerPosition: () => Promise.resolve({
            x: 24,
            y: 68,
            toLogical: (scaleFactor: number) => ({ x: 24 / scaleFactor, y: 68 / scaleFactor }),
        }),
        scaleFactor: () => Promise.resolve(2),
    }),
}));

vi.mock('./domain/bridge/client', () => ({
    useBridgeClient: useBridgeClientMock,
}));

vi.mock('./domain/remotePlayerCardPositions', () => ({
    saveRemotePlayerCardPosition: savePositionMock,
}));

beforeEach(() => {
    window.history.pushState({}, '', '/?window=remote-player&playerId=p2');
    onMovedMock.mockReset();
    onMovedMock.mockImplementation((handler: () => void) => {
        handler();
        return Promise.resolve(() => {});
    });
    savePositionMock.mockReset();
    savePositionMock.mockResolvedValue(undefined);
    useBridgeClientMock.mockReset();
    useNetworkStore.setState({
        players: {
            p1: {
                playerId: 'p1',
                playerName: '本地玩家',
                state: null,
            },
            p2: {
                playerId: 'p2',
                playerName: '远端玩家',
                state: {
                    pomodoro: {
                        phase: 0,
                        remainingSeconds: 1200,
                        currentRound: 1,
                        totalRounds: 4,
                        isRunning: true,
                    },
                    activeApp: {
                        name: 'Rider',
                        bundleId: 'com.jetbrains.rider',
                        windowTitle: 'Plan.md',
                    },
                    bindingKey: null,
                },
            },
        },
    });
});

afterEach(() => {
    cleanup();
});

describe('RemotePlayerCardApp', () => {
    it('renders the player selected by route playerId', async () => {
        const { default: RemotePlayerCardApp } = await import('./RemotePlayerCardApp');

        render(<RemotePlayerCardApp />);

        expect(useBridgeClientMock).toHaveBeenCalledTimes(1);
        expect(screen.getByText('远端玩家')).toBeInTheDocument();
        expect(screen.getByText('Plan.md')).toBeInTheDocument();
        expect(screen.queryByText('本地玩家')).toBeNull();
    });

    it('saves logical card window position on move', async () => {
        const { default: RemotePlayerCardApp } = await import('./RemotePlayerCardApp');

        render(<RemotePlayerCardApp />);

        await waitFor(() => {
            expect(savePositionMock).toHaveBeenCalledWith('p2', { x: 12, y: 34 });
        });
    });
});
