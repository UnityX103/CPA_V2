import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react';
import { usePomodoroStore } from '../domain/pomodoro';
import { PomodoroPanel } from './PomodoroPanel';

const { startDragging, invokeMock } = vi.hoisted(() => ({
    startDragging: vi.fn(),
    invokeMock: vi.fn(),
}));

vi.mock('@tauri-apps/api/window', () => ({
    getCurrentWindow: () => ({
        startDragging: () => {
            startDragging();
            return Promise.resolve();
        },
    }),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));

function resetPomodoro() {
    usePomodoroStore.setState({
        focusDurationSeconds: 25 * 60,
        breakDurationSeconds: 5 * 60,
        remainingSeconds: 25 * 60,
        currentPhase: 'focus',
        currentRound: 1,
        totalRounds: 4,
        isRunning: false,
        isPinned: false,
        autoStartBreak: true,
        consecutiveCompletedFocus: 0,
    });
}

function pinCalls() {
    return invokeMock.mock.calls.filter(([cmd]) => cmd === 'set_main_window_pinned');
}

beforeEach(() => {
    cleanup();
    startDragging.mockReset();
    invokeMock.mockReset();
    invokeMock.mockResolvedValue(undefined);
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    resetPomodoro();
});

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

describe('PomodoroPanel drag', () => {
    it('panel empty background pointer down triggers native window drag', async () => {
        const { container } = render(<PomodoroPanel />);
        const panel = container.querySelector('.pomo-panel')!;
        await act(async () => {
            fireEvent.pointerDown(panel, { button: 0 });
        });
        expect(startDragging).toHaveBeenCalledTimes(1);
    });

    it('right-clicking panel background does NOT trigger drag', async () => {
        const { container } = render(<PomodoroPanel />);
        const panel = container.querySelector('.pomo-panel')!;
        await act(async () => {
            fireEvent.pointerDown(panel, { button: 2 });
        });
        expect(startDragging).not.toHaveBeenCalled();
    });

    it('clicking the settings button does NOT trigger drag', async () => {
        render(<PomodoroPanel />);
        const settingsButton = screen.getByRole('button', { name: '设置' });
        await act(async () => {
            fireEvent.pointerDown(settingsButton, { button: 0 });
        });
        expect(startDragging).not.toHaveBeenCalled();
    });

    it('clicking the start button does NOT trigger drag', async () => {
        render(<PomodoroPanel />);
        const startButton = screen.getByRole('button', { name: '开始' });
        await act(async () => {
            fireEvent.pointerDown(startButton, { button: 0 });
        });
        expect(startDragging).not.toHaveBeenCalled();
    });
});

describe('PomodoroPanel scale root', () => {
    it('main app content root consumes the app UI scale CSS variable', () => {
        const here = path.dirname(fileURLToPath(import.meta.url));
        const css = readFileSync(path.join(here, '../styles/global.css'), 'utf8');

        expect(css).toMatch(/\.app-scale-root\s*\{[^}]*--app-ui-scale:\s*1/);
        expect(css).toMatch(/\.app-root\s*\{[^}]*zoom:\s*var\(--app-ui-scale\)/);
    });
});

describe('PomodoroPanel HApJ0 pin behaviour', () => {
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

    it('does not invoke removed transparent region commands', async () => {
        render(<PomodoroPanel />);

        await waitFor(() => {
            expect(pinCalls()).toContainEqual(['set_main_window_pinned', { onTop: false }]);
        });

        const invokedCommands = invokeMock.mock.calls.map(([cmd]) => String(cmd));
        const removedRegionCommand = /^(?:un)?register_.*_region$|^clear_.*_regions$/;
        expect(invokedCommands).not.toEqual(
            expect.arrayContaining([expect.stringMatching(removedRegionCommand)]),
        );
    });
});
