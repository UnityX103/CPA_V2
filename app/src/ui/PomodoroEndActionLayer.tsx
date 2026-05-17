import { useEffect, useRef, useState } from 'react';
import { usePomodoroStore, type PomodoroEndEvent } from '../domain/pomodoro';
import { resolvePomodoroEndAction } from '../domain/pomodoroEndAction';
import {
    customVideoSrc,
    showCustomVideoMissingMessage,
    validateCustomVideoPath,
} from '../domain/videoFiles';
import './PomodoroEndActionLayer.css';

interface VideoOverlayState {
    title: string;
    src: string;
}

function popupTitle(event: PomodoroEndEvent): string {
    if (event.toPhase === 'completed') return '番茄钟完成';
    if (event.fromPhase === 'focus') return '专注结束';
    return '休息结束';
}

export function PomodoroEndActionLayer() {
    const [popup, setPopup] = useState<string | null>(null);
    const [video, setVideo] = useState<VideoOverlayState | null>(null);
    const seenEventId = useRef<number | null>(null);

    useEffect(() => {
        return usePomodoroStore.subscribe((state) => {
            const event = state.lastEndEvent;
            if (!event || event.id === seenEventId.current) return;
            seenEventId.current = event.id;

            void resolvePomodoroEndAction(state, {
                validateCustomVideoPath,
                customVideoSrc,
                showCustomVideoMissingMessage,
            }).then((action) => {
                if (action.kind === 'video') {
                    setPopup(null);
                    setVideo({ title: action.title, src: action.src });
                    return;
                }

                const title = popupTitle(event);
                setVideo(null);
                setPopup(title);
                window.setTimeout(() => {
                    setPopup((current) => current === title ? null : current);
                }, 4000);
            });
        });
    }, []);

    return (
        <>
            {popup && (
                <div className="pomo-end-popup" role="status">
                    {popup}
                </div>
            )}
            {video && (
                <div className="pomo-video-backdrop" role="dialog">
                    <button
                        className="pomo-video-close"
                        type="button"
                        onClick={() => setVideo(null)}
                        aria-label="关闭视频"
                    >
                        ×
                    </button>
                    <video
                        className="pomo-video-player"
                        src={video.src}
                        aria-label={`播放 ${video.title}`}
                        autoPlay
                        controls
                        onEnded={() => setVideo(null)}
                    />
                </div>
            )}
        </>
    );
}
