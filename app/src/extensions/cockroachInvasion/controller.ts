import { emit, listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import type { ExtensionRuntimeContribution } from '../../domain/extensionPacks';
import type { PomodoroBroadcast } from '../../domain/pomodoroBroadcast';
import {
    COCKROACH_AUTOMATION_RESULT, COCKROACH_RULES_CHANGED,
    executeCockroachAction, readCockroachRules, type CockroachRule, type CockroachAction,
} from '../../domain/cockroachAutomation';
import { extensionPomodoroBroadcast } from '../pomodoroBroadcastClient';

export interface CockroachRuleAdapter {
    read: () => Promise<CockroachRule[]>;
    listen: (changed: (rules: CockroachRule[]) => void) => Promise<() => void>;
    execute: (action: CockroachAction) => Promise<void>;
    stop: () => Promise<void>;
    report: (error: string | null) => void;
}
const adapter: CockroachRuleAdapter = {
    read: readCockroachRules,
    listen: (changed) => listen<CockroachRule[]>(COCKROACH_RULES_CHANGED, ({ payload }) => changed(payload)),
    execute: executeCockroachAction,
    stop: () => invoke('set_extension_pack_active', { packId: 'pet.cockroach-invasion', active: false }),
    report: (error) => {
        void emit(COCKROACH_AUTOMATION_RESULT, { error }).catch((reason) => {
            console.warn('[cockroach-rules] status delivery failed', reason);
        });
    },
};

export function startCockroachModuleController(
    contribution?: ExtensionRuntimeContribution | null,
    control: CockroachRuleAdapter = adapter,
    broadcast: PomodoroBroadcast = extensionPomodoroBroadcast,
): () => void {
    let disposed = false;
    let revision = 0;
    let rules: readonly CockroachRule[] = [];
    let lastSequence = -1;
    let queue = Promise.resolve();
    let unlisten: (() => void) | undefined;
    let settingsChanged = false;
    const replaceRules = (next: CockroachRule[]) => {
        revision++;
        rules = next;
    };
    // Register before reading so a concurrent save cannot be overwritten by an old read.
    void control.listen((next) => {
        if (disposed) return;
        settingsChanged = true;
        replaceRules(next);
    }).then(async (cleanup) => {
        if (disposed) { cleanup(); return; }
        unlisten = cleanup;
        const initial = await control.read();
        if (!disposed && !settingsChanged) replaceRules(initial);
    }).catch((error) => { if (!disposed) control.report(String(error)); });

    const unsubscribe = broadcast.subscribe((event) => {
        if (disposed || event.v !== 1 || event.type === 'snapshot' || event.sequence <= lastSequence) return;
        lastSequence = event.sequence;
        const events = event.signals ?? [];
        const currentRevision = revision;
        const selected = rules.filter((rule) => events.includes(rule.event)
            && (!contribution?.eventRules || (
                contribution.eventRules.events.includes(rule.event)
                && contribution.eventRules.actions.includes(rule.action)
            )));
        // Preserve row order and do not let slow process startup overtake a stop or kill action.
        for (const rule of selected) {
            queue = queue.then(async () => {
                if (disposed || revision !== currentRevision) return;
                try { await control.execute(rule.action); control.report(null); }
                catch (error) { control.report(error instanceof Error ? error.message : String(error)); }
            });
        }
    });
    return () => {
        disposed = true;
        unsubscribe();
        unlisten?.();
        // Finish an in-flight start before stopping; queued actions are cancelled by disposed.
        void queue.then(() => control.stop()).catch((error) => control.report(String(error)));
    };
}
