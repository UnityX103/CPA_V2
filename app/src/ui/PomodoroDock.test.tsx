import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { usePomodoroStore } from '../domain/pomodoro';
import { PomodoroPanel } from './PomodoroPanel';
const { hover, view } = vi.hoisted(() => ({ hover: vi.fn(), view: { side: 'left', expanded: true, dragging: false } }));
vi.mock('./usePomodoroDocking', () => ({ usePomodoroDocking: () => ({ ...view, hover }) }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ startDragging: vi.fn().mockResolvedValue(undefined) }) }));
beforeEach(() => {
    localStorage.clear(); hover.mockClear();
    vi.stubGlobal('requestAnimationFrame', () => 1); vi.stubGlobal('cancelAnimationFrame', vi.fn());
    usePomodoroStore.setState({ currentPhase: 'focus', currentRound: 1, totalRounds: 4, remainingSeconds: 1080, focusDurationSeconds: 1800, isRunning: true, presenceAutomationState: 'none' });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe('docked timer', () => {
    it('uses the timer store for progress, pause and resume without resetting time', () => {
        render(<PomodoroPanel />);
        expect(document.querySelector('.pomo-dock-label')?.textContent).toBe('18··00');
        expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('40');
        fireEvent.click(screen.getByRole('button', { name: '暂停' }));
        expect(screen.getByText('已暂停')).toBeTruthy();
        act(() => usePomodoroStore.getState().tick(5));
        expect(usePomodoroStore.getState().remainingSeconds).toBe(1080);
        fireEvent.click(screen.getByRole('button', { name: '恢复' }));
        expect(document.querySelector('.pomo-dock-label')?.textContent).toBe('18··00');
        expect(usePomodoroStore.getState().isRunning).toBe(true);
    });
    it('shows minutes and seconds on either side of a minute boundary', () => {
        render(<PomodoroPanel />);
        act(() => usePomodoroStore.setState({ remainingSeconds: 61 }));
        expect(document.querySelector('.pomo-dock-label')?.textContent).toBe('01··01');
        act(() => usePomodoroStore.getState().tick(2));
        expect(document.querySelector('.pomo-dock-label')?.textContent).toBe('00··59');
    });
    it('requests collapse on mouse leave even when an action had focus', () => {
        const { container } = render(<PomodoroPanel />);
        const button = screen.getByRole('button', { name: '暂停' });button.focus();
        fireEvent.pointerLeave(container.querySelector('.pomo-dock')!);
        expect(hover).toHaveBeenLastCalledWith(false);
        expect(document.activeElement).not.toBe(button);
    });
});
