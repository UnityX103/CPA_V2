import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePomodoroStore, type PomodoroEndEvent } from '../domain/pomodoro';
import { PomodoroEndActionLayer } from './PomodoroEndActionLayer';

const { focusAppWindowMock, openPomodoroVideoWindowMock, resolvePomodoroEndActionMock } = vi.hoisted(() => ({
    focusAppWindowMock: vi.fn(),
    openPomodoroVideoWindowMock: vi.fn(),
    resolvePomodoroEndActionMock: vi.fn(),
}));

vi.mock('../domain/pomodoroEndAction', () => ({
    resolvePomodoroEndAction: resolvePomodoroEndActionMock,
}));

vi.mock('../domain/pomodoroVideoWindow', () => ({
    openPomodoroVideoWindow: openPomodoroVideoWindowMock,
}));

vi.mock('../domain/focusWindow', () => ({
    focusAppWindow: focusAppWindowMock,
}));

vi.mock('../domain/videoFiles', () => ({
    validateCustomVideoPath: vi.fn(),
    customVideoSrc: vi.fn(),
    showCustomVideoMissingMessage: vi.fn(),
}));

type EndActionResult = { kind: 'topWindow' } | { kind: 'video'; title: string; src: string };

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((res) => {
        resolve = res;
    });
    return { promise, resolve };
}

function endEvent(id: number, overrides: Partial<PomodoroEndEvent> = {}): PomodoroEndEvent {
    return {
        id,
        fromPhase: 'focus',
        toPhase: 'break',
        triggeredBy: 'timer',
        ...overrides,
    };
}

beforeEach(() => {
    focusAppWindowMock.mockReset();
    focusAppWindowMock.mockResolvedValue(undefined);
    openPomodoroVideoWindowMock.mockReset();
    openPomodoroVideoWindowMock.mockResolvedValue(undefined);
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
    vi.useRealTimers();
});

