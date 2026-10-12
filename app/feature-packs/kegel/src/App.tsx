import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { emitTo, listen } from '@tauri-apps/api/event';
import { BREAK_ACTIVITY_REQUEST_EVENT, BREAK_ACTIVITY_STATE_EVENT, type BreakActivitySnapshot } from '../../../src/domain/breakActivity';
import { loadKegelPreferences, saveKegelHistory, saveKegelSettings } from './api';
import { KegelController, type KegelWindowSnapshot } from './controller';
import { KegelView } from './KegelView';
import { advanceKegel, createKegelSession, DEFAULT_KEGEL_SETTINGS, kegelScale, type KegelSettings } from './domain/kegel';
import { recordKegelReps } from './domain/kegelHistory';

export default function KegelApp() {
    const [controller] = useState(() => new KegelController({ saveHistory: saveKegelHistory, saveSettings: saveKegelSettings,
        control: async (id, action) => { await invoke('control_kegel_break_activity', { id, action }); } }));
    const [snapshot, setSnapshot] = useState(controller.state);
    useEffect(() => {
        let disposed = false;
        const cleanups: Array<() => void> = [];
        let ready = false;
        let latest: BreakActivitySnapshot | null = null;
        const unsubscribe = controller.subscribe(setSnapshot);
        const request = () => { void emitTo('main', BREAK_ACTIVITY_REQUEST_EVENT, {}).catch(() => {}); };
        void listen<BreakActivitySnapshot>(BREAK_ACTIVITY_STATE_EVENT, ({ payload }) => {
            latest = payload;
            if (ready && !disposed) controller.receive(payload);
        }).then((unlisten) => { if (disposed) unlisten(); else { cleanups.push(unlisten); request(); } });
        void listen('kegel-module-settings-changed', () => {
            void loadKegelPreferences().then(({ settings }) => {
                if (ready && !disposed) controller.refreshSettings(settings);
            }).catch(() => {});
        }).then((unlisten) => { if (disposed) unlisten(); else cleanups.push(unlisten); });
        void loadKegelPreferences().then(({ settings, history }) => {
            if (disposed) return;
            controller.hydrate(settings, history); ready = true;
            if (latest) controller.receive(latest);
            request();
        }).catch((reason) => { if (!disposed) setSnapshot((state) => ({ ...state, error: `模块初始化失败：${String(reason)}` })); });
        let last = performance.now();
        const timer = window.setInterval(() => {
            const now = performance.now();
            if (ready) controller.tick((now - last) / 1000);
            last = now;
        }, 50);
        const retry = window.setInterval(request, 1000);
        return () => { disposed = true; cleanups.forEach((cleanup) => cleanup()); unsubscribe(); window.clearInterval(timer); window.clearInterval(retry); };
    }, [controller]);
    if (!snapshot.session) return snapshot.error ? <p role="alert">{snapshot.error}</p> : null;
    return <KegelView snapshot={snapshot} toggle={() => controller.control('toggle')}
        dismiss={() => controller.control('skip')} apply={(settings) => controller.apply(settings)} />;
}

/** Independent in-memory preview; never claims that a native pack is installed. */
export function KegelPreviewApp() {
    const [snapshot, setSnapshot] = useState<KegelWindowSnapshot>(() => {
        const settings = { ...DEFAULT_KEGEL_SETTINGS, enabled: true };
        return { settings, session: createKegelSession(settings), history: [], remainingSeconds: 300, completed: false };
    });
    useEffect(() => {
        let last = performance.now();
        const interval = window.setInterval(() => {
            const now = performance.now(); const delta = (now - last) / 1000; last = now;
            setSnapshot((state) => {
                if (!state.session) return state;
                const result = advanceKegel(state.session, delta);
                if (result.session === state.session) return state;
                return { ...state, session: result.session, remainingSeconds: Math.max(0, state.remainingSeconds - result.restDelta),
                    completed: result.session.phase === 'finished', history: recordKegelReps(state.history, result.session.id,
                        result.session.plan.repetitions, result.session.completedReps - state.session.completedReps, result.session.phase === 'finished') };
            });
        }, 50);
        return () => window.clearInterval(interval);
    }, []);
    const toggle = () => setSnapshot((state) => {
        const session = state.session!;
        return { ...state, session: session.phase === 'waiting' ? { ...session, phase: 'contract', elapsed: 0 }
            : session.paused ? { ...session, phase: 'resetting', elapsed: 0, paused: false, resetFromScale: kegelScale(session) }
                : { ...session, paused: true } };
    });
    const apply = async (settings: KegelSettings) => setSnapshot((state) => ({ ...state, settings,
        session: state.session?.phase === 'waiting' ? createKegelSession(settings) : state.session }));
    if (snapshot.session?.phase === 'skipped') return <div className="kegel-preview-background kegel-preview-ended"><div>
        <h1>运动已结束</h1><button className="kegel-primary" onClick={() => setSnapshot((state) => ({ ...state,
            remainingSeconds: 300, completed: false, session: createKegelSession(state.settings) }))}>再预览一组</button></div></div>;
    return <div className="kegel-preview-background"><KegelView snapshot={snapshot} toggle={toggle}
        dismiss={() => setSnapshot((state) => ({ ...state, session: { ...state.session!, phase: 'skipped' } }))} apply={apply} /></div>;
}
