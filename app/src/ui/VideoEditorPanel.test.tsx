import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePomodoroStore } from '../domain/pomodoro';
import { VideoEditorPanel } from './VideoEditorPanel';

const native = vi.hoisted(() => ({
    listenProgress: vi.fn(),
    pickInput: vi.fn(),
    pickOutput: vi.fn(),
    previewSrc: vi.fn(),
    probe: vi.fn(),
    process: vi.fn(),
    runtimeStatus: vi.fn(),
}));

vi.mock('../domain/videoEditorFiles', () => ({
    listenVideoEditorProgress: native.listenProgress,
    pickEditedVideoOutputPath: native.pickOutput,
    pickVideoForEditing: native.pickInput,
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
    native.probe.mockReset();
    native.process.mockReset();
    native.runtimeStatus.mockReset();

    native.listenProgress.mockResolvedValue(() => {});
    native.runtimeStatus.mockResolvedValue({ ready: true, message: '运行环境已就绪' });
    native.pickInput.mockResolvedValue('/Users/xpy/Videos/cat.mp4');
    native.pickOutput.mockResolvedValue('/Users/xpy/Videos/cat-transparent.webm');
    native.previewSrc.mockReturnValue('asset://localhost/Users/xpy/Videos/cat.mp4');
    native.probe.mockResolvedValue({ width: 854, height: 480, durationSeconds: 3.5, frameRate: 24 });
    native.process.mockResolvedValue({ outputPath: '/Users/xpy/Videos/cat-transparent.webm' });

    usePomodoroStore.setState({
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
        fireEvent.click(screen.getByRole('button', { name: '设为番茄钟结束视频' }));

        expect(usePomodoroStore.getState().endActionMode).toBe('playVideo');
        expect(usePomodoroStore.getState().endActionVideo).toEqual({
            sourceKind: 'custom',
            builtinVideoId: 'qianqian',
            customVideoPath: '/Users/xpy/Videos/cat-transparent.webm',
        });
        expect(screen.getByText('已设为番茄钟结束视频')).toBeTruthy();
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
});