describe('PomodoroEndActionLayer', () => {
    it('shows the focus-ended top popup when resolver returns topWindow', async () => {
        resolvePomodoroEndActionMock.mockResolvedValue({ kind: 'topWindow' });
        render(<PomodoroEndActionLayer />);

        await act(async () => {
            usePomodoroStore.setState({ lastEndEvent: endEvent(1) });
        });

        expect(await screen.findByText('专注结束')).toBeTruthy();
        expect(focusAppWindowMock).toHaveBeenCalledWith('main');
        expect(openPomodoroVideoWindowMock).not.toHaveBeenCalled();
    });

    it('opens a dedicated video player window when resolver returns video', async () => {
        const action = {
            kind: 'video' as const,
            title: '千千',
            src: '/videos/ms1-alpha.mov',
        };
        resolvePomodoroEndActionMock.mockResolvedValue(action);
        render(<PomodoroEndActionLayer />);

        await act(async () => {
            usePomodoroStore.setState({ lastEndEvent: endEvent(1) });
        });

        await vi.waitFor(() => {
            expect(openPomodoroVideoWindowMock).toHaveBeenCalledWith(action);
        });
        expect(focusAppWindowMock).not.toHaveBeenCalled();
        expect(screen.queryByRole('dialog')).toBeNull();
        expect(screen.queryByLabelText('播放 千千')).toBeNull();
    });

    it('ignores manually skipped focus endings so no video or popup appears', async () => {
        resolvePomodoroEndActionMock.mockResolvedValue({
            kind: 'video',
            title: '千千',
            src: '/videos/ms1-alpha.mov',
        });
        render(<PomodoroEndActionLayer />);

        await act(async () => {
            usePomodoroStore.setState({
                lastEndEvent: endEvent(1, { triggeredBy: 'skip' }),
            });
        });

        expect(resolvePomodoroEndActionMock).not.toHaveBeenCalled();
        expect(openPomodoroVideoWindowMock).not.toHaveBeenCalled();
        expect(focusAppWindowMock).not.toHaveBeenCalled();
        expect(screen.queryByText('专注结束')).toBeNull();
    });

    it('falls back to the top popup when the video player window cannot open', async () => {
        resolvePomodoroEndActionMock.mockResolvedValue({
            kind: 'video',
            title: '千千',
            src: '/videos/ms1-alpha.mov',
        });
        openPomodoroVideoWindowMock.mockRejectedValue(new Error('window denied'));
        render(<PomodoroEndActionLayer />);

        await act(async () => {
            usePomodoroStore.setState({ lastEndEvent: endEvent(1) });
        });

        expect(await screen.findByText('专注结束')).toBeTruthy();
        expect(focusAppWindowMock).toHaveBeenCalledWith('main');
    });

    it('shows only a top popup when a break ends even if video is configured', async () => {
        resolvePomodoroEndActionMock.mockResolvedValue({
            kind: 'video',
            title: '千千',
            src: '/videos/ms1-alpha.mov',
        });
        render(<PomodoroEndActionLayer />);

        await act(async () => {
            usePomodoroStore.setState({
                lastEndEvent: endEvent(1, {
                    fromPhase: 'break',
                    toPhase: 'focus',
                }),
            });
        });

        expect(await screen.findByText('休息结束')).toBeTruthy();
        expect(focusAppWindowMock).toHaveBeenCalledWith('main');
        expect(resolvePomodoroEndActionMock).not.toHaveBeenCalled();
        expect(openPomodoroVideoWindowMock).not.toHaveBeenCalled();
    });

    it('shows only the completion popup when the final break ends', async () => {
        resolvePomodoroEndActionMock.mockResolvedValue({
            kind: 'video',
            title: '千千',
            src: '/videos/ms1-alpha.mov',
        });
        render(<PomodoroEndActionLayer />);

        await act(async () => {
            usePomodoroStore.setState({
                lastEndEvent: endEvent(1, {
                    fromPhase: 'break',
                    toPhase: 'completed',
                }),
            });
        });

        expect(await screen.findByText('番茄钟完成')).toBeTruthy();
        expect(focusAppWindowMock).toHaveBeenCalledWith('main');
        expect(resolvePomodoroEndActionMock).not.toHaveBeenCalled();
        expect(openPomodoroVideoWindowMock).not.toHaveBeenCalled();
    });

    it('does not resolve the same end event id twice', async () => {
        resolvePomodoroEndActionMock.mockResolvedValue({ kind: 'topWindow' });
        render(<PomodoroEndActionLayer />);

        const event = endEvent(1);
        await act(async () => {
            usePomodoroStore.setState({ lastEndEvent: event });
        });
        await screen.findByText('专注结束');

        await act(async () => {
            usePomodoroStore.setState({ lastEndEvent: { ...event } });
        });

        expect(resolvePomodoroEndActionMock).toHaveBeenCalledTimes(1);
    });

    it('processes a reused event id after the store clears the last end event', async () => {
        const secondAction = {
            kind: 'video' as const,
            title: '新一轮',
            src: '/videos/next.webm',
        };
        resolvePomodoroEndActionMock
            .mockResolvedValueOnce({ kind: 'topWindow' })
            .mockResolvedValueOnce(secondAction);
        render(<PomodoroEndActionLayer />);

        await act(async () => {
            usePomodoroStore.setState({ lastEndEvent: endEvent(1) });
        });
        expect(await screen.findByText('专注结束')).toBeTruthy();

        await act(async () => {
            usePomodoroStore.setState({ lastEndEvent: null });
        });
        await act(async () => {
            usePomodoroStore.setState({ lastEndEvent: endEvent(1) });
        });

        await vi.waitFor(() => {
            expect(openPomodoroVideoWindowMock).toHaveBeenCalledWith(secondAction);
        });
        expect(resolvePomodoroEndActionMock).toHaveBeenCalledTimes(2);
    });

    it('keeps the latest event UI when an older resolver resolves later', async () => {
        const first = deferred<EndActionResult>();
        const second = deferred<EndActionResult>();
        const secondAction = {
            kind: 'video' as const,
            title: '第二段',
            src: '/videos/second.webm',
        };
        resolvePomodoroEndActionMock
            .mockReturnValueOnce(first.promise)
            .mockReturnValueOnce(second.promise);
        render(<PomodoroEndActionLayer />);

        await act(async () => {
            usePomodoroStore.setState({ lastEndEvent: endEvent(1) });
        });
        await act(async () => {
            usePomodoroStore.setState({ lastEndEvent: endEvent(2) });
        });

        await act(async () => {
            second.resolve(secondAction);
            await second.promise;
        });
        await vi.waitFor(() => {
            expect(openPomodoroVideoWindowMock).toHaveBeenCalledWith(secondAction);
        });

        await act(async () => {
            first.resolve({ kind: 'topWindow' });
            await first.promise;
        });

        expect(openPomodoroVideoWindowMock).toHaveBeenCalledTimes(1);
        expect(screen.queryByText('专注结束')).toBeNull();
    });

    it('processes an existing last end event on mount only once', async () => {
        resolvePomodoroEndActionMock.mockResolvedValue({ kind: 'topWindow' });
        usePomodoroStore.setState({ lastEndEvent: endEvent(7) });

        render(<PomodoroEndActionLayer />);

        expect(await screen.findByText('专注结束')).toBeTruthy();

        await act(async () => {
            usePomodoroStore.setState({ endActionMode: 'topWindow' });
        });

        expect(resolvePomodoroEndActionMock).toHaveBeenCalledTimes(1);
    });

    it('does not open a pending resolver result after unmount', async () => {
        const pending = deferred<EndActionResult>();
        resolvePomodoroEndActionMock.mockReturnValue(pending.promise);
        const { unmount } = render(<PomodoroEndActionLayer />);

        await act(async () => {
            usePomodoroStore.setState({ lastEndEvent: endEvent(1) });
        });
        unmount();

        await act(async () => {
            pending.resolve({
                kind: 'video',
                title: '迟到的视频',
                src: '/videos/late.webm',
            });
            await pending.promise;
        });

        expect(openPomodoroVideoWindowMock).not.toHaveBeenCalled();
    });

    it('clears a pending popup timeout on unmount', async () => {
        vi.useFakeTimers();
        resolvePomodoroEndActionMock.mockResolvedValue({ kind: 'topWindow' });
        const clearTimeoutSpy = vi.spyOn(window, 'clearTimeout');
        const { unmount } = render(<PomodoroEndActionLayer />);

        await act(async () => {
            usePomodoroStore.setState({ lastEndEvent: endEvent(1) });
        });
        expect(screen.getByText('专注结束')).toBeTruthy();

        unmount();

        expect(clearTimeoutSpy).toHaveBeenCalled();
        clearTimeoutSpy.mockRestore();
    });
});
