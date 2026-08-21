import { useEffect } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import './VideoPlayerApp.css';

function closePlayerWindow(): void {
    void getCurrentWindow().close().catch(() => {});
}

export default function VideoPlayerApp() {
    const params = new URLSearchParams(window.location.search);
    const src = params.get('src') ?? '';
    const title = params.get('title') ?? '视频';

    useEffect(() => {
        const closeOnEscape = (event: KeyboardEvent) => {
            if (event.key === 'Escape') closePlayerWindow();
        };

        window.addEventListener('keydown', closeOnEscape);
        return () => window.removeEventListener('keydown', closeOnEscape);
    }, []);

    return (
        <main className="video-player-root" aria-label="透明视频播放器">
            <video
                className="video-player-media"
                src={src}
                aria-label={`播放 ${title}`}
                autoPlay
                playsInline
                onEnded={closePlayerWindow}
                onError={closePlayerWindow}
            />
        </main>
    );
}
