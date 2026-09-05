import { useEffect } from 'react';
import {
    extensionPackCatalog,
    useExtensionPackStore,
    type ExtensionPackId,
    type ExtensionRuntimeContribution,
} from '../domain/extensionPacks';
import { startEventDrivenRuntime } from './eventDrivenRuntime';

interface ExtensionRuntimeModule {
    start: (contribution?: ExtensionRuntimeContribution | null) => () => void;
}

interface ActiveRuntimeEntry {
    readonly packId: ExtensionPackId;
    readonly contribution: ExtensionRuntimeContribution | null;
}

const RUNTIME_LOADERS: Partial<Record<ExtensionPackId, () => Promise<ExtensionRuntimeModule>>> = {
    'pet.cockroach-invasion': async () => {
        const module = await import('./cockroachInvasion/controller');
        return { start: module.startCockroachModuleController };
    },
};

export function useExtensionRuntimeContributions({ enabled }: { enabled: boolean }): void {
    const activeRuntimeKey = useExtensionPackStore((state) => JSON.stringify(
        extensionPackCatalog
            .filter((pack) => {
                const status = state.statuses[pack.id];
                return status.installed
                    && status.enabled
                    && (status.runtimeContribution || RUNTIME_LOADERS[pack.id]);
            })
            .map((pack) => ({
                packId: pack.id,
                contribution: state.statuses[pack.id].runtimeContribution ?? null,
                revision: state.revisions[pack.id],
                dependencyRevisions: pack.dependencies.map((dependency) => (
                    state.revisions[dependency]
                )),
            })),
    ));

    useEffect(() => {
        if (!enabled || !activeRuntimeKey) return undefined;
        let disposed = false;
        const cleanups: Array<() => void> = [];
        const entries = JSON.parse(activeRuntimeKey) as ActiveRuntimeEntry[];
        entries.forEach((entry) => {
            const { packId, contribution } = entry;
            const loader = RUNTIME_LOADERS[packId];
            if (!loader) {
                if (contribution) cleanups.push(startEventDrivenRuntime(packId, contribution));
                return;
            }
            void loader().then((runtime) => {
                if (disposed) return;
                cleanups.push(runtime.start(contribution));
            }).catch((error) => {
                console.warn(`[extension-runtime] failed to start ${packId}`, error);
            });
        });
        return () => {
            disposed = true;
            cleanups.forEach((cleanup) => cleanup());
        };
    }, [activeRuntimeKey, enabled]);
}
