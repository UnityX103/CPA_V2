import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePomodoroStore, type PomodoroEndEvent } from '../domain/pomodoro';
import { PomodoroEndActionLayer } from './PomodoroEndActionLayer';

const focusAppWindow = vi.hoisted(() => vi.fn());
const resolvePomodoroEndAction = vi.hoisted(() => vi.fn());
const openPomodoroVideoWindow = vi.hoisted(() => vi.fn());
const playPomodoroEndSound = vi.hoisted(() => vi.fn());

vi.mock('../domain/focusWindow', () => ({ focusAppWindow }));
vi.mock('../domain/pomodoroEndAction', () => ({ resolvePomodoroEndAction }));
vi.mock('../domain/pomodoroVideoWindow', () => ({ openPomodoroVideoWindow }));
vi.mock('../domain/pomodoroSounds', async () => ({
    ...await vi.importActual<typeof import('../domain/pomodoroSounds')>('../domain/pomodoroSounds'),
    playPomodoroEndSound,
}));
vi.mock('../domain/videoFiles', () => ({
    customVideoSrc: vi.fn(),
    showCustomVideoMissingMessage: vi.fn(),
    validateCustomVideoPath: vi.fn(),
}));

function endEvent(overrides: Partial<PomodoroEndEvent> = {}): PomodoroEndEvent {
    return {
        id: 1,
        fromPhase: 'focus',
        toPhase: 'break',
        triggeredBy: 'timer',
        ...overrides,
    };
}

beforeEach(() => {
    focusAppWindow.mockReset();
    focusAppWindow.mockResolvedValue(undefined);
    resolvePomodoroEndAction.mockReset().mockResolvedValue({ kind: 'topWindow' });
    openPomodoroVideoWindow.mockReset().mockResolvedValue(undefined);
    playPomodoroEndSound.mockReset().mockResolvedValue(true);
    usePomodoroStore.setState({
        lastEndEvent: null,
        endActionMode: 'playVideo',
        playVideoOnBreakEnd: false,
        endActionVideo: {
            sourceKind: 'builtin',
            builtinVideoId: 'qianqian',
            customVideoPath: '',
        },
        endSounds: {
            focus: { sourceKind: 'builtin', builtinSoundId: 'clear-success', customSoundPath: '' },
            break: { sourceKind: 'builtin', builtinSoundId: 'triple-ping', customSoundPath: '' },
        },
    });
});

afterEach(cleanup);

