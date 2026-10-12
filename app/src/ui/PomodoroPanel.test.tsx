import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react';
import { usePomodoroStore } from '../domain/pomodoro';
import {
    applyInputActivitySample,
    usePresenceStore,
} from '../domain/presence';
import { PomodoroPanel } from './PomodoroPanel';
import { hasFullWindowNotice } from './useDockNoticeSuspension';

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
        presenceAutomationState: 'none',
        lastEndEvent: null,
    });
}

function resetPresence() {
    usePresenceStore.setState({
        inputActivityEnabled: false,
        inputActivityAvailability: 'disabled',
        confirmedPresence: 'unknown',
        lastSuccessfulAt: null,
    });
}

function pinCalls() {
    return invokeMock.mock.calls.filter(([cmd]) => cmd === 'set_main_window_pinned');
}

beforeEach(() => {
    cleanup();
    localStorage.clear();
    startDragging.mockReset();
    invokeMock.mockReset();
    invokeMock.mockResolvedValue(undefined);
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    resetPomodoro();
    resetPresence();
});

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

describe('PomodoroPanel drag', () => {
    it.each([true, false])('drags the complete rest content while running=%s, including the clock ring', async (isRunning) => {
        usePomodoroStore.setState({ currentPhase: 'break', isRunning, remainingSeconds: 300,
            presenceAutomationState: isRunning ? 'none' : 'breakPaused' });
        usePresenceStore.setState({ inputActivityEnabled: true, inputActivityAvailability: 'ready' });
        const { container } = render(<PomodoroPanel />);
        const selectors = ['.pomo-rest-title', '.pomo-clock-time', '.pomo-clock-sub',
            '.pomo-clock > svg', '.pomo-clock circle', '.pomo-rest-note', '.pomo-rest-content'];
        for (const selector of selectors) {
            await act(async () => { fireEvent.pointerDown(container.querySelector(selector)!, { button: 0 }); });
        }
        expect(startDragging).toHaveBeenCalledTimes(selectors.length);
        expect(usePomodoroStore.getState().currentPhase).toBe('break');
    });

    it('keeps rest actions clickable and excludes button artwork from window dragging', async () => {
        usePomodoroStore.setState({ currentPhase: 'break', isRunning: false, remainingSeconds: 300 });
        render(<PomodoroPanel />);
        const skip = screen.getByRole('button', { name: '跳过休息' });
        const start = screen.getByRole('button', { name: '开始休息' });
        const settings = screen.getByRole('button', { name: '设置' });
        await act(async () => {
            fireEvent.pointerDown(skip, { button: 0 });
            fireEvent.pointerDown(start, { button: 0 });
            fireEvent.pointerDown(settings.querySelector('svg')!, { button: 0 });
        });
        expect(startDragging).not.toHaveBeenCalled();
        fireEvent.click(settings);
        expect(invokeMock).toHaveBeenCalledWith('open_settings_window');
        fireEvent.click(start);
        expect(usePomodoroStore.getState().isRunning).toBe(true);
        fireEvent.click(skip);
        expect(usePomodoroStore.getState().currentPhase).toBe('focus');
    });

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

describe('PomodoroPanel pause overlay', () => {
    it('shows a manual pause before any elapsed time and keeps it paused when presence is confirmed', () => {
        usePomodoroStore.getState().pause();
        usePresenceStore.setState({ inputActivityEnabled: true, inputActivityAvailability: 'ready' });
        render(<PomodoroPanel />);

        expect(screen.getByRole('region', { name: '番茄钟已暂停' })).toBeTruthy();
        act(() => applyInputActivitySample(usePresenceStore, usePomodoroStore, 0, 0));
        expect(usePomodoroStore.getState().isRunning).toBe(false);

        fireEvent.click(screen.getByRole('button', { name: '恢复' }));
        expect(usePomodoroStore.getState().isRunning).toBe(true);
        expect(screen.queryByRole('region', { name: '番茄钟已暂停' })).toBeNull();
    });

    it('replaces the waiting overlay with a running focus after presence is confirmed', () => {
        usePresenceStore.setState({ inputActivityEnabled: true, inputActivityAvailability: 'ready' });
        render(<PomodoroPanel />);
        expect(screen.getByRole('region', { name: '番茄钟待开始' })).toBeTruthy();

        act(() => applyInputActivitySample(usePresenceStore, usePomodoroStore, 0, 0));

        expect(screen.queryByRole('region', { name: '番茄钟待开始' })).toBeNull();
        expect(screen.getByRole('button', { name: '暂停' })).toBeTruthy();
        expect(usePomodoroStore.getState()).toMatchObject({ isRunning: true, remainingSeconds: 1500 });
    });

    it('starts a waiting focus from keyboard or mouse activity with camera detection disabled', () => {
        usePresenceStore.setState({ inputActivityEnabled: true });
        render(<PomodoroPanel />);
        expect(screen.getByRole('region', { name: '番茄钟待开始' })).toBeTruthy();

        act(() => applyInputActivitySample(usePresenceStore, usePomodoroStore, 0, 0));

        expect(screen.queryByRole('region', { name: '番茄钟待开始' })).toBeNull();
        expect(screen.getByRole('button', { name: '暂停' })).toBeTruthy();
        expect(usePomodoroStore.getState().isRunning).toBe(true);
        expect(invokeMock.mock.calls.some(([command]) => command === 'sample_camera_presence')).toBe(false);
        expect(screen.getByLabelText('检测到键鼠活动')).toBeTruthy();
    });

    it('pauses immediately, freezes time, and resumes from the central button', () => {
        const { container } = render(<PomodoroPanel />);
        expect(screen.queryByRole('region', { name: '番茄钟已暂停' })).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: '开始' }));
        fireEvent.click(screen.getByRole('button', { name: '暂停' }));
        expect(screen.getByRole('region', { name: '番茄钟已暂停' })).toBeTruthy();
        expect(container.querySelector('.pomo-body')?.hasAttribute('inert')).toBe(true);
        act(() => usePomodoroStore.getState().tick(10));
        expect(usePomodoroStore.getState().remainingSeconds).toBe(1500);
        fireEvent.click(screen.getByRole('button', { name: '恢复' }));
        expect(screen.queryByRole('region', { name: '番茄钟已暂停' })).toBeNull();
        act(() => usePomodoroStore.getState().tick(1));
        expect(usePomodoroStore.getState().remainingSeconds).toBe(1499);
    });

    it.each(['focus'] as const)('simplifies automatic %s pause without changing automatic recovery', (phase) => {
        usePomodoroStore.setState({ currentPhase: phase, isRunning: true, remainingSeconds: phase === 'focus' ? 1500 : 300 });
        usePresenceStore.setState({ inputActivityEnabled: true, inputActivityAvailability: 'ready', confirmedPresence: phase === 'focus' ? 'absent' : 'present', lastSuccessfulAt: 1000 });
        render(<PomodoroPanel />);
        act(() => {
            const store = usePomodoroStore.getState();
            if (phase === 'focus') store.pauseFocusFromPresence(); else store.pauseBreakFromPresence();
        });
        expect(screen.getByRole('region', { name: '番茄钟已暂停' }).textContent).toBe('已暂停恢复');
        expect(screen.queryByText(/工位后自动恢复/)).toBeNull();
        act(() => {
            const store = usePomodoroStore.getState();
            if (phase === 'focus') store.resumeFocusFromPresence(); else store.resumeBreakFromPresence();
        });
        expect(screen.queryByRole('region', { name: '番茄钟已暂停' })).toBeNull();
        expect(usePomodoroStore.getState().isRunning).toBe(true);
    });

    it('keeps settings and pin available when input sampling fails during a pause', () => {
        usePomodoroStore.setState({ isRunning: true });
        usePresenceStore.setState({ inputActivityEnabled: true, inputActivityAvailability: 'ready' });
        render(<PomodoroPanel />);
        act(() => usePomodoroStore.getState().pauseFocusFromPresence());
        act(() => usePresenceStore.setState({ inputActivityAvailability: 'error' }));
        expect(screen.getByRole('button', { name: '恢复' })).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: '设置' }));
        expect(invokeMock).toHaveBeenCalledWith('open_settings_window');
        fireEvent.click(screen.getByRole('button', { name: '置顶' }));
        expect(usePomodoroStore.getState().isPinned).toBe(true);
        expect(screen.getByRole('region', { name: '番茄钟已暂停' })).toBeTruthy();
    });
});

