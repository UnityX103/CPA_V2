import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import type { RemotePlayer, RemoteState } from '../domain/network';
import { PlayerCard } from './PlayerCard';

const { startDraggingMock } = vi.hoisted(() => ({
    startDraggingMock: vi.fn(),
}));

vi.mock('@tauri-apps/api/window', () => ({
    getCurrentWindow: () => ({
        startDragging: () => {
            startDraggingMock();
            return Promise.resolve();
        },
    }),
}));

function state(overrides: Partial<RemoteState> = {}): RemoteState {
    return {
        pomodoro: {
            phase: 0,
            remainingSeconds: 25 * 60,
            currentRound: 1,
            totalRounds: 4,
            isRunning: true,
        },
        activeApp: {
            name: 'Safari',
            bundleId: 'com.apple.Safari',
            windowTitle: null,
            iconDataUrl: null,
        },
        bindingKey: null,
        ...overrides,
    };
}

function player(remoteState: RemoteState | null): RemotePlayer {
    return {
        playerId: 'remote-1',
        playerName: '远端玩家',
        state: remoteState,
    };
}

beforeEach(() => {
    cleanup();
    startDraggingMock.mockReset();
});

describe('PlayerCard active app metadata', () => {
    it('prefers the trimmed active window title over the app name', () => {
        render(<PlayerCard player={player(state({
            activeApp: {
                name: 'Safari',
                bundleId: 'com.apple.Safari',
                windowTitle: '  CPA_V2 - PlayerCard.tsx  ',
                iconDataUrl: null,
            },
        }))} />);

        expect(screen.getByText('CPA_V2 - PlayerCard.tsx')).toBeTruthy();
        expect(screen.queryByText('Safari')).toBeNull();
    });

    it('falls back to the trimmed app name and then waiting text', () => {
        const { rerender } = render(<PlayerCard player={player(state({
            activeApp: {
                name: '  Finder  ',
                bundleId: 'com.apple.finder',
                windowTitle: '   ',
                iconDataUrl: null,
            },
        }))} />);

        expect(screen.getByText('Finder')).toBeTruthy();

        rerender(<PlayerCard player={player(state({ activeApp: null }))} />);
        expect(screen.getAllByText('待加入').length).toBeGreaterThan(0);
    });

    it('renders the remote active app icon data url when present', () => {
        const iconDataUrl = 'data:image/png;base64,iVBORw0KGgo=';
        render(<PlayerCard player={player(state({
            activeApp: {
                name: 'Code',
                bundleId: 'com.microsoft.VSCode',
                windowTitle: null,
                iconDataUrl,
            },
        }))} />);

        const image = document.querySelector('.pc-app-img');
        expect(image?.getAttribute('src')).toBe(iconDataUrl);
        expect(screen.queryByTestId('player-card-fallback-icon')).toBeNull();
    });

    it('renders the fallback app-window icon without icon data', () => {
        render(<PlayerCard player={player(state())} />);

        expect(screen.getByTestId('player-card-fallback-icon')).toBeTruthy();
    });
});

describe('PlayerCard native window drag', () => {
    it('starts native drag from the card background', () => {
        const { container } = render(<PlayerCard player={player(state())} />);
        const card = container.querySelector('.pc-card')!;

        fireEvent.pointerDown(card, { button: 0 });

        expect(startDraggingMock).toHaveBeenCalledTimes(1);
    });

    it('does not start native drag from the pin button', () => {
        render(<PlayerCard player={player(state())} />);
        const pin = screen.getByRole('button', { name: '固定远端玩家卡牌' });

        expect(pin.hasAttribute('data-no-window-drag')).toBe(true);
        fireEvent.pointerDown(pin, { button: 0 });

        expect(startDraggingMock).not.toHaveBeenCalled();
    });
});
