import { describe, expect, it, beforeEach, vi } from 'vitest';
import { openPomodoroVideoWindow } from './pomodoroVideoWindow';

const { constructorMock, getByLabelMock, onceMock } = vi.hoisted(() => ({
    constructorMock: vi.fn(),
    getByLabelMock: vi.fn(),
    onceMock: vi.fn(() => Promise.resolve(() => {})),
}));

const { invokeMock } = vi.hoisted(() => ({
    invokeMock: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({
    invoke: invokeMock,
}));

vi.mock('@tauri-apps/api/webviewWindow', () => ({
    WebviewWindow: class {
        static getByLabel = getByLabelMock;
        once = onceMock;

        constructor(label: string, options: unknown) {
            constructorMock(label, options);
        }
    },
}));

describe('pomodoro video player window', () => {
    beforeEach(() => {
        constructorMock.mockReset();
        getByLabelMock.mockReset();
        getByLabelMock.mockResolvedValue(null);
        onceMock.mockReset();
        onceMock.mockResolvedValue(() => {});
        invokeMock.mockReset();
        invokeMock.mockResolvedValue({
            x: -1920,
            y: 0,
            width: 1920,
            height: 1080,
        });
    });

    it('creates a transparent borderless player window that covers the focused app screen', async () => {
        await openPomodoroVideoWindow({
            kind: 'video',
            title: '千千',
            src: '/videos/ms1.webm',
        });

        expect(getByLabelMock).toHaveBeenCalledWith('pomodoro-video-player');
        expect(invokeMock).toHaveBeenCalledWith('pomodoro_video_screen_rect');
        expect(constructorMock).toHaveBeenCalledWith('pomodoro-video-player', expect.objectContaining({
            url: 'index.html?window=video-player&src=%2Fvideos%2Fms1.webm&title=%E5%8D%83%E5%8D%83',
            title: '千千',
            x: -1920,
            y: 0,
            width: 1920,
            height: 1080,
            fullscreen: false,
            transparent: true,
            decorations: false,
            alwaysOnTop: true,
            resizable: false,
            shadow: false,
            skipTaskbar: true,
            focus: true,
            backgroundColor: [0, 0, 0, 0],
            dragDropEnabled: false,
        }));
    });

    it('closes an existing player window before opening the next one', async () => {
        const closeMock = vi.fn().mockResolvedValue(undefined);
        getByLabelMock.mockResolvedValue({ close: closeMock });

        await openPomodoroVideoWindow({
            kind: 'video',
            title: '下一段',
            src: 'asset://localhost/Users/xpy/movie.webm',
        });

        expect(closeMock).toHaveBeenCalledOnce();
        expect(constructorMock).toHaveBeenCalledOnce();
    });
});