describe('complete rest panel', () => {
    it('starts the visible rest countdown on the first idle input poll', () => {
        usePresenceStore.setState({ inputActivityEnabled: true });
        usePomodoroStore.getState().applySettings(1, 300, 4, true, true);
        render(<PomodoroPanel />);
        act(() => {
            usePomodoroStore.getState().start();
            usePomodoroStore.getState().tick(1);
            applyInputActivitySample(usePresenceStore, usePomodoroStore, 0, 1000);
        });
        expect(screen.getByText('05:00')).toBeTruthy();
        expect(screen.getByText('休息已暂停')).toBeTruthy();
        act(() => {
            applyInputActivitySample(usePresenceStore, usePomodoroStore, 10_000, 10_000);
            usePomodoroStore.getState().tick(1);
        });
        expect(screen.getByText('04:59')).toBeTruthy();
        expect(screen.getByText('休息中')).toBeTruthy();
        expect(screen.getByRole('button', { name: '跳过休息' })).toBeTruthy();
    });

    it('keeps time and skip visible during an automatic pause, and only skip exits the break', async () => {
        localStorage.setItem('pomo-auto-dock', 'true');
        usePomodoroStore.setState({ currentPhase: 'break', isRunning: true, remainingSeconds: 300 });
        usePresenceStore.setState({ inputActivityEnabled: true, inputActivityAvailability: 'ready' });
        const { container } = render(<PomodoroPanel />);
        act(() => usePomodoroStore.getState().pauseBreakFromPresence());
        expect(container.querySelector('.pomo-dock')).toBeNull();
        expect(screen.getByText('05:00')).toBeTruthy();
        expect(screen.getByText('休息已暂停')).toBeTruthy();
        expect(screen.queryByRole('button', { name: '恢复' })).toBeNull();
        expect((screen.getByRole('button', { name: '置顶' }) as HTMLButtonElement).disabled).toBe(true);
        await waitFor(() => expect(pinCalls()).toContainEqual(['set_main_window_pinned', { onTop: true }]));
        fireEvent.pointerLeave(container.querySelector('.pomo-panel')!);
        act(() => usePomodoroStore.getState().tick(300));
        expect(screen.getByText('05:00')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: '跳过休息' }));
        expect(usePomodoroStore.getState().currentPhase).toBe('focus');
        expect(screen.queryByRole('button', { name: '跳过休息' })).toBeNull();
    });

    it.each([true, false])('offers skip for a running or manually paused break (%s)', (isRunning) => {
        usePomodoroStore.setState({ currentPhase: 'break', isRunning, remainingSeconds: 200 });
        render(<PomodoroPanel />);
        expect((screen.getByRole('button', { name: '跳过休息' }) as HTMLButtonElement).disabled).toBe(false);
        expect(screen.getByText('03:20')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: '跳过休息' }));
        expect(usePomodoroStore.getState().currentPhase).toBe('focus');
    });
});

