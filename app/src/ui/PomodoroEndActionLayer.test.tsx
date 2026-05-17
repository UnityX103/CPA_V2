import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePomodoroStore, type PomodoroEndEvent } from '../domain/pomodoro';
import { PomodoroEndActionLayer } from './PomodoroEndActionLayer';

const { invokeMock, resolvePomodoroEndActionMock } = vi.hoisted(() => ({
    invokeMock: vi.fn(),
    resolvePomodoroEndActionMock: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({
    invoke: invokeMock,
}));

vi.mock('../domain/pomodoroEndAction', () => ({
    resolvePomodoroEndAction: resolvePomodoroEndActionMock,
}));

vi.mock('../domain/videoFiles', () => ({
    validateCustomVideoPath: vi.fn(),
    customVideoSrc: vi.fn(),
    showCustomVideoMissingMessage: vi.fn(),
}));

type EndActionResult = { kind: 'topWindow' } | { kind: 'video'; title: string; src: string };

class FakeResizeObserver {
    constructor(_cb: ResizeObserverCallback) {}
    observe() {}
    unobserve() {}
    disconnect() {}
}
vi.stubGlobal('ResizeObserver', FakeResizeObserver);

class FakeMutationObserver {
    constructor(_cb: MutationCallback) {}
    observe() {}
    disconnect() {}
    takeRecords() { return []; }
}
vi.stubGlobal('MutationObserver', FakeMutationObserver);

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
    invokeMock.mockReset();
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

        const dialog = await screen.findByRole('dialog', { name: '番茄钟结束视频：千千' });
        expect(dialog.getAttribute('aria-modal')).toBe('true');
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

    it('processes a reused event id after the store clears the last end event', async () => {
        resolvePomodoroEndActionMock
            .mockResolvedValueOnce({ kind: 'topWindow' })
            .mockResolvedValueOnce({
                kind: 'video',
                title: '新一轮',
                src: '/videos/next.webm',
            });
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

        expect(await screen.findByLabelText('播放 新一轮')).toBeTruthy();
        expect(resolvePomodoroEndActionMock).toHaveBeenCalledTimes(2);
    });

    it('keeps the latest event UI when an older resolver resolves later', async () => {
        const first = deferred<EndActionResult>();
        const second = deferred<EndActionResult>();
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
            second.resolve({
                kind: 'video',
                title: '第二段',
                src: '/videos/second.webm',
            });
            await second.promise;
        });
        expect(await screen.findByLabelText('播放 第二段')).toBeTruthy();

        await act(async () => {
            first.resolve({ kind: 'topWindow' });
            await first.promise;
        });

        expect(screen.getByLabelText('播放 第二段').getAttribute('src')).toBe('/videos/second.webm');
        expect(screen.queryByText('专注结束')).toBeNull();
    });

    it('processes an existing last end event on mount only once', async () => {
        resolvePomodoroEndActionMock.mockResolvedValue({ kind: 'topWindow' });
        const event = endEvent(7);
        usePomodoroStore.setState({ lastEndEvent: event });

        render(<PomodoroEndActionLayer />);

        expect(await screen.findByText('专注结束')).toBeTruthy();

        await act(async () => {
            usePomodoroStore.setState({ endActionMode: 'topWindow' });
        });

        expect(resolvePomodoroEndActionMock).toHaveBeenCalledTimes(1);
    });

    it('does not render a pending resolver result after unmount', async () => {
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

        expect(screen.queryByLabelText('播放 迟到的视频')).toBeNull();
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

    it('registers the video overlay as a native hit region while visible', async () => {
        resolvePomodoroEndActionMock.mockResolvedValue({
            kind: 'video',
            title: '千千',
            src: '/videos/ms1.webm',
        });
        render(<PomodoroEndActionLayer />);

        await act(async () => {
            usePomodoroStore.setState({ lastEndEvent: endEvent(1) });
        });
        expect(await screen.findByLabelText('播放 千千')).toBeTruthy();

        const registerCall = invokeMock.mock.calls.find(([command]) => command === 'register_hit_region');
        expect(registerCall?.[1].id).toMatch(/^pomodoro-end-video-\d+$/);

        fireEvent.click(screen.getByRole('button', { name: '关闭视频' }));

        const unregisterCall = invokeMock.mock.calls.find(([command]) => command === 'unregister_hit_region');
        expect(unregisterCall?.[1]).toEqual({ id: registerCall?.[1].id });
    });

    it('closes the video overlay with Escape', async () => {
        resolvePomodoroEndActionMock.mockResolvedValue({
            kind: 'video',
            title: '千千',
            src: '/videos/ms1.webm',
        });
        render(<PomodoroEndActionLayer />);

        await act(async () => {
            usePomodoroStore.setState({ lastEndEvent: endEvent(1) });
        });
        expect(await screen.findByLabelText('播放 千千')).toBeTruthy();

        fireEvent.keyDown(window, { key: 'Escape' });

        expect(screen.queryByLabelText('播放 千千')).toBeNull();
    });

    it('closes the video overlay when playback ends', async () => {
        resolvePomodoroEndActionMock.mockResolvedValue({
            kind: 'video',
            title: '千千',
            src: '/videos/ms1.webm',
        });
        render(<PomodoroEndActionLayer />);

        await act(async () => {
            usePomodoroStore.setState({ lastEndEvent: endEvent(1) });
        });
        const video = await screen.findByLabelText('播放 千千');

        fireEvent.ended(video);

        expect(screen.queryByLabelText('播放 千千')).toBeNull();
    });

    it('closes the video overlay when the video fails to load', async () => {
        resolvePomodoroEndActionMock.mockResolvedValue({
            kind: 'video',
            title: '千千',
            src: '/videos/ms1.webm',
        });
        render(<PomodoroEndActionLayer />);

        await act(async () => {
            usePomodoroStore.setState({ lastEndEvent: endEvent(1) });
        });
        const video = await screen.findByLabelText('播放 千千');

        fireEvent.error(video);

        expect(screen.queryByLabelText('播放 千千')).toBeNull();
    });
});
