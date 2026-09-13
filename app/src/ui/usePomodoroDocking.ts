import { useEffect, useState, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

export interface DockView { side: 'left' | 'right' | null; expanded: boolean; dragging: boolean }
const full: DockView = { side: null, expanded: false, dragging: false };
export function usePomodoroDocking(autoDock: boolean, paused: boolean, phase = 'focus') {
    const commands = useRef<Promise<unknown>>(Promise.resolve());
    // Preserve enter/leave and mode-change order even when native window resizing is asynchronous.
    const enqueue = <T,>(command: string, args: Record<string, unknown>): Promise<T> => {
        const next = commands.current.then(() => invoke<T>(command, args));
        commands.current = next.catch(() => undefined);
        return next;
    };
    const [view, setView] = useState<DockView>(full);
    useEffect(() => {
        if (!('__TAURI_INTERNALS__' in window)) return;
        let cancelled = false;
        const subscription = listen<DockView>('pomodoro-docking', ({ payload }) => {
            if (!cancelled) setView(payload);
        });
        return () => { cancelled = true; void subscription.then(unlisten => unlisten()); };
    }, []);
    useEffect(() => {
        if (!('__TAURI_INTERNALS__' in window)) return;
        let cancelled = false;
        void enqueue<DockView>('configure_pomodoro_docking', { autoDock, paused, phase })
            .then(value => { if (!cancelled) setView(value); })
            .catch(error => console.error('[docking] configure', error));
        return () => { cancelled = true; };
    }, [autoDock, paused, phase]);
    const hover = (hovered: boolean) => {
        if (!('__TAURI_INTERNALS__' in window)) return;
        void enqueue('hover_pomodoro_docking', { hovered })
            .catch(error => console.error('[docking] hover', error));
    };
    return { ...view, hover };
}
