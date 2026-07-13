import { useEffect } from 'react';
import { create, type StoreApi, type UseBoundStore } from 'zustand';
import {
    buildVideoProcessRequest,
    INITIAL_VIDEO_EDITOR_DRAFT,
    videoEditorReducer,
    type BrushPoint,
    type VideoCrop,
    type VideoEditorAction,
    type VideoEditorDraft,
    type VideoProbe,
    type VideoProcessRequest,
} from './videoEditor';
import {
    listenVideoEditorProgress,
    pickEditedVideoOutputPath,
    pickVideoForEditing,
    prepareVideoEditorResultPreview,
    probeVideoForEditing,
    processBackgroundRemovedVideo,
    videoEditorPreviewSrc,
    videoEditorRuntimeStatus,
    type VideoEditorProgress,
    type VideoEditorRuntimeStatus,
    type VideoProcessResult,
} from './videoEditorFiles';
import {
    usePomodoroStore,
    type PomodoroEndActionMode,
    type PomodoroEndActionVideo,
} from './pomodoro';
import { DEFAULT_BUILTIN_POMODORO_VIDEO_ID } from './pomodoroVideos';

export type VideoEditorTool = 'preview' | 'crop' | 'erase';
export type ResultPreviewPlaybackState = 'idle' | 'loading' | 'ready' | 'error';

const RUNTIME_STATUS_TIMEOUT_MS = 10_000;

export interface VideoEditorDependencies {
    listenProgress: (
        handler: (progress: VideoEditorProgress) => void,
    ) => Promise<() => void>;
    pickInput: () => Promise<string | null>;
    pickOutput: (inputPath: string) => Promise<string | null>;
    previewSrc: (path: string) => string;
    prepareResultPreview: (path: string) => Promise<string>;
    probe: (path: string) => Promise<VideoProbe>;
    process: (request: VideoProcessRequest) => Promise<VideoProcessResult>;
    runtimeStatus: () => Promise<VideoEditorRuntimeStatus>;
    currentPomodoroVideo: () => PomodoroEndActionVideo;
    applyPomodoroVideo: (
        mode: PomodoroEndActionMode,
        video: PomodoroEndActionVideo,
    ) => Promise<void> | void;
    createJobId: () => string;
}

export interface VideoEditorState {
    draft: VideoEditorDraft;
    previewSrc: string;
    tool: VideoEditorTool;
    runtime: VideoEditorRuntimeStatus | null;
    isLoading: boolean;
    isChoosingOutput: boolean;
    isProcessing: boolean;
    isPreparingResultPreview: boolean;
    isApplyingToPomodoro: boolean;
    progress: VideoEditorProgress | null;
    error: string;
    savedPath: string;
    resultPreviewSrc: string;
    resultPreviewPlaybackState: ResultPreviewPlaybackState;
    appliedToPomodoro: boolean;
}

export interface VideoEditorActions {
    reset: () => void;
    refreshRuntime: () => Promise<void>;
    attachProgressListener: () => Promise<() => void>;
    chooseVideo: () => Promise<void>;
    saveVideo: () => Promise<void>;
    setAsPomodoroVideo: () => Promise<void>;
    markResultPreviewReady: () => void;
    markResultPreviewError: () => void;
    receiveProgress: (progress: VideoEditorProgress) => void;
    setTool: (tool: VideoEditorTool) => void;
    setCrop: (crop: VideoCrop) => void;
    setStartSeconds: (value: number) => void;
    setEndSeconds: (value: number) => void;
    setThreshold: (value: number) => void;
    setBrushRadius: (value: number) => void;
    beginStroke: (point: BrushPoint) => void;
    extendStroke: (point: BrushPoint) => void;
    undoStroke: () => void;
    clearStrokes: () => void;
}

export type VideoEditorStore = UseBoundStore<StoreApi<VideoEditorState & VideoEditorActions>>;

const defaultDependencies: VideoEditorDependencies = {
    listenProgress: listenVideoEditorProgress,
    pickInput: pickVideoForEditing,
    pickOutput: pickEditedVideoOutputPath,
    previewSrc: videoEditorPreviewSrc,
    prepareResultPreview: prepareVideoEditorResultPreview,
    probe: probeVideoForEditing,
    process: processBackgroundRemovedVideo,
    runtimeStatus: videoEditorRuntimeStatus,
    currentPomodoroVideo: () => usePomodoroStore.getState().endActionVideo,
    applyPomodoroVideo: (mode, video) => (
        usePomodoroStore.getState().applyEndActionSettings(mode, video)
    ),
    createJobId: () => globalThis.crypto?.randomUUID?.()
        ?? `video-edit-${Date.now()}-${Math.random().toString(16).slice(2)}`,
};

function initialState(): VideoEditorState {
    return {
        draft: {
            ...INITIAL_VIDEO_EDITOR_DRAFT,
            crop: { ...INITIAL_VIDEO_EDITOR_DRAFT.crop },
            strokes: [],
        },
        previewSrc: '',
        tool: 'crop',
        runtime: null,
        isLoading: false,
        isChoosingOutput: false,
        isProcessing: false,
        isPreparingResultPreview: false,
        isApplyingToPomodoro: false,
        progress: null,
        error: '',
        savedPath: '',
        resultPreviewSrc: '',
        resultPreviewPlaybackState: 'idle',
        appliedToPomodoro: false,
    };
}

