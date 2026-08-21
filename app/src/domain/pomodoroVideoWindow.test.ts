import { beforeEach, describe, expect, it, vi } from 'vitest';
import { openPomodoroVideoWindow } from './pomodoroVideoWindow';

const mocks = vi.hoisted(() => ({
    constructor: vi.fn(),
    getByLabel: vi.fn(),
    invoke: vi.fn(),
    once: vi.fn(() => Promise.resolve(() => {})),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
vi.mock('@tauri-apps/api/webviewWindow', () => ({
    WebviewWindow: class {
        static getByLabel = mocks.getByLabel;
        once = mocks.once;

        constructor(label: string, options: unknown) {
            mocks.constructor(label, options);
        }
    },
}));

describe('pomodoro video player window', () => {
    beforeEach(() => {
        Object.values(mocks).forEach((mock) => mock.mockReset());
        mocks.getByLabel.mockResolvedValue(null);
        mocks.once.mockResolvedValue(() => {});
        mocks.invoke.mockResolvedValue({ x: -1920, y: 0, width: 1920, height: 1080 });
    });

    it('creates a transparent topmost player on the focused app screen', async () => {
        await openPomodoroVideoWindow({
            kind: 'video',
            title: '千千',
            src: '/videos/ms1-alpha.mov',
        });

        expect(mocks.invoke).toHaveBeenCalledWith('pomodoro_video_screen_rect');
        expect(mocks.constructor).toHaveBeenCalledWith(
            'pomodoro-video-player',
            expect.objectContaining({
                url: 'index.html?window=video-player&src=%2Fvideos%2Fms1-alpha.mov&title=%E5%8D%83%E5%8D%83',
                x: -1920,
                y: 0,
                width: 1920,
                height: 1080,
                transparent: true,
                decorations: false,
                alwaysOnTop: true,
                skipTaskbar: true,
            }),
        );
    });

    it('closes an existing player before opening the next video', async () => {
        const close = vi.fn().mockResolvedValue(undefined);
        mocks.getByLabel.mockResolvedValue({ close });

        await openPomodoroVideoWindow({
            kind: 'video',
            title: '下一段',
            src: 'asset://localhost/focus-end.mov',
        });

        expect(close).toHaveBeenCalledOnce();
        expect(mocks.constructor).toHaveBeenCalledOnce();
    });
});
