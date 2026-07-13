import { describe, expect, it, vi } from 'vitest';
import {
    createVideoEditorStore,
    type VideoEditorDependencies,
} from './videoEditorStore';

const GENERATED_PATH = '/tmp/cpa-video-editor/generated/job-1/result.webm';
const EXPORTED_PATH = '/Users/xpy/Videos/cat-transparent.webm';

function dependencies(
    overrides: Partial<VideoEditorDependencies> = {},
): VideoEditorDependencies {
    return {
        listenProgress: vi.fn().mockResolvedValue(() => {}),
        pickInput: vi.fn().mockResolvedValue('/Users/xpy/Videos/cat.mp4'),
        prepareTempOutput: vi.fn().mockResolvedValue(GENERATED_PATH),
        exportGenerated: vi.fn().mockResolvedValue(EXPORTED_PATH),
        previewSrc: vi.fn((path: string) => `asset://localhost${path}`),
        probe: vi.fn().mockResolvedValue({
            width: 854,
            height: 480,
            durationSeconds: 3.5,
            frameRate: 24,
        }),
        process: vi.fn(async (request) => ({ outputPath: request.outputPath })),
        prepareResultPreview: vi.fn(async (path: string) => (
            `asset://playable${path.replace(/\.webm$/i, '.mov')}`
        )),
        runtimeStatus: vi.fn().mockResolvedValue({
            ready: true,
            message: '运行环境已就绪',
        }),
        currentPomodoroVideo: vi.fn().mockReturnValue({
            sourceKind: 'builtin',
            builtinVideoId: 'qianqian',
            customVideoPath: '',
        }),
        applyPomodoroVideo: vi.fn().mockResolvedValue(undefined),
        createJobId: vi.fn().mockReturnValue('job-1'),
        ...overrides,
    };
}

async function generateEditedVideo(store: ReturnType<typeof createVideoEditorStore>): Promise<void> {
    await store.getState().refreshRuntime();
    await store.getState().chooseVideo();
    store.getState().setCrop({ x: 0, y: 0, width: 400, height: 480 });
    store.getState().setEndSeconds(2.5);
    store.getState().setThreshold(64);
    store.getState().beginStroke({ x: 0.25, y: 0.25 });
    store.getState().extendStroke({ x: 0.5, y: 0.5 });
    await store.getState().generateVideo();
    store.getState().markResultPreviewReady();
}

