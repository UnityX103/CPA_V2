import { useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { effectiveItemsForDate, isRestDate, useCheckinStore } from './checkin';
import { useScaledWindowSize } from './scaledWindow';
import { useSettingsStore } from './settings';

export const TODAY_CHECKIN_BASE_WIDTH = 278;
export const TODAY_CHECKIN_BASE_HEIGHT = 289;
export const TODAY_CHECKIN_ITEM_HEIGHT = 60;
export const CHECKIN_EDITOR_BASE_WIDTH = 460;
export const CHECKIN_EDITOR_BASE_HEIGHT = 898;
export const CHECKIN_EDITOR_MIN_WIDTH = 360;
export const CHECKIN_EDITOR_MIN_HEIGHT = 420;

function todayLocalDate(): string {
    const now = new Date();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${now.getFullYear()}-${month}-${day}`;
}

export function todayCheckinHeightForItemCount(itemCount: number): number {
    return TODAY_CHECKIN_BASE_HEIGHT + Math.max(0, itemCount - 1) * TODAY_CHECKIN_ITEM_HEIGHT;
}

export function useCheckinWindowController(): void {
    const checkinEnabled = useSettingsStore((s) => s.checkinEnabled);

    useEffect(() => {
        if (!checkinEnabled) {
            void closeCheckinWindows();
            return;
        }
        void invoke('open_today_checkin_window').catch((error) => {
            useCheckinStore.getState().setLastError(String(error));
        });
    }, [checkinEnabled]);
}

export function useTodayCheckinWindowSize(enabled = true): void {
    const checkinState = useCheckinStore();
    const date = todayLocalDate();
    const itemCount = isRestDate(checkinState, date) ? 0 : effectiveItemsForDate(checkinState, date).length;
    useScaledWindowSize({
        label: 'today-checkin',
        baseWidth: TODAY_CHECKIN_BASE_WIDTH,
        baseHeight: todayCheckinHeightForItemCount(itemCount),
        minWidth: TODAY_CHECKIN_BASE_WIDTH,
        minHeight: TODAY_CHECKIN_BASE_HEIGHT,
        enabled,
    });
}

export function useCheckinEditorWindowSize(enabled = true): void {
    useScaledWindowSize({
        label: 'checkin-editor',
        baseWidth: CHECKIN_EDITOR_BASE_WIDTH,
        baseHeight: CHECKIN_EDITOR_BASE_HEIGHT,
        minWidth: CHECKIN_EDITOR_MIN_WIDTH,
        minHeight: CHECKIN_EDITOR_MIN_HEIGHT,
        center: true,
        enabled,
    });
}

export async function openCheckinEditorWindow(): Promise<void> {
    if (!useSettingsStore.getState().checkinEnabled) return;
    await invoke('open_checkin_editor_window');
}

export async function openTodayCheckinWindow(): Promise<void> {
    if (!useSettingsStore.getState().checkinEnabled) return;
    await invoke('open_today_checkin_window');
}

export async function closeCheckinWindows(): Promise<void> {
    const results = await Promise.allSettled([
        invoke('close_today_checkin_window'),
        invoke('close_checkin_editor_window'),
    ]);
    const rejected = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
    if (rejected) {
        useCheckinStore.getState().setLastError(String(rejected.reason));
    }
}