export function createVideoEditorStore(
    dependencies: VideoEditorDependencies = defaultDependencies,
): VideoEditorStore {
    let activeJobId: string | null = null;
    let generation = 0;

    return create<VideoEditorState & VideoEditorActions>((set, get) => {
        const reduceDraft = (action: VideoEditorAction): void => {
            set((state) => {
                if (
                    state.isLoading
                    || state.isChoosingOutput
                    || state.isProcessing
                    || state.isPreparingResultPreview
                    || state.isApplyingToPomodoro
                ) return state;

                const draft = videoEditorReducer(state.draft, action);
                if (sameRenderSettings(state.draft, draft)) return { draft };

                return {
                    draft,
                    savedPath: '',
                    resultPreviewSrc: '',
                    resultPreviewPlaybackState: 'idle',
                    appliedToPomodoro: false,
                    error: '',
                };
            });
        };

        return {
            ...initialState(),
            reset: () => {
                generation += 1;
                activeJobId = null;
                set(initialState());
            },
            refreshRuntime: async () => {
                const requestGeneration = generation;
                set({ runtime: null });
                try {
                    const runtime = await runtimeStatusWithTimeout(dependencies.runtimeStatus);
                    if (requestGeneration === generation) set({ runtime });
                } catch (error) {
                    if (requestGeneration === generation) {
                        set({
                            runtime: { ready: false, message: errorMessage(error) },
                        });
                    }
                }
            },
            attachProgressListener: () => dependencies.listenProgress((progress) => {
                get().receiveProgress(progress);
            }),
            chooseVideo: async () => {
                if (
                    get().isLoading
                    || get().isChoosingOutput
                    || get().isProcessing
                    || get().isApplyingToPomodoro
                    || get().isPreparingResultPreview
                ) return;
                const requestGeneration = generation;
                set({ error: '', isLoading: true });
                try {
                    const path = await dependencies.pickInput();
                    if (!path || requestGeneration !== generation) return;
                    const probe = await dependencies.probe(path);
                    if (requestGeneration !== generation) return;
                    const draft = videoEditorReducer(get().draft, {
                        type: 'load',
                        sourcePath: path,
                        probe,
                    });
                    set({
                        draft,
                        previewSrc: dependencies.previewSrc(path),
                        savedPath: '',
                        resultPreviewSrc: '',
                        resultPreviewPlaybackState: 'idle',
                        isPreparingResultPreview: false,
                        appliedToPomodoro: false,
                        tool: 'crop',
                    });
                } catch (error) {
                    if (requestGeneration === generation) set({ error: errorMessage(error) });
                } finally {
                    if (requestGeneration === generation) set({ isLoading: false });
                }
            },
            saveVideo: async () => {
                const state = get();
                if (
                    !state.draft.sourcePath
                    || !state.runtime?.ready
                    || state.isLoading
                    || state.isChoosingOutput
                    || state.isProcessing
                    || state.isPreparingResultPreview
                    || state.isApplyingToPomodoro
                ) return;
                const requestGeneration = generation;
                set({ error: '', isChoosingOutput: true });
                try {
                    const outputPath = await dependencies.pickOutput(state.draft.sourcePath);
                    if (!outputPath || requestGeneration !== generation) return;
                    const jobId = dependencies.createJobId();
                    activeJobId = jobId;
                    set({
                        isChoosingOutput: false,
                        isProcessing: true,
                        savedPath: '',
                        resultPreviewSrc: '',
                        resultPreviewPlaybackState: 'idle',
                        isPreparingResultPreview: false,
                        appliedToPomodoro: false,
                        progress: { jobId, percent: 0, stage: '准备视频' },
                    });
                    const result = await dependencies.process(
                        buildVideoProcessRequest(state.draft, outputPath, jobId),
                    );
                    if (requestGeneration !== generation) return;
                    activeJobId = null;
                    set({
                        savedPath: result.outputPath,
                        resultPreviewSrc: '',
                        resultPreviewPlaybackState: 'loading',
                        isProcessing: false,
                        isPreparingResultPreview: true,
                        progress: { jobId, percent: 100, stage: '处理完成' },
                    });
                    try {
                        const resultPreviewSrc = await dependencies.prepareResultPreview(
                            result.outputPath,
                        );
                        if (requestGeneration === generation) {
                            set({
                                resultPreviewSrc,
                                resultPreviewPlaybackState: 'loading',
                                isPreparingResultPreview: false,
                            });
                        }
                    } catch (error) {
                        if (requestGeneration === generation) {
                            set({
                                resultPreviewSrc: '',
                                resultPreviewPlaybackState: 'error',
                                isPreparingResultPreview: false,
                                error: `透明视频已保存，但无法准备可播放预览：${errorMessage(error)}`,
                            });
                        }
                    }
                } catch (error) {
                    if (requestGeneration === generation) set({ error: errorMessage(error) });
                } finally {
                    if (requestGeneration === generation) {
                        activeJobId = null;
                        set({
                            isChoosingOutput: false,
                            isProcessing: false,
                            isPreparingResultPreview: false,
                        });
                    }
                }
            },
            setAsPomodoroVideo: async () => {
                const state = get();
                if (
                    !state.savedPath
                    || !state.resultPreviewSrc
                    || state.resultPreviewPlaybackState !== 'ready'
                    || state.isLoading
                    || state.isChoosingOutput
                    || state.isPreparingResultPreview
                    || state.isApplyingToPomodoro
                ) return;
                const requestGeneration = generation;
                const currentVideo = dependencies.currentPomodoroVideo();
                set({
                    error: '',
                    isApplyingToPomodoro: true,
                    appliedToPomodoro: false,
                });
                try {
                    await dependencies.applyPomodoroVideo('playVideo', {
                        sourceKind: 'custom',
                        builtinVideoId:
                            currentVideo.builtinVideoId || DEFAULT_BUILTIN_POMODORO_VIDEO_ID,
                        customVideoPath: state.savedPath,
                    });
                    if (requestGeneration === generation) set({ appliedToPomodoro: true });
                } catch (error) {
                    if (requestGeneration === generation) {
                        set({ error: errorMessage(error), appliedToPomodoro: false });
                    }
                } finally {
                    if (requestGeneration === generation) set({ isApplyingToPomodoro: false });
                }
            },
            markResultPreviewReady: () => {
                if (get().resultPreviewSrc) set({ resultPreviewPlaybackState: 'ready' });
            },
            markResultPreviewError: () => {
                if (!get().resultPreviewSrc) return;
                set({ resultPreviewPlaybackState: 'error' });
            },
            receiveProgress: (progress) => {
                if (progress.jobId === activeJobId) set({ progress });
            },
            setTool: (tool) => set({ tool }),
            setCrop: (crop) => reduceDraft({ type: 'setCrop', crop }),
            setStartSeconds: (value) => reduceDraft({ type: 'setStartSeconds', value }),
            setEndSeconds: (value) => reduceDraft({ type: 'setEndSeconds', value }),
            setThreshold: (value) => reduceDraft({ type: 'setThreshold', value }),
            setBrushRadius: (value) => reduceDraft({ type: 'setBrushRadius', value }),
            beginStroke: (point) => reduceDraft({ type: 'beginStroke', point }),
            extendStroke: (point) => reduceDraft({ type: 'extendStroke', point }),
            undoStroke: () => reduceDraft({ type: 'undoStroke' }),
            clearStrokes: () => reduceDraft({ type: 'clearStrokes' }),
        };
    });
}

