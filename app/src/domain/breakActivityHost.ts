import { useEffect, useState } from 'react';
import { emitTo, listen } from '@tauri-apps/api/event';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { usePomodoroStore } from './pomodoro';
import { extensionPackCatalog, useExtensionPackStore } from './extensionPacks';
import { useSettingsStore } from './settings';
import { BREAK_ACTIVITY_CONTROL_EVENT, BREAK_ACTIVITY_REQUEST_EVENT, BREAK_ACTIVITY_STATE_EVENT,
    type BreakActivityAction, type BreakActivitySnapshot } from './breakActivity';

export function useBreakActivityHost({ enabled }: { enabled: boolean }): string | null {
    const [error, setError] = useState<string | null>(null);
    const selected = useExtensionPackStore((state) => extensionPackCatalog.find((pack) =>
        pack.breakActivity && state.statuses[pack.id].installed && state.statuses[pack.id].enabled));
    useEffect(() => {
        if (!enabled) return;
        usePomodoroStore.getState().configureBreakActivity(selected?.id ?? null);
    }, [enabled, selected]);
    useEffect(() => {
        if (!enabled || !selected?.breakActivity || !isTauri()) return;
        const contribution = selected.breakActivity;
        let disposed = false;
        let visible = false;
        let visibilityQueue = Promise.resolve();
        let hideTimer: number | null = null;
        const cleanups: Array<() => void> = [];
        const transmit = () => {
            const state = usePomodoroStore.getState();
            const snapshot: BreakActivitySnapshot = { activity: state.breakActivity,
                remainingSeconds: state.remainingSeconds, phase: state.currentPhase,
                audioOutputDeviceId: useSettingsStore.getState().audioOutputDeviceId };
            void emitTo(contribution.window, BREAK_ACTIVITY_STATE_EVENT, snapshot).catch(() => {});
        };
        const setVisible = (next: boolean) => {
            if (next === visible) return;
            visible = next;
            visibilityQueue = visibilityQueue.catch(() => {}).then(async () => {
                if (disposed) return;
                try { await invoke(contribution.visibilityCommand, { visible: next }); transmit(); }
                catch (reason) {
                    visible = false;
                    setError(`休息活动窗口未能打开：${String(reason)}`);
                    const activity = usePomodoroStore.getState().breakActivity;
                    if (activity?.ownerId === selected.id) usePomodoroStore.getState().controlBreakActivity(activity.id, 'skip');
                }
            });
        };
        const reconcile = () => {
            const activity = usePomodoroStore.getState().breakActivity;
            if (activity?.ownerId === selected.id) {
                if (hideTimer !== null) { window.clearTimeout(hideTimer); hideTimer = null; }
                setVisible(true);
            } else if (visible && hideTimer === null) {
                transmit();
                hideTimer = window.setTimeout(() => { hideTimer = null; setVisible(false); }, 900);
            }
            if (visible) transmit();
        };
        cleanups.push(usePomodoroStore.subscribe(reconcile));
        cleanups.push(useSettingsStore.subscribe((state, previous) => {
            if (state.audioOutputDeviceId !== previous.audioOutputDeviceId) transmit();
        }));
        reconcile();
        const keep = <T,>(event: string, handler: (payload: T) => void) => {
            void listen<T>(event, ({ payload }) => handler(payload)).then((cleanup) => {
                if (disposed) cleanup(); else cleanups.push(cleanup);
            });
        };
        keep(BREAK_ACTIVITY_REQUEST_EVENT, transmit);
        keep<{ ownerId: string }>('break-activity:release', ({ ownerId }) => {
            const activity = usePomodoroStore.getState().breakActivity;
            if (ownerId === selected.id && activity?.ownerId === selected.id) {
                usePomodoroStore.getState().controlBreakActivity(activity.id, 'skip');
            }
        });
        keep<{ ownerId: string; id: string; action: BreakActivityAction }>(BREAK_ACTIVITY_CONTROL_EVENT, (payload) => {
            const activity = usePomodoroStore.getState().breakActivity;
            if (payload.ownerId === selected.id && activity?.ownerId === selected.id
                && activity.id === payload.id) usePomodoroStore.getState().controlBreakActivity(payload.id, payload.action);
        });
        return () => {
            disposed = true;
            cleanups.forEach((cleanup) => cleanup());
            if (hideTimer !== null) window.clearTimeout(hideTimer);
            void invoke(contribution.visibilityCommand, { visible: false }).catch(() => {});
        };
    }, [enabled, selected]);
    return error;
}
