import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePomodoroStore } from '../domain/pomodoro';
import { VideoEditorPanel } from './VideoEditorPanel';

const applyEndActionSettings = usePomodoroStore.getState().applyEndActionSettings;

const native = vi.hoisted(() => ({
    listenProgress: vi.fn(),
    pickInput: vi.fn(),
    pickOutput: vi.fn(),
    previewSrc: vi.fn(),
    prepareResultPreview: vi.fn(),
    probe: vi.fn(),
    process: vi.fn(),
    runtimeStatus: vi.fn(),
}));

vi.mock('../domain/videoEditorFiles', () => ({
    listenVideoEditorProgress: native.listenProgress,
    pickEditedVideoOutputPath: native.pickOutput,
    pickVideoForEditing: native.pickInput,
    prepareVideoEditorResultPreview: native.prepareResultPreview,
    probeVideoForEditing: native.probe,
    processBackgroundRemovedVideo: native.process,
    videoEditorPreviewSrc: native.previewSrc,
    videoEditorRuntimeStatus: native.runtimeStatus,
}));

beforeEach(() => {
    native.listenProgress.mockReset();
    native.pickInput.mockReset();
    native.pickOutput.mockReset();
    native.previewSrc.mockReset();
    native.prepareResultPreview.mockReset();
    native.probe.mockReset();
    native.process.mockReset();
    native.runtimeStatus.mockReset();

    native.listenProgress.mockResolvedValue(() => {});
    native.runtimeStatus.mockResolvedValue({ ready: true, message: '运行环境已就绪' });
    native.pickInput.mockResolvedValue('/Users/xpy/Videos/cat.mp4');
    native.pickOutput.mockResolvedValue('/Users/xpy/Videos/cat-transparent.webm');
    native.previewSrc.mockImplementation((path: string) => `asset://localhost${path}`);
    native.prepareResultPreview.mockResolvedValue(
        'asset://localhost/Users/xpy/Library/Caches/app/alpha-videos/cat-transparent.mov',
    );
    native.probe.mockResolvedValue({ width: 854, height: 480, durationSeconds: 3.5, frameRate: 24 });
    native.process.mockResolvedValue({ outputPath: '/Users/xpy/Videos/cat-transparent.webm' });

    usePomodoroStore.setState({
        applyEndActionSettings,
        endActionMode: 'playVideo',
        endActionVideo: {
            sourceKind: 'builtin',
            builtinVideoId: 'qianqian',
            customVideoPath: '',
        },
    });
});

afterEach(cleanup);

async function loadVideo(): Promise<void> {
    render(<VideoEditorPanel />);
    await waitFor(() => expect(native.runtimeStatus).toHaveBeenCalledTimes(1));
    await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: '导入视频' }));
    });
    await waitFor(() => expect(screen.getByLabelText('视频预览')).toBeTruthy());
}