describe('video editor store workflow', () => {
    it('generates a temporary preview before export and exports without reprocessing', async () => {
        const prepareTempOutput = vi.fn().mockResolvedValue(
            '/tmp/cpa-video-editor/generated/job-1/result.webm',
        );
        const exportGenerated = vi.fn().mockResolvedValue(
            '/Users/xpy/Videos/cat-transparent.webm',
        );
        const deps = dependencies({
            prepareTempOutput,
            exportGenerated,
            process: vi.fn(async (request) => ({ outputPath: request.outputPath })),
        } as Partial<VideoEditorDependencies>);
        const store = createVideoEditorStore(deps);
        await store.getState().refreshRuntime();
        await store.getState().chooseVideo();

        await store.getState().generateVideo();

        expect(prepareTempOutput).toHaveBeenCalledWith('job-1');
        expect(deps.process).toHaveBeenCalledTimes(1);
        expect(deps.process).toHaveBeenCalledWith(expect.objectContaining({
            outputPath: '/tmp/cpa-video-editor/generated/job-1/result.webm',
        }));
        expect(deps.prepareResultPreview).toHaveBeenCalledWith(
            '/tmp/cpa-video-editor/generated/job-1/result.webm',
        );
        expect(store.getState()).toMatchObject({
            generatedPath: '/tmp/cpa-video-editor/generated/job-1/result.webm',
            exportedPath: '',
        });

        await store.getState().exportVideo();

        expect(exportGenerated).toHaveBeenCalledWith(
            '/tmp/cpa-video-editor/generated/job-1/result.webm',
            '/Users/xpy/Videos/cat.mp4',
        );
        expect(deps.process).toHaveBeenCalledTimes(1);
        expect(deps.prepareResultPreview).toHaveBeenCalledTimes(1);
        expect(store.getState().exportedPath).toBe('/Users/xpy/Videos/cat-transparent.webm');
    });

    it('owns import, edit and temporary transparent-video generation state', async () => {
        const deps = dependencies();
        const store = createVideoEditorStore(deps);

        await generateEditedVideo(store);

        expect(deps.process).toHaveBeenCalledWith({
            jobId: 'job-1',
            inputPath: '/Users/xpy/Videos/cat.mp4',
            outputPath: GENERATED_PATH,
            crop: { x: 0, y: 0, width: 400, height: 480 },
            startSeconds: 0,
            endSeconds: 2.5,
            threshold: 64,
            brushStrokes: [{
                radius: 0.03,
                points: [{ x: 0.25, y: 0.25 }, { x: 0.5, y: 0.5 }],
            }],
        });
        expect(store.getState()).toMatchObject({
            previewSrc: 'asset://localhost/Users/xpy/Videos/cat.mp4',
            generatedPath: GENERATED_PATH,
            exportedPath: '',
            resultPreviewSrc: 'asset://playable/tmp/cpa-video-editor/generated/job-1/result.mov',
            isPreparingResultPreview: false,
            isProcessing: false,
            error: '',
        });
    });

    it('clears a saved-result preview when importing a different source', async () => {
        const deps = dependencies();
        const store = createVideoEditorStore(deps);
        await generateEditedVideo(store);
        vi.mocked(deps.pickInput).mockResolvedValue('/Users/xpy/Videos/dog.mp4');

        await store.getState().chooseVideo();

        expect(store.getState().previewSrc).toBe('asset://localhost/Users/xpy/Videos/dog.mp4');
        expect(store.getState().generatedPath).toBe('');
        expect(store.getState().exportedPath).toBe('');
        expect(store.getState().resultPreviewSrc).toBe('');
    });

    it('clears the previous result preview while a replacement render is running', async () => {
        const deps = dependencies();
        const store = createVideoEditorStore(deps);
        await generateEditedVideo(store);
        let finish!: (result: { outputPath: string }) => void;
        vi.mocked(deps.prepareTempOutput).mockResolvedValue('/tmp/cpa-video-editor/generated/job-2/result.webm');
        vi.mocked(deps.process).mockReturnValue(new Promise((resolve) => { finish = resolve; }));

        const pending = store.getState().generateVideo();
        await vi.waitFor(() => expect(deps.process).toHaveBeenCalledTimes(2));

        expect(store.getState().generatedPath).toBe('');
        expect(store.getState().resultPreviewSrc).toBe('');
        finish({ outputPath: '/tmp/cpa-video-editor/generated/job-2/result.webm' });
        await pending;
        expect(store.getState().resultPreviewSrc).toBe(
            'asset://playable/tmp/cpa-video-editor/generated/job-2/result.mov',
        );
    });

    it('opens only one export workflow while the output picker is pending', async () => {
        let finishPick!: (path: string | null) => void;
        const deps = dependencies({
            exportGenerated: vi.fn(() => new Promise<string | null>((resolve) => {
                finishPick = resolve;
            })),
        });
        const store = createVideoEditorStore(deps);
        await generateEditedVideo(store);

        const first = store.getState().exportVideo();
        await vi.waitFor(() => expect(store.getState().isChoosingOutput).toBe(true));
        const second = store.getState().exportVideo();
        store.getState().setThreshold(200);

        expect(deps.exportGenerated).toHaveBeenCalledTimes(1);
        expect(store.getState().draft.threshold).toBe(64);
        finishPick(null);
        await Promise.all([first, second]);
        expect(store.getState().isChoosingOutput).toBe(false);
        expect(deps.process).toHaveBeenCalledTimes(1);
        expect(store.getState().generatedPath).toBe(GENERATED_PATH);
    });

    it('invalidates a saved result after an output-affecting edit', async () => {
        const deps = dependencies();
        const store = createVideoEditorStore(deps);
        await generateEditedVideo(store);
        await store.getState().exportVideo();
        await store.getState().setAsPomodoroVideo();

        store.getState().setThreshold(96);

        expect(store.getState()).toMatchObject({
            generatedPath: '',
            exportedPath: '',
            resultPreviewSrc: '',
            appliedToPomodoro: false,
            error: '',
        });
        await store.getState().setAsPomodoroVideo();
        expect(deps.applyPomodoroVideo).toHaveBeenCalledTimes(1);
    });

    it('keeps a saved result when an edit does not change rendered output', async () => {
        const store = createVideoEditorStore(dependencies());
        await generateEditedVideo(store);

        store.getState().setThreshold(64);
        store.getState().setBrushRadius(0.1);

        expect(store.getState()).toMatchObject({
            generatedPath: GENERATED_PATH,
            resultPreviewSrc: 'asset://playable/tmp/cpa-video-editor/generated/job-1/result.mov',
        });
    });

    it('blocks draft edits while a render is in flight', async () => {
        let finish!: (result: { outputPath: string }) => void;
        const deps = dependencies({
            process: vi.fn(() => new Promise<{ outputPath: string }>((resolve) => {
                finish = resolve;
            })),
        });
        const store = createVideoEditorStore(deps);
        await store.getState().refreshRuntime();
        await store.getState().chooseVideo();
        const originalThreshold = store.getState().draft.threshold;

        const pending = store.getState().generateVideo();
        await vi.waitFor(() => expect(store.getState().isProcessing).toBe(true));
        store.getState().setThreshold(200);

        expect(store.getState().draft.threshold).toBe(originalThreshold);
        finish({ outputPath: GENERATED_PATH });
        await pending;
    });

    it('locks the previous draft while a replacement video is being probed', async () => {
        let finishProbe!: (probe: {
            width: number;
            height: number;
            durationSeconds: number;
            frameRate: number;
        }) => void;
        const deps = dependencies();
        const store = createVideoEditorStore(deps);
        await generateEditedVideo(store);
        vi.mocked(deps.pickInput).mockResolvedValue('/Users/xpy/Videos/dog.mp4');
        vi.mocked(deps.probe).mockImplementationOnce(() => new Promise((resolve) => {
            finishProbe = resolve;
        }));

        const choosing = store.getState().chooseVideo();
        await vi.waitFor(() => expect(store.getState().isLoading).toBe(true));
        await store.getState().generateVideo();
        await store.getState().setAsPomodoroVideo();
        store.getState().setThreshold(200);

        expect(deps.process).toHaveBeenCalledTimes(1);
        expect(deps.applyPomodoroVideo).not.toHaveBeenCalled();
        expect(store.getState().draft.threshold).toBe(64);

        finishProbe({ width: 640, height: 360, durationSeconds: 2, frameRate: 30 });
        await choosing;
        expect(store.getState()).toMatchObject({
            isLoading: false,
            generatedPath: '',
            exportedPath: '',
            resultPreviewSrc: '',
        });
        expect(store.getState().draft.sourcePath).toBe('/Users/xpy/Videos/dog.mp4');
    });

    it('blocks Pomodoro selection until the generated video has been exported', async () => {
        let finishPreview!: (src: string) => void;
        const deps = dependencies({
            prepareResultPreview: vi.fn(() => new Promise<string>((resolve) => {
                finishPreview = resolve;
            })),
        });
        const store = createVideoEditorStore(deps);
        await store.getState().refreshRuntime();
        await store.getState().chooseVideo();

        const pending = store.getState().generateVideo();
        await vi.waitFor(() => expect(deps.prepareResultPreview).toHaveBeenCalledTimes(1));

        expect(store.getState().generatedPath).toBe(GENERATED_PATH);
        expect(store.getState().isPreparingResultPreview).toBe(true);
        expect(store.getState().resultPreviewSrc).toBe('');
        await store.getState().setAsPomodoroVideo();
        expect(deps.applyPomodoroVideo).not.toHaveBeenCalled();

        finishPreview('asset://localhost/cache/cat-transparent.mov');
        await pending;
        expect(store.getState().isPreparingResultPreview).toBe(false);
        expect(store.getState().resultPreviewSrc).toBe(
            'asset://localhost/cache/cat-transparent.mov',
        );
        await store.getState().setAsPomodoroVideo();
        expect(deps.applyPomodoroVideo).not.toHaveBeenCalled();

        await store.getState().exportVideo();
        await store.getState().setAsPomodoroVideo();
        expect(deps.applyPomodoroVideo).toHaveBeenCalledTimes(1);
    });

    it('keeps the generated path exportable when playable-preview preparation fails', async () => {
        const deps = dependencies({
            prepareResultPreview: vi.fn().mockRejectedValue(
                new Error('HEVC Alpha 转换失败'),
            ),
        });
        const store = createVideoEditorStore(deps);

        await generateEditedVideo(store);

        expect(store.getState().generatedPath).toBe(GENERATED_PATH);
        expect(store.getState().resultPreviewSrc).toBe('');
        expect(store.getState().isPreparingResultPreview).toBe(false);
        expect(store.getState().error).toBe(
            '透明视频已生成，但无法准备可播放预览：HEVC Alpha 转换失败',
        );
        await store.getState().exportVideo();
        expect(store.getState().exportedPath).toBe(EXPORTED_PATH);
        await store.getState().setAsPomodoroVideo();
        expect(deps.applyPomodoroVideo).toHaveBeenCalledWith('playVideo', {
            sourceKind: 'custom',
            builtinVideoId: 'qianqian',
            customVideoPath: EXPORTED_PATH,
        });
    });

    it('shows success only after the authoritative Pomodoro setting is confirmed', async () => {
        let confirm!: () => void;
        const applyPomodoroVideo = vi.fn(() => new Promise<void>((resolve) => { confirm = resolve; }));
        const store = createVideoEditorStore(dependencies({ applyPomodoroVideo }));
        await generateEditedVideo(store);
        await store.getState().exportVideo();

        const pending = store.getState().setAsPomodoroVideo();

        expect(store.getState().isApplyingToPomodoro).toBe(true);
        expect(store.getState().appliedToPomodoro).toBe(false);
        confirm();
        await pending;

        expect(applyPomodoroVideo).toHaveBeenCalledWith('playVideo', {
            sourceKind: 'custom',
            builtinVideoId: 'qianqian',
            customVideoPath: '/Users/xpy/Videos/cat-transparent.webm',
        });
        expect(store.getState().isApplyingToPomodoro).toBe(false);
        expect(store.getState().appliedToPomodoro).toBe(true);
    });

    it('surfaces a rejected Pomodoro setting without showing false success', async () => {
        const store = createVideoEditorStore(dependencies({
            applyPomodoroVideo: vi.fn().mockRejectedValue(new Error('主窗口保存失败')),
        }));
        await generateEditedVideo(store);
        await store.getState().exportVideo();

        await store.getState().setAsPomodoroVideo();

        expect(store.getState().appliedToPomodoro).toBe(false);
        expect(store.getState().isApplyingToPomodoro).toBe(false);
        expect(store.getState().error).toBe('主窗口保存失败');
    });

    it('does not let an old async workflow repopulate a reset editor', async () => {
        let finishRuntime!: (value: { ready: boolean; message: string }) => void;
        const store = createVideoEditorStore(dependencies({
            runtimeStatus: vi.fn(() => new Promise<{ ready: boolean; message: string }>((resolve) => {
                finishRuntime = resolve;
            })),
        }));

        const pending = store.getState().refreshRuntime();
        store.getState().reset();
        finishRuntime({ ready: true, message: '旧窗口运行时' });
        await pending;

        expect(store.getState().runtime).toBeNull();
    });
});
