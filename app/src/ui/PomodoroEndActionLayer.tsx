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
    const latestRequestSeq = useRef(0);
    const disposed = useRef(false);
    const popupTimeout = useRef<number | null>(null);

    useEffect(() => {
        disposed.current = false;

        const clearPopupTimeout = () => {
            if (popupTimeout.current === null) return;
            window.clearTimeout(popupTimeout.current);
            popupTimeout.current = null;
        };

        const processEndEvent = (state: ReturnType<typeof usePomodoroStore.getState>) => {
            const event = state.lastEndEvent;
            if (!event) {
                seenEventId.current = null;
                return;
            }
            if (event.id === seenEventId.current) return;
            seenEventId.current = event.id;
            const requestSeq = latestRequestSeq.current + 1;
            latestRequestSeq.current = requestSeq;

            void resolvePomodoroEndAction(state, {
                validateCustomVideoPath,
                customVideoSrc,
                showCustomVideoMissingMessage,
            }).then((action) => {
                if (
                    disposed.current ||
                    requestSeq !== latestRequestSeq.current ||
                    seenEventId.current !== event.id
                ) {
                    return;
                }

                clearPopupTimeout();
                if (action.kind === 'video') {
                    setPopup(null);
                    setVideo({ title: action.title, src: action.src });
                    return;
                }

                const title = popupTitle(event);
                setVideo(null);
                setPopup(title);
                popupTimeout.current = window.setTimeout(() => {
                    if (disposed.current || requestSeq !== latestRequestSeq.current) return;
                    setPopup((current) => current === title ? null : current);
                    popupTimeout.current = null;
                }, 4000);
            });
        };

        const unsubscribe = usePomodoroStore.subscribe(processEndEvent);
        processEndEvent(usePomodoroStore.getState());

        return () => {
            disposed.current = true;
            unsubscribe();
            clearPopupTimeout();
        };
    }, []);

    useEffect(() => {
        const closeOnEscape = (event: KeyboardEvent) => {
            if (event.key === 'Escape') setVideo(null);
        };

        window.addEventListener('keydown', closeOnEscape);
        return () => window.removeEventListener('keydown', closeOnEscape);
    }, []);

    return (
        <>
            {popup && (
                <div className="pomo-end-popup" role="status">
                    {popup}
                </div>
            )}
            {video && (
                <div
                    className="pomo-video-backdrop"
                    role="dialog"
                    aria-modal="true"
                    aria-label={`番茄钟结束视频：${video.title}`}
                >
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
                        onError={() => setVideo(null)}
                    />
                </div>
            )}
        </>
    );
}
