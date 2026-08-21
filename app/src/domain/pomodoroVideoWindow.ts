import { invoke } from '@tauri-apps/api/core';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import type { PomodoroEndActionResolution } from './pomodoroEndAction';

const VIDEO_WINDOW_LABEL = 'pomodoro-video-player';

export type PomodoroVideoWindowAction = Extract<PomodoroEndActionResolution, { kind: 'video' }>;

type VideoScreenRect = {
    x: number;
    y: number;
    width: number;
    height: number;
};

export async function openPomodoroVideoWindow(action: PomodoroVideoWindowAction): Promise<void> {
    const existing = await WebviewWindow.getByLabel(VIDEO_WINDOW_LABEL);
    await existing?.close().catch(() => {});
    const screenRect = await invoke<VideoScreenRect>('pomodoro_video_screen_rect');

    const params = new URLSearchParams({
        window: 'video-player',
        src: action.src,
        title: action.title,
    });

    const player = new WebviewWindow(VIDEO_WINDOW_LABEL, {
        url: `index.html?${params.toString()}`,
        title: action.title,
        x: Math.round(screenRect.x),
        y: Math.round(screenRect.y),
        width: Math.round(screenRect.width),
        height: Math.round(screenRect.height),
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
    });

    player.once('tauri://error', (event) => {
        console.warn('[pomodoro-video] failed to create player window', event.payload);
    }).catch(() => {});

    await invoke('reassert_window_always_on_top', { label: VIDEO_WINDOW_LABEL }).catch((error) => {
        console.warn('[pomodoro-video] failed to reassert always-on-top', error);
    });
}