describe('PomodoroPanel input activity status', () => {
    it.each(['present', 'absent'] as const)('keeps the %s indicator from suspending docking', async (confirmedPresence) => {
        localStorage.setItem('pomo-auto-dock', 'true');
        usePresenceStore.setState({ inputActivityEnabled: true, inputActivityAvailability: 'ready',
            confirmedPresence, lastSuccessfulAt: 1000 });
        const { container } = render(<div className="app-scale-root"><PomodoroPanel /></div>);
        await act(async () => {});
        expect(screen.getByRole('status')).toBeTruthy();
        expect(hasFullWindowNotice(container.querySelector('.app-scale-root')!)).toBe(false);
    });
    it('updates the status and resumes rest after five idle seconds', () => {
        usePresenceStore.setState({ inputActivityEnabled: true });
        usePomodoroStore.setState({ currentPhase: 'break', isRunning: true, remainingSeconds: 300 });
        render(<PomodoroPanel />);
        act(() => applyInputActivitySample(usePresenceStore, usePomodoroStore, 0, 1000));
        expect(screen.getByRole('status', { name: '检测到键鼠活动' })).toBeTruthy();
        act(() => applyInputActivitySample(usePresenceStore, usePomodoroStore, 5000, 6000));
        expect(screen.getByRole('status', { name: '键鼠已闲置' })).toBeTruthy();
        expect(usePomodoroStore.getState().isRunning).toBe(true);
    });
    it.each(['disabled', 'waiting', 'error'] as const)('hides past evidence when input is %s', (inputActivityAvailability) => {
        usePresenceStore.setState({ inputActivityEnabled: true, inputActivityAvailability,
            confirmedPresence: 'present', lastSuccessfulAt: 1000 });
        render(<PomodoroPanel />);
        expect(screen.queryByRole('status')).toBeNull();
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
        expect(screen.getByRole('button', { name: '置顶' }).title).toContain('停靠；');
        invokeMock.mockClear();
        fireEvent.click(screen.getByRole('button', { name: '置顶' }));
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