function sameRenderSettings(a: VideoEditorDraft, b: VideoEditorDraft): boolean {
    return a.sourcePath === b.sourcePath
        && a.probe === b.probe
        && a.crop.x === b.crop.x
        && a.crop.y === b.crop.y
        && a.crop.width === b.crop.width
        && a.crop.height === b.crop.height
        && a.startSeconds === b.startSeconds
        && a.endSeconds === b.endSeconds
        && a.threshold === b.threshold
        && sameBrushStrokes(a.strokes, b.strokes);
}

function sameBrushStrokes(
    a: VideoEditorDraft['strokes'],
    b: VideoEditorDraft['strokes'],
): boolean {
    return a.length === b.length && a.every((stroke, strokeIndex) => {
        const other = b[strokeIndex];
        return stroke.radius === other.radius
            && stroke.points.length === other.points.length
            && stroke.points.every((point, pointIndex) => (
                point.x === other.points[pointIndex].x
                && point.y === other.points[pointIndex].y
            ));
    });
}

export const useVideoEditorStore = createVideoEditorStore();

export function useVideoEditorLifecycle(): void {
    useEffect(() => {
        let active = true;
        let unlisten: (() => void) | undefined;
        const store = useVideoEditorStore.getState();
        store.reset();
        void store.refreshRuntime();
        void store.attachProgressListener().then((cleanup) => {
            if (active) unlisten = cleanup;
            else cleanup();
        });
        return () => {
            active = false;
            unlisten?.();
            useVideoEditorStore.getState().reset();
        };
    }, []);
}

function errorMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    return typeof error === 'string' ? error : '视频处理失败，请检查运行环境后重试';
}

async function runtimeStatusWithTimeout(
    runtimeStatus: () => Promise<VideoEditorRuntimeStatus>,
): Promise<VideoEditorRuntimeStatus> {
    let timeout: ReturnType<typeof globalThis.setTimeout> | undefined;
    try {
        return await Promise.race([
            runtimeStatus(),
            new Promise<never>((_, reject) => {
                timeout = globalThis.setTimeout(() => {
                    reject(new Error('视频抠图运行时检查超时，请点击重新检查'));
                }, RUNTIME_STATUS_TIMEOUT_MS);
            }),
        ]);
    } finally {
        if (timeout !== undefined) globalThis.clearTimeout(timeout);
    }
}
