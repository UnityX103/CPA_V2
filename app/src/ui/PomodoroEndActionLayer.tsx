import { useEffect, useRef, useState } from 'react';
import { usePomodoroStore, type PomodoroEndEvent } from '../domain/pomodoro';
import { resolvePomodoroEndAction } from '../domain/pomodoroEndAction';
import { focusAppWindow } from '../domain/focusWindow';
import {
    customVideoSrc,
    showCustomVideoMissingMessage,
    validateCustomVideoPath,
} from '../domain/videoFiles';
import { openPomodoroVideoWindow } from '../domain/pomodoroVideoWindow';
import { playPomodoroEndSound } from '../domain/pomodoroSounds';
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

            if (event.triggeredBy === 'skip') {
                setPopup(null);
                clearPopupTimeout();
                return;
            }

            if (
                event.triggeredBy === 'timer'
                && (event.fromPhase === 'focus' || event.fromPhase === 'break')
            ) {
                void playPomodoroEndSound(state.endSounds, event.fromPhase).catch((error) => {
                    console.warn('[pomodoro-end] failed to play end sound', error);
                });
            }

            const showTopPopup = () => {
                clearPopupTimeout();
                const title = popupTitle(event);
                setPopup(title);
                void focusAppWindow('main').catch((error) => {
                    console.warn('[pomodoro-end] focus main window failed', error);
                });
                popupTimeout.current = window.setTimeout(() => {
                    if (disposed.current || requestSeq !== latestRequestSeq.current) return;
                    setPopup((current) => current === title ? null : current);
                    popupTimeout.current = null;
                }, 4000);
            };

            if (event.fromPhase !== 'focus') {
                showTopPopup();
                return;
            }

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
                        showTopPopup();
                    });
                    return;
                }

                showTopPopup();
            }).catch((error) => {
                if (
                    disposed.current ||
                    requestSeq !== latestRequestSeq.current ||
                    seenEventId.current !== event.id
                ) {
                    return;
                }
                console.warn('[pomodoro-end] failed to resolve end action', error);
                showTopPopup();
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
