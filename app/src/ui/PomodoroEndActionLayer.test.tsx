import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePomodoroStore } from '../domain/pomodoro';
import { PomodoroEndActionLayer } from './PomodoroEndActionLayer';

const { resolvePomodoroEndActionMock } = vi.hoisted(() => ({
    resolvePomodoroEndActionMock: vi.fn(),
}));

vi.mock('../domain/pomodoroEndAction', () => ({
    resolvePomodoroEndAction: resolvePomodoroEndActionMock,
}));

vi.mock('../domain/videoFiles', () => ({
    validateCustomVideoPath: vi.fn(),
    customVideoSrc: vi.fn(),
    showCustomVideoMissingMessage: vi.fn(),
}));

beforeEach(() => {
    resolvePomodoroEndActionMock.mockReset();
    usePomodoroStore.setState({
        lastEndEvent: null,
        endActionMode: 'playVideo',
        endActionVideo: {
            sourceKind: 'builtin',
            builtinVideoId: 'qianqian',
            customVideoPath: '',
        },
    });
});

afterEach(() => {
    cleanup();
});

describe('PomodoroEndActionLayer', () => {
    it('shows the focus-ended top popup when resolver returns topWindow', async () => {
        resolvePomodoroEndActionMock.mockResolvedValue({ kind: 'topWindow' });
        render(<PomodoroEndActionLayer />);

        await act(async () => {
            usePomodoroStore.setState({
                lastEndEvent: {
                    id: 1,
                    fromPhase: 'focus',
                    toPhase: 'break',
                    triggeredBy: 'timer',
                },
            });
        });

        expect(await screen.findByText('专注结束')).toBeTruthy();
    });

    it('shows a video overlay when resolver returns video', async () => {
        resolvePomodoroEndActionMock.mockResolvedValue({
            kind: 'video',
            title: '千千',
            src: '/videos/ms1.webm',
        });
        render(<PomodoroEndActionLayer />);

        await act(async () => {
            usePomodoroStore.setState({
                lastEndEvent: {
                    id: 1,
                    fromPhase: 'focus',
                    toPhase: 'break',
                    triggeredBy: 'timer',
                },
            });
        });

        expect(await screen.findByRole('dialog')).toBeTruthy();
        const video = screen.getByLabelText('播放 千千') as HTMLVideoElement;
        expect(video.getAttribute('src')).toBe('/videos/ms1.webm');
    });

    it('does not resolve the same end event id twice', async () => {
        resolvePomodoroEndActionMock.mockResolvedValue({ kind: 'topWindow' });
        render(<PomodoroEndActionLayer />);

        const event = {
            id: 1,
            fromPhase: 'focus' as const,
            toPhase: 'break' as const,
            triggeredBy: 'timer' as const,
        };
        await act(async () => {
            usePomodoroStore.setState({ lastEndEvent: event });
        });
        await screen.findByText('专注结束');

        await act(async () => {
            usePomodoroStore.setState({ lastEndEvent: { ...event } });
        });

        expect(resolvePomodoroEndActionMock).toHaveBeenCalledTimes(1);
    });

    it('closes the video overlay from the close button', async () => {
        resolvePomodoroEndActionMock.mockResolvedValue({
            kind: 'video',
            title: '千千',
            src: '/videos/ms1.webm',
        });
        render(<PomodoroEndActionLayer />);

        await act(async () => {
            usePomodoroStore.setState({
                lastEndEvent: {
                    id: 1,
                    fromPhase: 'break',
                    toPhase: 'completed',
                    triggeredBy: 'timer',
                },
            });
        });
        expect(await screen.findByLabelText('播放 千千')).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: '关闭视频' }));

        expect(screen.queryByLabelText('播放 千千')).toBeNull();
    });
});
