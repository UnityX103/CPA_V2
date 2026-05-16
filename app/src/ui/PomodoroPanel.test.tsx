import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
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

class FakeResizeObserver {
    constructor(_cb: ResizeObserverCallback) {}
    observe() {}
    disconnect() {}
}

class FakeMutationObserver {
    constructor(_cb: MutationCallback) {}
    observe() {}
    disconnect() {}
}

beforeEach(() => {
    startDragging.mockReset();
    invokeMock.mockReset();
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    vi.stubGlobal('MutationObserver', FakeMutationObserver);
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    usePomodoroStore.setState({
        focusDurationSeconds: 25 * 60,
        breakDurationSeconds: 5 * 60,
        remainingSeconds: 25 * 60,
        currentPhase: 'focus',
        currentRound: 1,
        totalRounds: 4,
        isRunning: false,
        isPinned: false,
        consecutiveCompletedFocus: 0,
    });
    cleanup();
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