describe('VideoEditorPanel', () => {
    it('shows runtime readiness and imports a probed video', async () => {
        await loadVideo();

        expect(native.pickInput).toHaveBeenCalledTimes(1);
        expect(native.probe).toHaveBeenCalledWith('/Users/xpy/Videos/cat.mp4');
        expect(screen.getByText('854 × 480')).toBeTruthy();
        expect(screen.getByText('3.50 秒 · 24.00 FPS')).toBeTruthy();
        expect(screen.getByLabelText('视频预览').getAttribute('src')).toBe(
            'asset://localhost/Users/xpy/Videos/cat.mp4',
        );
    });

    it('saves crop, soft threshold and brush edits, then sets the result as the Pomodoro video', async () => {
        await loadVideo();

        fireEvent.change(screen.getByLabelText('裁剪宽度'), { target: { value: '400' } });
        fireEvent.blur(screen.getByLabelText('裁剪宽度'));
        fireEvent.change(screen.getByLabelText('结束时间'), { target: { value: '2.5' } });
        fireEvent.blur(screen.getByLabelText('结束时间'));
        fireEvent.change(screen.getByLabelText('背景清除阈值'), { target: { value: '64' } });
        fireEvent.click(screen.getByRole('button', { name: '剔除画笔' }));

        const stage = screen.getByLabelText('视频编辑预览区');
        Object.defineProperty(stage, 'getBoundingClientRect', {
            configurable: true,
            value: () => ({ left: 10, top: 20, width: 400, height: 200, right: 410, bottom: 220 }),
        });
        fireEvent.pointerDown(stage, { button: 0, pointerId: 7, clientX: 110, clientY: 70 });
        fireEvent.pointerMove(stage, { pointerId: 7, clientX: 210, clientY: 120 });
        fireEvent.pointerUp(stage, { pointerId: 7, clientX: 210, clientY: 120 });

        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: '保存透明视频' }));
        });

        expect(native.process).toHaveBeenCalledTimes(1);
        const request = native.process.mock.calls[0][0];
        expect(request).toMatchObject({
            inputPath: '/Users/xpy/Videos/cat.mp4',
            outputPath: '/Users/xpy/Videos/cat-transparent.webm',
            crop: { x: 0, y: 0, width: 400, height: 480 },
            startSeconds: 0,
            endSeconds: 2.5,
            threshold: 64,
        });
        expect(request.brushStrokes).toEqual([{
            radius: 0.03,
            points: [{ x: 0.25, y: 0.25 }, { x: 0.5, y: 0.5 }],
        }]);

        expect(await screen.findByText('cat-transparent.webm')).toBeTruthy();
        const resultPreview = screen.getByLabelText('透明成品视频预览');
        expect(resultPreview.getAttribute('src')).toBe(
            'asset://localhost/Users/xpy/Library/Caches/app/alpha-videos/cat-transparent.mov',
        );
        expect(resultPreview.parentElement?.className).toContain('video-editor-alpha-stage');
        fireEvent.canPlay(resultPreview);
        fireEvent.click(screen.getByRole('button', { name: '设为番茄钟结束视频' }));
        expect(await screen.findByText('已设为番茄钟结束视频')).toBeTruthy();

        expect(usePomodoroStore.getState().endActionMode).toBe('playVideo');
        expect(usePomodoroStore.getState().endActionVideo).toEqual({
            sourceKind: 'custom',
            builtinVideoId: 'qianqian',
            customVideoPath: '/Users/xpy/Videos/cat-transparent.webm',
        });
    });

    it('renders the brush preview in the same short-edge pixel geometry as the native mask', async () => {
        await loadVideo();

        fireEvent.change(screen.getByLabelText('裁剪宽度'), { target: { value: '200' } });
        fireEvent.blur(screen.getByLabelText('裁剪宽度'));
        fireEvent.change(screen.getByLabelText('裁剪高度'), { target: { value: '400' } });
        fireEvent.blur(screen.getByLabelText('裁剪高度'));
        fireEvent.click(screen.getByRole('button', { name: '剔除画笔' }));

        const stage = screen.getByLabelText('视频编辑预览区');
        expect(stage.style.aspectRatio).toBe('200 / 400');
        expect(stage.style.maxWidth).toBe('min(100%, 140px)');
        Object.defineProperty(stage, 'getBoundingClientRect', {
            configurable: true,
            value: () => ({ left: 0, top: 0, width: 140, height: 280, right: 140, bottom: 280 }),
        });
        fireEvent.pointerDown(stage, { button: 0, pointerId: 9, clientX: 35, clientY: 70 });
        fireEvent.pointerMove(stage, { pointerId: 9, clientX: 70, clientY: 140 });
        fireEvent.pointerUp(stage, { pointerId: 9, clientX: 70, clientY: 140 });

        const overlay = document.querySelector('.video-editor-brush-overlay');
        const stroke = overlay?.querySelector('polyline');
        expect(overlay?.getAttribute('viewBox')).toBe('0 0 200 400');
        expect(stroke?.getAttribute('points')).toBe('50,100 100,200');
        expect(stroke?.getAttribute('stroke-width')).toBe('12');
    });

    it('requires a new save after changing rendered output settings', async () => {
        await loadVideo();
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: '保存透明视频' }));
        });
        expect(await screen.findByText('cat-transparent.webm')).toBeTruthy();

        fireEvent.change(screen.getByLabelText('背景清除阈值'), { target: { value: '80' } });

        expect(screen.queryByText('cat-transparent.webm')).toBeNull();
        expect(screen.queryByLabelText('透明成品视频预览')).toBeNull();
        expect(screen.queryByRole('button', { name: '设为番茄钟结束视频' })).toBeNull();
    });

    it('locks editing and old-result actions while probing a replacement video', async () => {
        let finishProbe!: (probe: {
            width: number;
            height: number;
            durationSeconds: number;
            frameRate: number;
        }) => void;
        await loadVideo();
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: '保存透明视频' }));
        });
        fireEvent.canPlay(await screen.findByLabelText('透明成品视频预览'));
        native.pickInput.mockResolvedValue('/Users/xpy/Videos/dog.mp4');
        native.probe.mockImplementationOnce(() => new Promise((resolve) => {
            finishProbe = resolve;
        }));

        fireEvent.click(screen.getByRole('button', { name: '导入视频' }));
        await waitFor(() => expect(native.probe).toHaveBeenCalledTimes(2));

        expect(screen.getByLabelText('裁剪宽度')).toHaveProperty('disabled', true);
        expect(screen.getByRole('button', { name: '保存透明视频' })).toHaveProperty(
            'disabled',
            true,
        );
        expect(screen.getByRole('button', { name: '设为番茄钟结束视频' })).toHaveProperty(
            'disabled',
            true,
        );

        await act(async () => {
            finishProbe({ width: 640, height: 360, durationSeconds: 2, frameRate: 30 });
        });
        await waitFor(() => expect(screen.getByText('640 × 360')).toBeTruthy());
    });

    it('does not show Pomodoro success before the authoritative action resolves', async () => {
        let confirm!: () => void;
        usePomodoroStore.setState({
            applyEndActionSettings: vi.fn(() => new Promise<void>((resolve) => { confirm = resolve; })),
        });
        await loadVideo();
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: '保存透明视频' }));
        });
        fireEvent.canPlay(await screen.findByLabelText('透明成品视频预览'));

        fireEvent.click(screen.getByRole('button', { name: '设为番茄钟结束视频' }));

        expect(screen.getByRole('button', { name: '设为番茄钟结束视频' }).textContent).toBe('设置中…');
        expect(screen.queryByText('已设为番茄钟结束视频')).toBeNull();
        confirm();

        expect(await screen.findByText('已设为番茄钟结束视频')).toBeTruthy();
    });

    it('shows an authoritative Pomodoro setting failure without false success', async () => {
        usePomodoroStore.setState({
            applyEndActionSettings: vi.fn().mockRejectedValue(new Error('主窗口保存失败')),
        });
        await loadVideo();
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: '保存透明视频' }));
        });
        fireEvent.canPlay(await screen.findByLabelText('透明成品视频预览'));

        fireEvent.click(screen.getByRole('button', { name: '设为番茄钟结束视频' }));

        expect((await screen.findByRole('alert')).textContent).toContain('主窗口保存失败');
        expect(screen.queryByText('已设为番茄钟结束视频')).toBeNull();
    });

    it('keeps Pomodoro selection disabled while preparing a playable result preview', async () => {
        let finishPreview!: (src: string) => void;
        native.prepareResultPreview.mockReturnValue(new Promise((resolve) => {
            finishPreview = resolve;
        }));
        await loadVideo();

        fireEvent.click(screen.getByRole('button', { name: '保存透明视频' }));
        await waitFor(() => expect(native.prepareResultPreview).toHaveBeenCalledTimes(1));

        expect(screen.getByText('正在准备可播放的透明成品预览…')).toBeTruthy();
        expect(screen.queryByLabelText('透明成品视频预览')).toBeNull();
        expect(screen.getByRole('button', { name: '设为番茄钟结束视频' })).toHaveProperty(
            'disabled',
            true,
        );

        finishPreview('asset://localhost/cache/cat-transparent.mov');
        const preview = await screen.findByLabelText('透明成品视频预览');
        expect(preview.getAttribute('src')).toBe(
            'asset://localhost/cache/cat-transparent.mov',
        );
        expect(preview.getAttribute('preload')).toBe('auto');
        expect(screen.getByRole('button', { name: '设为番茄钟结束视频' })).toHaveProperty(
            'disabled',
            true,
        );
        fireEvent.loadedMetadata(preview);
        expect(screen.getByRole('button', { name: '设为番茄钟结束视频' })).toHaveProperty(
            'disabled',
            true,
        );
        fireEvent.canPlay(preview);
        expect(screen.getByRole('button', { name: '设为番茄钟结束视频' })).toHaveProperty(
            'disabled',
            false,
        );
    });

    it('blocks Pomodoro selection when the compatible preview cannot play', async () => {
        await loadVideo();
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: '保存透明视频' }));
        });

        fireEvent.error(await screen.findByLabelText('透明成品视频预览'));

        expect((await screen.findByRole('alert')).textContent).toContain(
            '透明成品已保存，但当前系统无法播放兼容预览',
        );
        expect(screen.getByRole('button', { name: '设为番茄钟结束视频' })).toHaveProperty(
            'disabled',
            true,
        );
    });

    it('keeps the saved file but blocks Pomodoro selection when result preparation fails', async () => {
        native.prepareResultPreview.mockRejectedValue(new Error('HEVC Alpha 转换失败'));
        await loadVideo();

        fireEvent.click(screen.getByRole('button', { name: '保存透明视频' }));

        expect(await screen.findByText('cat-transparent.webm')).toBeTruthy();
        expect((await screen.findByRole('alert')).textContent).toContain(
            '透明视频已保存，但无法准备可播放预览：HEVC Alpha 转换失败',
        );
        expect(screen.queryByLabelText('透明成品视频预览')).toBeNull();
        expect(screen.getByRole('button', { name: '设为番茄钟结束视频' })).toHaveProperty(
            'disabled',
            true,
        );
    });

    it('lets users type a multi-digit number before crop normalisation runs', async () => {
        await loadVideo();
        const width = screen.getByLabelText('裁剪宽度');

        fireEvent.focus(width);
        fireEvent.change(width, { target: { value: '' } });
        expect(width).toHaveProperty('value', '');
        fireEvent.change(width, { target: { value: '3' } });
        expect(width).toHaveProperty('value', '3');
        fireEvent.change(width, { target: { value: '32' } });
        fireEvent.change(width, { target: { value: '320' } });

        expect(width).toHaveProperty('value', '320');
        fireEvent.blur(width);
        expect(width).toHaveProperty('value', '320');
    });

    it('provides a playback mode that does not accidentally paint over video controls', async () => {
        await loadVideo();

        fireEvent.click(screen.getByRole('button', { name: '播放预览' }));
        const stage = screen.getByLabelText('视频编辑预览区');
        Object.defineProperty(stage, 'getBoundingClientRect', {
            configurable: true,
            value: () => ({ left: 0, top: 0, width: 400, height: 200, right: 400, bottom: 200 }),
        });
        fireEvent.pointerDown(stage, { button: 0, pointerId: 8, clientX: 100, clientY: 50 });
        fireEvent.pointerMove(stage, { pointerId: 8, clientX: 200, clientY: 100 });
        fireEvent.pointerUp(stage, { pointerId: 8, clientX: 200, clientY: 100 });

        expect(screen.getByText('0 笔')).toBeTruthy();
        expect(stage.className).toContain('tool-preview');
    });

    it('disables processing when the native runtime is unavailable', async () => {
        native.runtimeStatus.mockResolvedValue({
            ready: false,
            message: '未找到 BackgroundRemover，请先安装运行环境',
        });
        await loadVideo();

        expect(screen.getByText('未找到 BackgroundRemover，请先安装运行环境')).toBeTruthy();
        expect(screen.getByRole('button', { name: '保存透明视频' })).toHaveProperty('disabled', true);
    });

    it('leaves the checking state when the native runtime probe never answers', async () => {
        vi.useFakeTimers();
        native.runtimeStatus.mockReturnValue(new Promise(() => {}));

        try {
            render(<VideoEditorPanel />);
            await act(async () => {
                await vi.advanceTimersByTimeAsync(10_000);
            });

            expect(screen.queryByText('正在检查 BackgroundRemover…')).toBeNull();
            expect(screen.getByText('视频抠图运行时检查超时，请点击重新检查')).toBeTruthy();
        } finally {
            vi.useRealTimers();
        }
    });

    it('lets the user retry a timed-out runtime probe without restarting the app', async () => {
        vi.useFakeTimers();
        native.runtimeStatus
            .mockImplementationOnce(() => new Promise(() => {}))
            .mockResolvedValueOnce({ ready: true, message: '内置 macos-arm64 payload 已就绪' });

        try {
            render(<VideoEditorPanel />);
            await act(async () => {
                await vi.advanceTimersByTimeAsync(10_000);
            });

            await act(async () => {
                fireEvent.click(screen.getByRole('button', { name: '重新检查运行环境' }));
            });

            expect(native.runtimeStatus).toHaveBeenCalledTimes(2);
            expect(screen.getByText('内置 macos-arm64 payload 已就绪')).toBeTruthy();
        } finally {
            vi.useRealTimers();
        }
    });

    it('shows a rejected native runtime probe instead of checking forever', async () => {
        native.runtimeStatus.mockRejectedValue(new Error('Tauri invoke 被拒绝'));

        render(<VideoEditorPanel />);

        expect(await screen.findByText('Tauri invoke 被拒绝')).toBeTruthy();
        expect(screen.queryByText('正在检查 BackgroundRemover…')).toBeNull();
    });

    it('shows processing failures without losing the current edits', async () => {
        native.process.mockRejectedValue(new Error('BackgroundRemover 执行失败'));
        await loadVideo();

        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: '保存透明视频' }));
        });

        expect((await screen.findByRole('alert')).textContent).toContain('BackgroundRemover 执行失败');
        expect(screen.getByLabelText('视频预览')).toBeTruthy();
    });

    it('shows progress only for the currently running processing job', async () => {
        let progressHandler: ((event: { jobId: string; percent: number; stage: string }) => void) | undefined;
        native.listenProgress.mockImplementation(async (handler) => {
            progressHandler = handler;
            return () => {};
        });
        let finish: ((value: { outputPath: string }) => void) | undefined;
        native.process.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
        await loadVideo();

        fireEvent.click(screen.getByRole('button', { name: '保存透明视频' }));
        await waitFor(() => expect(native.process).toHaveBeenCalledTimes(1));
        const jobId = native.process.mock.calls[0][0].jobId as string;

        expect(screen.getByLabelText('裁剪宽度')).toHaveProperty('disabled', true);
        expect(screen.getByLabelText('背景清除阈值')).toHaveProperty('disabled', true);
        expect(screen.getByLabelText('画笔大小')).toHaveProperty('disabled', true);

        act(() => {
            progressHandler?.({ jobId: 'stale-job', percent: 90, stage: '错误任务' });
            progressHandler?.({ jobId, percent: 40, stage: '正在进行 AI 抠图' });
        });

        expect(screen.queryByText('错误任务')).toBeNull();
        expect(screen.getByText('正在进行 AI 抠图')).toBeTruthy();
        expect(screen.getByLabelText('视频处理进度')).toHaveProperty('value', 40);

        await act(async () => {
            finish?.({ outputPath: '/Users/xpy/Videos/cat-transparent.webm' });
        });
    });

    it('unsubscribes from native progress when the panel is finally unmounted', async () => {
        const unlisten = vi.fn();
        native.listenProgress.mockResolvedValue(unlisten);

        const view = render(<VideoEditorPanel />);
        await waitFor(() => expect(native.listenProgress).toHaveBeenCalledTimes(1));
        view.unmount();

        await waitFor(() => expect(unlisten).toHaveBeenCalledTimes(1));
    });

    it('uses a checkerboard behind the transparent result preview', () => {
        const here = path.dirname(fileURLToPath(import.meta.url));
        const css = readFileSync(path.join(here, 'VideoEditorPanel.css'), 'utf8');
        const rule = css.match(
            /\.video-editor-stage\s*,\s*\.video-editor-alpha-stage\s*\{[^}]*\}/,
        )?.[0] ?? '';

        expect(rule).toMatch(/background-color:/);
        expect(rule).toMatch(/background-image:\s*linear-gradient/);
        expect(rule).toMatch(/background-size:/);
    });
});
