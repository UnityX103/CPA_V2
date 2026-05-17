import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import type { PomodoroEndActionResolution } from './pomodoroEndAction';

const VIDEO_WINDOW_LABEL = 'pomodoro-video-player';

export type PomodoroVideoWindowAction = Extract<PomodoroEndActionResolution, { kind: 'video' }>;

export async function openPomodoroVideoWindow(action: PomodoroVideoWindowAction): Promise<void> {
    const existing = await WebviewWindow.getByLabel(VIDEO_WINDOW_LABEL);
    await existing?.close().catch(() => {});

    const params = new URLSearchParams({
        window: 'video-player',
        src: action.src,
        title: action.title,
    });

    const player = new WebviewWindow(VIDEO_WINDOW_LABEL, {
        url: `index.html?${params.toString()}`,
        title: action.title,
        fullscreen: true,
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
}
