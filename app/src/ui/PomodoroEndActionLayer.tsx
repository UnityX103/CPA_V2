import { useEffect, useRef, useState } from 'react';
import { usePomodoroStore, type PomodoroEndEvent } from '../domain/pomodoro';
import { resolvePomodoroEndAction } from '../domain/pomodoroEndAction';
import {
    customVideoSrc,
    showCustomVideoMissingMessage,
    validateCustomVideoPath,
} from '../domain/videoFiles';
import { openPomodoroVideoWindow } from '../domain/pomodoroVideoWindow';
import './PomodoroEndActionLayer.css';

function popupTitle(event: PomodoroEndEvent): string {
    if (event.toPhase === 'completed') return '番茄钟完成';
    if (event.fromPhase === 'focus') return '专注结束';
    return '休息结束';
}

export function PomodoroEndActionLayer() {
    const [popup, setPopup] = useState<string | null>(null);
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
                    void openPomodoroVideoWindow(action).catch(() => {
                        if (
                            disposed.current ||
                            requestSeq !== latestRequestSeq.current ||
                            seenEventId.current !== event.id
                        ) {
                            return;
                        }
                        setPopup(popupTitle(event));
                    });
                    return;
                }

                const title = popupTitle(event);
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

    return (
        <>
            {popup && (
                <div className="pomo-end-popup" role="status">
                    {popup}
                </div>
            )}
        </>
    );
}
