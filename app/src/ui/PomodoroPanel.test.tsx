import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react';

const { invokeMock, startDragging } = vi.hoisted(() => ({
    invokeMock: vi.fn(),
    startDragging: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));

vi.mock('@tauri-apps/api/window', () => ({
    getCurrentWindow: () => ({
        startDragging: () => {
            startDragging();
            return Promise.resolve();
        },
    }),
}));

const { PomodoroPanel } = await import('./PomodoroPanel');
const { usePomodoroStore } = await import('../domain/pomodoro');

function resetPomodoro() {
    usePomodoroStore.setState({
        focusDurationSeconds: 25 * 60,
        breakDurationSeconds: 5 * 60,
        totalRounds: 4,
        currentRound: 1,
        remainingSeconds: 25 * 60,
        currentPhase: 'focus',
        isRunning: false,
        isPinned: false,
        autoStartBreak: true,
        consecutiveCompletedFocus: 0,
    });
}

function pinCalls() {
    return invokeMock.mock.calls.filter(([cmd]) => cmd === 'set_main_window_pinned');
}

describe('PomodoroPanel HApJ0 pin behaviour', () => {
    beforeEach(() => {
        cleanup();
        invokeMock.mockReset();
        invokeMock.mockResolvedValue(undefined);
        startDragging.mockReset();
        resetPomodoro();
        vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
            const s = this.style;
            return {
                x: parseFloat(s.left) || 0,
                y: parseFloat(s.top) || 0,
                left: parseFloat(s.left) || 0,
                top: parseFloat(s.top) || 0,
                width: parseFloat(s.width) || 0,
                height: parseFloat(s.height) || 0,
                right: (parseFloat(s.left) || 0) + (parseFloat(s.width) || 0),
                bottom: (parseFloat(s.top) || 0) + (parseFloat(s.height) || 0),
                toJSON: () => ({}),
            } as DOMRect;
        });
    });

    afterEach(() => {
        cleanup();
        vi.restoreAllMocks();
    });

    it('syncs initial unpinned state and HApJ0 toggles to the main-window pin command', async () => {
        render(<PomodoroPanel />);

        await waitFor(() => {
            expect(pinCalls()).toContainEqual(['set_main_window_pinned', { onTop: false }]);
        });

        invokeMock.mockClear();
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: '置顶' }));
        });
        await waitFor(() => {
            expect(pinCalls()).toEqual([['set_main_window_pinned', { onTop: true }]]);
        });

        invokeMock.mockClear();
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: '置顶' }));
        });
        await waitFor(() => {
            expect(pinCalls()).toEqual([['set_main_window_pinned', { onTop: false }]]);
        });
    });

    it('settings button still opens the settings window through its existing command', async () => {
        render(<PomodoroPanel />);

        invokeMock.mockClear();
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: '设置' }));
        });

        expect(invokeMock).toHaveBeenCalledWith('open_settings_window');
    });

    it('does not invoke removed transparent hit-region commands', async () => {
        render(<PomodoroPanel />);

        await waitFor(() => {
            expect(pinCalls()).toContainEqual(['set_main_window_pinned', { onTop: false }]);
        });

        const invokedCommands = invokeMock.mock.calls.map(([cmd]) => cmd);
        expect(invokedCommands).toEqual(['set_main_window_pinned']);
    });
});
