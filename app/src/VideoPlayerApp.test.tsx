import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import VideoPlayerApp from './VideoPlayerApp';

const close = vi.hoisted(() => vi.fn());

vi.mock('@tauri-apps/api/window', () => ({
    getCurrentWindow: () => ({ close }),
}));

describe('VideoPlayerApp', () => {
    beforeEach(() => {
        close.mockReset().mockResolvedValue(undefined);
        window.history.pushState(
            {},
            '',
            '/index.html?window=video-player&src=%2Fvideos%2Fms1-alpha.mov&title=%E5%8D%83%E5%8D%83',
        );
    });

    afterEach(cleanup);

    it('renders the selected focus-end video', () => {
        render(<VideoPlayerApp />);
        const video = screen.getByLabelText('播放 千千') as HTMLVideoElement;
        expect(video.getAttribute('src')).toBe('/videos/ms1-alpha.mov');
        expect(video.muted).toBe(true);
    });

    it('closes when playback ends, errors, or Escape is pressed', () => {
        render(<VideoPlayerApp />);
        const video = screen.getByLabelText('播放 千千');

        fireEvent.ended(video);
        fireEvent.error(video);
        fireEvent.keyDown(window, { key: 'Escape' });

        expect(close).toHaveBeenCalledTimes(3);
    });
});
