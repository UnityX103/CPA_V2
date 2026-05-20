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

describe('PlayerCard Pencil hierarchy and remote key counter', () => {
    it('places the pin button inside the content stack so epxz9 is relative to D3ZIc', () => {
        const { container } = render(<PlayerCard player={player(state())} />);
        const content = container.querySelector('.pc-content');
        const pin = screen.getByRole('button', { name: '固定远端玩家卡牌' });

        expect(content).toBeTruthy();
        expect(content?.contains(pin)).toBe(true);
        expect(pin.parentElement).toBe(content);
    });

    it('renders oCExj key counter pill when the remote player broadcasts a synced key', () => {
        const { container } = render(<PlayerCard player={player(state({
            bindingKey: { keyLabel: 'Space', pressCount: 7 },
        }))} />);

        const timeRow = container.querySelector('.pc-time-row');
        expect(timeRow).toBeTruthy();
        expect(screen.getByText('Space')).toBeTruthy();
        expect(screen.getByText('7')).toBeTruthy();
    });

    it('hides oCExj key counter pill when bindingKey is null or has an empty label', () => {
        const { container, rerender } = render(<PlayerCard player={player(state({
            bindingKey: null,
        }))} />);

        expect(container.querySelector('.pc-time-row')).toBeNull();

        rerender(<PlayerCard player={player(state({
            bindingKey: { keyLabel: '   ', pressCount: 3 },
        }))} />);

        expect(container.querySelector('.pc-time-row')).toBeNull();
    });

    it('hides oCExj key counter pill when a malformed remote key label is null', () => {
        const malformedBinding = {
            keyLabel: null,
            pressCount: 3,
        } as unknown as RemoteState['bindingKey'];

        const { container } = render(<PlayerCard player={player(state({
            bindingKey: malformedBinding,
        }))} />);

        expect(container.querySelector('.pc-time-row')).toBeNull();
        expect(screen.queryByText('3')).toBeNull();
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
