import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { usePomodoroStore } from '../domain/pomodoro';
import { PomodoroPanel } from './PomodoroPanel';
const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn().mockResolvedValue(() => {}) }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ startDragging: vi.fn().mockResolvedValue(undefined) }) }));
function mockDock(side: 'left' | 'right') {
    invoke.mockImplementation(async (command, args) => command === 'configure_pomodoro_docking'
        ? { side: args.paused ? null : side, expanded: !args.paused, dragging: false } : undefined);
}
beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('pomo-auto-dock', 'true');
    invoke.mockReset();
    mockDock('left');
    vi.stubGlobal('__TAURI_INTERNALS__', {});
    vi.stubGlobal('requestAnimationFrame', () => 1); vi.stubGlobal('cancelAnimationFrame', vi.fn());
    usePomodoroStore.setState({ currentPhase: 'focus', currentRound: 1, totalRounds: 4, remainingSeconds: 1080, focusDurationSeconds: 1800, isRunning: true, presenceAutomationState: 'none' });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe('docked timer', () => {
    it.each(['left', 'right'] as const)('expands the full panel when paused from the %s dock and resumes without resetting time', async (side) => {
        mockDock(side);
        const { container } = render(<PomodoroPanel />);
        await waitFor(() => expect(container.querySelector('.pomo-dock')?.getAttribute('data-side')).toBe(side));
        expect(document.querySelector('.pomo-dock-label')?.textContent).toBe('18··00');
        expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('40');
        fireEvent.click(screen.getByRole('button', { name: '暂停' }));
        expect(screen.getByRole('region', { name: '番茄钟已暂停' })).toBeTruthy();
        expect(container.querySelector('.pomo-dock')).toBeNull();
        await waitFor(() => expect(invoke).toHaveBeenCalledWith('configure_pomodoro_docking', expect.objectContaining({ autoDock: true, paused: true })));
        act(() => usePomodoroStore.getState().tick(5));
        expect(usePomodoroStore.getState().remainingSeconds).toBe(1080);
        expect(container.querySelector('.pomo-dock')).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: '恢复' }));
        await waitFor(() => expect(container.querySelector('.pomo-dock')?.getAttribute('data-side')).toBe(side));
        expect(document.querySelector('.pomo-dock-label')?.textContent).toBe('18··00');
        expect(usePomodoroStore.getState().isRunning).toBe(true);
    });
    it('shows minutes and seconds on either side of a minute boundary', async () => {
        render(<PomodoroPanel />);
        await waitFor(() => expect(document.querySelector('.pomo-dock-label')).toBeTruthy());
        act(() => usePomodoroStore.setState({ remainingSeconds: 61 }));
        expect(document.querySelector('.pomo-dock-label')?.textContent).toBe('01··01');
        act(() => usePomodoroStore.getState().tick(2));
        expect(document.querySelector('.pomo-dock-label')?.textContent).toBe('00··59');
    });
    it('requests collapse on mouse leave even when an action had focus', async () => {
        const { container } = render(<PomodoroPanel />);
        await waitFor(() => expect(container.querySelector('.pomo-dock')).toBeTruthy());
        const button = screen.getByRole('button', { name: '暂停' });
        button.focus();
        fireEvent.pointerLeave(container.querySelector('.pomo-dock')!);
        await waitFor(() => expect(invoke).toHaveBeenCalledWith('hover_pomodoro_docking', { hovered: false }));
        expect(document.activeElement).not.toBe(button);
    });
});
