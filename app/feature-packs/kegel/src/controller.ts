import type { BreakActivityAction, BreakActivitySnapshot } from '../../../src/domain/breakActivity';
import { advanceKegel, createKegelSession, DEFAULT_KEGEL_SETTINGS, kegelScale,
    type KegelSession, type KegelSettings } from './domain/kegel';
import { recordKegelReps, type KegelRecord } from './domain/kegelHistory';

export interface KegelWindowSnapshot {
    session: KegelSession | null;
    settings: KegelSettings;
    history: KegelRecord[];
    remainingSeconds: number;
    completed: boolean;
    audioOutputDeviceId?: string | null;
    error?: string;
}
export interface KegelControllerAdapter {
    control: (id: string, action: BreakActivityAction) => Promise<void> | void;
    saveHistory: (history: KegelRecord[]) => Promise<void>;
    saveSettings: (settings: KegelSettings) => Promise<void>;
}

/** Exercise timing and history belong to the downloadable feature, not the host. */
export class KegelController {
    state: KegelWindowSnapshot = { session: null, settings: { ...DEFAULT_KEGEL_SETTINGS, enabled: true },
        history: [], remainingSeconds: 300, completed: false };
    private host: BreakActivitySnapshot | null = null;
    private saving = Promise.resolve();
    private finishing = false;
    private readonly listeners = new Set<(state: KegelWindowSnapshot) => void>();
    constructor(private readonly adapter: KegelControllerAdapter) {}
    subscribe(listener: (state: KegelWindowSnapshot) => void): () => void {
        this.listeners.add(listener); return () => { this.listeners.delete(listener); };
    }
    private update(patch: Partial<KegelWindowSnapshot>): void {
        this.state = { ...this.state, ...patch };
        this.listeners.forEach((listener) => listener(this.state));
    }
    hydrate(settings: KegelSettings, history: KegelRecord[]): void {
        this.update({ settings, history });
        if (this.host) this.receive(this.host);
    }
    refreshSettings(settings: KegelSettings): void {
        // Keep this window's pending counts; the on-disk history may still be
        // behind the serialized save queue when host settings change.
        this.update({ settings });
        if (this.host) this.receive(this.host);
    }
    receive(host: BreakActivitySnapshot): void {
        this.host = host;
        const activity = host.activity;
        let session = this.state.session;
        if (activity?.ownerId === 'wellness.kegel') {
            if (!session || session.id !== activity.id) {
                session = { ...createKegelSession(this.state.settings), id: activity.id };
                this.finishing = false;
            }
            if (activity.status === 'waiting') session = { ...session,
                plan: { repetitions: this.state.settings.repetitions, contractSeconds: this.state.settings.contractSeconds, relaxSeconds: this.state.settings.relaxSeconds } };
            else if (activity.status === 'paused') session = { ...session, paused: true };
            else if (activity.status === 'resetting' && session.paused) session = {
                ...session, phase: 'resetting', paused: false, elapsed: 0, resetFromScale: kegelScale(session) };
            else if (activity.status === 'running' && session.phase === 'waiting') session = { ...session, phase: 'contract', elapsed: 0 };
        } else if (session && session.phase !== 'finished') session = { ...session, phase: 'skipped', paused: false };
        this.update({ session, remainingSeconds: host.remainingSeconds, completed: session?.phase === 'finished',
            audioOutputDeviceId: host.audioOutputDeviceId ?? null });
    }
    tick(deltaSeconds: number): void {
        const session = this.state.session;
        const activity = this.host?.activity;
        if (!session || activity?.id !== session.id || !['running', 'resetting'].includes(activity.status)) return;
        const result = advanceKegel(session, deltaSeconds);
        if (result.session === session) return;
        const count = result.session.completedReps - session.completedReps;
        const history = recordKegelReps(this.state.history, session.id, session.plan.repetitions,
            count, result.session.phase === 'finished');
        this.update({ session: result.session, history, completed: result.session.phase === 'finished' });
        if (count > 0) this.saving = this.saving.catch(() => {}).then(() => this.adapter.saveHistory(history)).catch((reason) => {
            this.update({ error: `运动记录未能保存：${String(reason)}` });
        });
        if (session.phase === 'resetting' && result.session.phase !== 'resetting') void this.adapter.control(session.id, 'resume-ready');
        if (result.session.phase === 'finished' && !this.finishing) {
            this.finishing = true;
            void this.saving.then(() => this.adapter.control(session.id, 'finish'));
        }
    }
    async apply(settings: KegelSettings): Promise<void> {
        await this.adapter.saveSettings(settings);
        this.refreshSettings(settings);
    }
    async control(action: 'toggle' | 'skip'): Promise<void> {
        if (this.state.session) await this.adapter.control(this.state.session.id, action);
    }
    async flush(): Promise<void> { await this.saving; }
}
