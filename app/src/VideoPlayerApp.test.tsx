import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import VideoPlayerApp from './VideoPlayerApp';

const { closeMock } = vi.hoisted(() => ({
    closeMock: vi.fn(),
}));

vi.mock('@tauri-apps/api/window', () => ({
    getCurrentWindow: () => ({
        close: closeMock,
    }),
}));

describe('VideoPlayerApp', () => {
    beforeEach(() => {
        closeMock.mockReset();
        closeMock.mockResolvedValue(undefined);
        window.history.pushState({}, '', '/index.html?window=video-player&src=%2Fvideos%2Fms1-alpha.mov&title=%E5%8D%83%E5%8D%83');
    });

    afterEach(() => {
        cleanup();
    });

    it('renders the transparent full-screen player from URL params', () => {
        render(<VideoPlayerApp />);

        const video = screen.getByLabelText('播放 千千') as HTMLVideoElement;
        expect(video.getAttribute('src')).toBe('/videos/ms1-alpha.mov');
    });

    it('closes the player window when playback ends', () => {
        render(<VideoPlayerApp />);

        fireEvent.ended(screen.getByLabelText('播放 千千'));

        expect(closeMock).toHaveBeenCalledOnce();
    });

    it('closes the player window on error or Escape', () => {
        render(<VideoPlayerApp />);

        fireEvent.error(screen.getByLabelText('播放 千千'));
        fireEvent.keyDown(window, { key: 'Escape' });

        expect(closeMock).toHaveBeenCalledTimes(2);
    });
});