describe('PomodoroEndActionLayer', () => {
    it('brings the main window forward for timer completions', async () => {
        render(<PomodoroEndActionLayer />);

        await act(async () => {
            usePomodoroStore.setState({ lastEndEvent: endEvent() });
        });

        expect(await screen.findByText('专注结束')).toBeTruthy();
        expect(focusAppWindow).toHaveBeenCalledWith('main');
        expect(playPomodoroEndSound).toHaveBeenCalledWith(
            usePomodoroStore.getState().endSounds,
            'focus',
        );
    });

    it('opens the selected video for a naturally completed focus', async () => {
        const action = {
            kind: 'video' as const,
            title: '千千',
            src: '/videos/ms1-alpha.mov',
        };
        resolvePomodoroEndAction.mockResolvedValue(action);
        render(<PomodoroEndActionLayer />);

        await act(async () => {
            usePomodoroStore.setState({ lastEndEvent: endEvent() });
        });

        await vi.waitFor(() => {
            expect(openPomodoroVideoWindow).toHaveBeenCalledWith(action);
        });
        expect(focusAppWindow).not.toHaveBeenCalled();
        expect(screen.queryByText('专注结束')).toBeNull();
    });

    it('falls back to the top prompt when video resolution fails', async () => {
        resolvePomodoroEndAction.mockRejectedValue(new Error('native validation failed'));
        render(<PomodoroEndActionLayer />);

        await act(async () => {
            usePomodoroStore.setState({ lastEndEvent: endEvent() });
        });

        expect(await screen.findByText('专注结束')).toBeTruthy();
        expect(focusAppWindow).toHaveBeenCalledWith('main');
        expect(openPomodoroVideoWindow).not.toHaveBeenCalled();
    });

    it('plays the break-end sound when a break completes', async () => {
        render(<PomodoroEndActionLayer />);

        await act(async () => {
            usePomodoroStore.setState({
                lastEndEvent: endEvent({ fromPhase: 'break', toPhase: 'focus' }),
            });
        });

        expect(await screen.findByText('休息结束')).toBeTruthy();
        expect(resolvePomodoroEndAction).not.toHaveBeenCalled();
        expect(openPomodoroVideoWindow).not.toHaveBeenCalled();
        expect(playPomodoroEndSound).toHaveBeenCalledWith(
            usePomodoroStore.getState().endSounds,
            'break',
        );
    });

    it('ignores manual skips', async () => {
        render(<PomodoroEndActionLayer />);

        await act(async () => {
            usePomodoroStore.setState({ lastEndEvent: endEvent({ triggeredBy: 'skip' }) });
        });

        expect(screen.queryByText('专注结束')).toBeNull();
        expect(resolvePomodoroEndAction).not.toHaveBeenCalled();
        expect(openPomodoroVideoWindow).not.toHaveBeenCalled();
        expect(focusAppWindow).not.toHaveBeenCalled();
        expect(playPomodoroEndSound).not.toHaveBeenCalled();
    });

    it.each(['focus', 'completed'] as const)('opens the selected video when an enabled break ends into %s', async (toPhase) => {
        const action = { kind: 'video', title: '千千', src: '/videos/ms1-alpha.mov' };
        resolvePomodoroEndAction.mockResolvedValue(action);
        usePomodoroStore.setState({ playVideoOnBreakEnd: true });
        render(<PomodoroEndActionLayer />);

        await act(async () => {
            usePomodoroStore.setState({ lastEndEvent: endEvent({ fromPhase: 'break', toPhase }) });
        });

        expect(openPomodoroVideoWindow).toHaveBeenCalledExactlyOnceWith(action);
        expect(focusAppWindow).not.toHaveBeenCalled();
        expect(playPomodoroEndSound).toHaveBeenCalledWith(usePomodoroStore.getState().endSounds, 'break');
        await act(async () => {
            usePomodoroStore.setState({ playVideoOnBreakEnd: false });
        });
        expect(openPomodoroVideoWindow).toHaveBeenCalledTimes(1);
    });

    it('falls back to the break-end popup when video playback fails', async () => {
        usePomodoroStore.setState({ playVideoOnBreakEnd: true });
        resolvePomodoroEndAction.mockResolvedValue({ kind: 'video', title: '千千', src: '/videos/ms1-alpha.mov' });
        openPomodoroVideoWindow.mockRejectedValue(new Error('player unavailable'));
        render(<PomodoroEndActionLayer />);
        await act(async () => {
            usePomodoroStore.setState({ lastEndEvent: endEvent({ fromPhase: 'break', toPhase: 'focus' }) });
        });
        expect(screen.getByText('休息结束')).toBeTruthy();
        expect(focusAppWindow).toHaveBeenCalledWith('main');
    });

    it('keeps the top-window mode when break-end video is enabled', async () => {
        usePomodoroStore.setState({ playVideoOnBreakEnd: true, endActionMode: 'topWindow' });
        render(<PomodoroEndActionLayer />);
        await act(async () => {
            usePomodoroStore.setState({ lastEndEvent: endEvent({ fromPhase: 'break', toPhase: 'focus' }) });
        });
        expect(screen.getByText('休息结束')).toBeTruthy();
        expect(openPomodoroVideoWindow).not.toHaveBeenCalled();
    });

    it('does not play video or sound when an enabled break is manually skipped', async () => {
        usePomodoroStore.setState({ playVideoOnBreakEnd: true });
        render(<PomodoroEndActionLayer />);
        await act(async () => {
            usePomodoroStore.setState({
                lastEndEvent: endEvent({ fromPhase: 'break', toPhase: 'focus', triggeredBy: 'skip' }),
            });
        });
        expect(resolvePomodoroEndAction).not.toHaveBeenCalled();
        expect(openPomodoroVideoWindow).not.toHaveBeenCalled();
        expect(playPomodoroEndSound).not.toHaveBeenCalled();
        expect(focusAppWindow).not.toHaveBeenCalled();
    });

});
