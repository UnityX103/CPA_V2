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

    it('does not ring when presence automation ends a break early', async () => {
        render(<PomodoroEndActionLayer />);

        await act(async () => {
            usePomodoroStore.setState({
                lastEndEvent: endEvent({
                    fromPhase: 'break',
                    toPhase: 'focus',
                    triggeredBy: 'presence',
                }),
            });
        });

        expect(await screen.findByText('休息结束')).toBeTruthy();
        expect(playPomodoroEndSound).not.toHaveBeenCalled();
    });
});
