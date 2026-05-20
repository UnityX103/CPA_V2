import { useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useCheckinStore } from './checkin';
import { useScaledWindowSize } from './scaledWindow';

export const TODAY_CHECKIN_BASE_WIDTH = 278;
export const TODAY_CHECKIN_BASE_HEIGHT = 289;
export const CHECKIN_EDITOR_BASE_WIDTH = 460;
export const CHECKIN_EDITOR_BASE_HEIGHT = 898;
export const CHECKIN_EDITOR_MIN_WIDTH = 360;
export const CHECKIN_EDITOR_MIN_HEIGHT = 420;

export function useCheckinWindowController(): void {
    useEffect(() => {
        void invoke('open_today_checkin_window').catch((error) => {
            useCheckinStore.getState().setLastError(String(error));
        });
    }, []);

    useScaledWindowSize({
        label: 'today-checkin',
        baseWidth: TODAY_CHECKIN_BASE_WIDTH,
        baseHeight: TODAY_CHECKIN_BASE_HEIGHT,
        minWidth: TODAY_CHECKIN_BASE_WIDTH,
        minHeight: TODAY_CHECKIN_BASE_HEIGHT,
    });
}

export function useCheckinEditorWindowSize(): void {
    useScaledWindowSize({
        label: 'checkin-editor',
        baseWidth: CHECKIN_EDITOR_BASE_WIDTH,
        baseHeight: CHECKIN_EDITOR_BASE_HEIGHT,
        minWidth: CHECKIN_EDITOR_MIN_WIDTH,
        minHeight: CHECKIN_EDITOR_MIN_HEIGHT,
        center: true,
    });
}

export async function openCheckinEditorWindow(): Promise<void> {
    await invoke('open_checkin_editor_window');
}
