import { useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { create, type StoreApi, type UseBoundStore } from 'zustand';

export type ExtensionPackId =
    | 'video.core'
    | 'video.editor'
    | 'pet.core'
    | 'pet.cockroach-invasion';

export type ExtensionPackKind = 'common' | 'feature';
export type ExtensionSettingsTab = 'pet' | 'video';
export type ExtensionSettingsRenderer = 'pet.cockroach-invasion' | 'video.editor';

export interface ExtensionPackDescriptor {
    readonly id: ExtensionPackId;
    readonly name: string;
    readonly kind: ExtensionPackKind;
    readonly order: number;
    readonly icon: string;
    readonly description: string;
    readonly contents: string;
    readonly dependencies: readonly ExtensionPackId[];
    readonly settings?: {
        readonly tab: ExtensionSettingsTab;
        readonly label: string;
        readonly order: number;
        readonly renderer: ExtensionSettingsRenderer;
    };
}

export interface ExtensionPackStatus {
    readonly id: ExtensionPackId;
    readonly installed: boolean;
    readonly enabled: boolean;
    readonly version: string | null;
    readonly target: string;
    readonly message: string;
    readonly runtimeContribution?: ExtensionRuntimeContribution;
}

export interface ExtensionRuntimeContribution {
    readonly eventContract: 'pomodoro-broadcast-v1';
    readonly activationPhase: 'focus' | 'break' | 'completed';
    readonly delayMs: number;
    readonly requiresPresence: boolean;
    readonly settingsGate: string;
}

export interface ExtensionSettingsContribution {
    readonly packId: ExtensionPackId;
    readonly tab: ExtensionSettingsTab;
    readonly label: string;
    readonly renderer: ExtensionSettingsRenderer;
}

export type ExtensionPackStatuses = Record<ExtensionPackId, ExtensionPackStatus>;
export type ExtensionPackRevisions = Record<ExtensionPackId, number>;

export interface ExtensionPackProgress {
    readonly packId: ExtensionPackId;
    readonly stage: 'index' | 'download' | 'install' | 'complete';
    readonly downloadedBytes: number;
    readonly totalBytes: number | null;
    readonly message: string;
}

interface ExtensionPackStoreState {
    statuses: ExtensionPackStatuses;
    hydrated: boolean;
    revisions: ExtensionPackRevisions;
    busyPackId: ExtensionPackId | null;
    progress: ExtensionPackProgress | null;
    error: string | null;
    refresh: () => Promise<void>;
    install: (packId: ExtensionPackId) => Promise<void>;
    setEnabled: (packId: ExtensionPackId, enabled: boolean) => Promise<void>;
    uninstall: (packId: ExtensionPackId) => Promise<void>;
    receiveStatuses: (
        statuses: readonly ExtensionPackStatus[],
        changedPackId?: ExtensionPackId,
    ) => void;
}

export type ExtensionPackStore = UseBoundStore<StoreApi<ExtensionPackStoreState>>;

export const extensionPackRegistry: Readonly<Record<ExtensionPackId, ExtensionPackDescriptor>> = {
    'video.core': {
        id: 'video.core',
        name: '视频通用包',
        kind: 'common',
        order: 10,
        icon: '视',
        description: '视频功能共享的跨平台运行环境。',
        contents: '引擎、模型桥、FFmpeg / FFprobe',
        dependencies: [],
    },
    'video.editor': {
        id: 'video.editor',
        name: 'AI 视频编辑',
        kind: 'feature',
        order: 20,
        icon: '剪',
        description: '主体跟踪、毛发软边抠图与透明 WebM 导出。',
        contents: '安装时自动补齐视频通用包',
        dependencies: ['video.core'],
        settings: {
            tab: 'video',
            label: '视频编辑',
            order: 20,
            renderer: 'video.editor',
        },
    },
    'pet.core': {
        id: 'pet.core',
        name: '宠物通用包',
        kind: 'common',
        order: 30,
        icon: '宠',
        description: '桌面宠物功能共享的运行环境。',
        contents: 'Electron 运行时、进程生命周期、控制协议',
        dependencies: [],
    },
    'pet.cockroach-invasion': {
        id: 'pet.cockroach-invasion',
        name: '蟑螂入侵',
        kind: 'feature',
        order: 40,
        icon: '蟑',
        description: '在休息与离席规则满足时运行桌面蟑螂。',
        contents: '安装时自动补齐宠物通用包',
        dependencies: ['pet.core'],
        settings: {
            tab: 'pet',
            label: '宠物',
            order: 10,
            renderer: 'pet.cockroach-invasion',
        },
    },
};

export const extensionPackCatalog: readonly ExtensionPackDescriptor[] = Object.values(
    extensionPackRegistry,
).sort((left, right) => left.order - right.order);

export function settingsContributionsFor(
    statuses: readonly ExtensionPackStatus[],
): ExtensionSettingsContribution[] {
    const byId = new Map(statuses.map((status) => [status.id, status]));
    return extensionPackCatalog.flatMap((descriptor) => {
        const status = byId.get(descriptor.id);
        if (!descriptor.settings || !status?.installed || !status.enabled) return [];
        return [{
            packId: descriptor.id,
            tab: descriptor.settings.tab,
            label: descriptor.settings.label,
            renderer: descriptor.settings.renderer,
        }];
    }).sort((left, right) => (
        extensionPackRegistry[left.packId].settings!.order
        - extensionPackRegistry[right.packId].settings!.order
    ));
}

function emptyStatus(id: ExtensionPackId): ExtensionPackStatus {
    return {
        id,
        installed: false,
        enabled: false,
        version: null,
        target: 'unknown',
        message: '',
    };
}

function emptyStatuses(): ExtensionPackStatuses {
    return {
        'video.core': emptyStatus('video.core'),
        'video.editor': emptyStatus('video.editor'),
        'pet.core': emptyStatus('pet.core'),
        'pet.cockroach-invasion': emptyStatus('pet.cockroach-invasion'),
    };
}

function emptyRevisions(): ExtensionPackRevisions {
    return {
        'video.core': 0,
        'video.editor': 0,
        'pet.core': 0,
        'pet.cockroach-invasion': 0,
    };
}

function indexedStatuses(statuses: readonly ExtensionPackStatus[]): ExtensionPackStatuses {
    const indexed = emptyStatuses();
    for (const status of statuses) indexed[status.id] = status;
    return indexed;
}

function errorText(reason: unknown): string {
    if (reason instanceof Error) return reason.message;
    return typeof reason === 'string' ? reason : '扩展包操作失败';
}

export function createExtensionPackStore(): ExtensionPackStore {
    return create<ExtensionPackStoreState>((set) => {
        const operate = async (
            packId: ExtensionPackId,
            command: 'install_extension_pack' | 'set_extension_pack_enabled' | 'uninstall_extension_pack',
            args: Record<string, unknown> = {},
        ) => {
            set({ busyPackId: packId, progress: null, error: null });
            try {
                const statuses = await invoke<ExtensionPackStatus[]>(command, {
                    packId,
                    ...args,
                });
                set({ statuses: indexedStatuses(statuses) });
            } catch (reason) {
                set({ error: errorText(reason) });
            } finally {
                set({ busyPackId: null });
            }
        };

        return {
            statuses: emptyStatuses(),
            hydrated: false,
            revisions: emptyRevisions(),
            busyPackId: null,
            progress: null,
            error: null,
            refresh: async () => {
                try {
                    const statuses = await invoke<ExtensionPackStatus[]>('extension_pack_statuses');
                    set({
                        statuses: indexedStatuses(statuses),
                        hydrated: true,
                        error: null,
                    });
                } catch (reason) {
                    set({ hydrated: true, error: errorText(reason) });
                }
            },
            install: (packId) => operate(packId, 'install_extension_pack'),
            setEnabled: (packId, enabled) => operate(
                packId,
                'set_extension_pack_enabled',
                { enabled },
            ),
            uninstall: (packId) => operate(packId, 'uninstall_extension_pack'),
            receiveStatuses: (statuses, changedPackId) => set((state) => ({
                statuses: indexedStatuses(statuses),
                hydrated: true,
                revisions: changedPackId ? {
                    ...state.revisions,
                    [changedPackId]: state.revisions[changedPackId] + 1,
                } : state.revisions,
                error: null,
            })),
        };
    });
}

export const useExtensionPackStore = createExtensionPackStore();

interface NativeModuleProgress {
    readonly stage: ExtensionPackProgress['stage'];
    readonly downloadedBytes: number;
    readonly totalBytes: number | null;
    readonly message: string;
}

interface NativeStatusChangedEvent {
    readonly packId: ExtensionPackId;
    readonly statuses: readonly ExtensionPackStatus[];
}

function featurePackForProgress(kind: 'video' | 'pet'): ExtensionPackId {
    const busy = useExtensionPackStore.getState().busyPackId;
    if (kind === 'video' && (busy === 'video.core' || busy === 'video.editor')) return busy;
    if (kind === 'pet' && (busy === 'pet.core' || busy === 'pet.cockroach-invasion')) return busy;
    return kind === 'video' ? 'video.editor' : 'pet.cockroach-invasion';
}

async function listenProgress(
    event: string,
    kind: 'video' | 'pet',
): Promise<UnlistenFn> {
    return listen<NativeModuleProgress>(event, ({ payload }) => {
        useExtensionPackStore.setState({
            progress: {
                packId: featurePackForProgress(kind),
                ...payload,
            },
        });
    });
}

export function useExtensionPackSync({ enabled = true }: { enabled?: boolean } = {}): void {
    useEffect(() => {
        if (!enabled) return undefined;
        let disposed = false;
        const unlisteners: UnlistenFn[] = [];
        const keep = (promise: Promise<UnlistenFn>) => {
            void promise.then((unlisten) => {
                if (disposed) unlisten();
                else unlisteners.push(unlisten);
            }).catch((error) => {
                console.warn('[extension-packs] event listener unavailable', error);
            });
        };
        void useExtensionPackStore.getState().refresh();
        keep(listen<NativeStatusChangedEvent>('extension-pack-status-changed', ({ payload }) => {
            useExtensionPackStore.getState().receiveStatuses(payload.statuses, payload.packId);
        }));
        keep(listenProgress('video-editor-module-progress', 'video'));
        keep(listenProgress('cockroach-module-progress', 'pet'));
        return () => {
            disposed = true;
            unlisteners.forEach((unlisten) => unlisten());
        };
    }, [enabled]);
}
