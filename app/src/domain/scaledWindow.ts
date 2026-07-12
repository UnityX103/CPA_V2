import { useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useSettingsStore } from './settings';

export const MAIN_WINDOW_BASE_SIZE = { width: 233, height: 155 } as const;
export const SETTINGS_WINDOW_BASE_SIZE = { width: 460, height: 440 } as const;
export const SETTINGS_WINDOW_MIN_SIZE = { width: 360, height: 320 } as const;
export const INPUT_COUNTER_BASE_WIDTH = 128;
export const INPUT_COUNTER_BASE_HEIGHT = 84;

export interface ScaledWindowSizeOptions {
    label: string;
    baseWidth: number;
    baseHeight: number;
    minWidth: number;
    minHeight: number;
    center?: boolean;
    enabled?: boolean;
}

export function useScaledWindowSize({
    label,
    baseWidth,
    baseHeight,
    minWidth,
    minHeight,
    center = false,
    enabled = true,
}: ScaledWindowSizeOptions) {
    const scale = useSettingsStore((s) => s.uiScale);

    useEffect(() => {
        if (!enabled) return;
        void invoke('resize_scaled_window', {
            args: {
                label,
                baseWidth,
                baseHeight,
                minWidth,
                minHeight,
                scale,
                defaultCenter: center,
            },
        }).catch((error) => {
            console.error(`[scaled-window] resize ${label} failed`, error);
        });
    }, [baseHeight, baseWidth, center, enabled, label, minHeight, minWidth, scale]);
}
