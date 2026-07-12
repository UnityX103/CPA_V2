import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { VideoProcessRequest } from './videoEditor';
import {
    listenVideoEditorProgress,
    pickEditedVideoOutputPath,
    pickVideoForEditing,
    probeVideoForEditing,
    processBackgroundRemovedVideo,
    videoEditorRuntimeStatus,
    videoEditorPreviewSrc,
} from './videoEditorFiles';

const { convertFileSrcMock, invokeMock, listenMock, openMock, saveMock } = vi.hoisted(() => ({
    convertFileSrcMock: vi.fn(),
    invokeMock: vi.fn(),
    listenMock: vi.fn(),
    openMock: vi.fn(),
    saveMock: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({
    convertFileSrc: convertFileSrcMock,
    invoke: invokeMock,
}));

vi.mock('@tauri-apps/api/event', () => ({ listen: listenMock }));

vi.mock('@tauri-apps/plugin-dialog', () => ({
    open: openMock,
    save: saveMock,
}));

describe('video editor native adapter', () => {
    beforeEach(() => {
        convertFileSrcMock.mockReset();
        invokeMock.mockReset();
        listenMock.mockReset();
        openMock.mockReset();
        saveMock.mockReset();
    });

    it('picks a common video format for editing', async () => {
        openMock.mockResolvedValue('/Users/xpy/Videos/cat.mp4');

        await expect(pickVideoForEditing()).resolves.toBe('/Users/xpy/Videos/cat.mp4');
        expect(openMock).toHaveBeenCalledWith({
            multiple: false,
            directory: false,
            filters: [{ name: '视频文件', extensions: ['mp4', 'mov', 'webm', 'm4v', 'ogv', 'ogg'] }],
        });
    });

    it('probes video metadata through the native command', async () => {
        invokeMock.mockResolvedValue({ width: 854, height: 480, durationSeconds: 3.5, frameRate: 24 });

        await expect(probeVideoForEditing('/Users/xpy/Videos/cat.mp4')).resolves.toEqual({
            width: 854,
            height: 480,
            durationSeconds: 3.5,
            frameRate: 24,
        });
        expect(invokeMock).toHaveBeenCalledWith('probe_video_for_editing', {
            path: '/Users/xpy/Videos/cat.mp4',
        });
    });

    it('creates a local preview URL without widening file access', () => {
        convertFileSrcMock.mockReturnValue('asset://localhost/Users/xpy/Videos/cat.mp4');
        expect(videoEditorPreviewSrc('/Users/xpy/Videos/cat.mp4')).toBe(
            'asset://localhost/Users/xpy/Videos/cat.mp4',
        );
    });

    it('offers a WebM save path derived from the input filename', async () => {
        saveMock.mockResolvedValue('/Users/xpy/Videos/cat-transparent.webm');

        await expect(pickEditedVideoOutputPath('/Users/xpy/Videos/cat.mp4')).resolves.toBe(
            '/Users/xpy/Videos/cat-transparent.webm',
        );
        expect(saveMock).toHaveBeenCalledWith({
            defaultPath: 'cat-transparent.webm',
            filters: [{ name: '透明 WebM 视频', extensions: ['webm'] }],
        });
    });

    it('submits the complete edit request and returns the saved path', async () => {
        const request: VideoProcessRequest = {
            jobId: 'job-1',
            inputPath: '/Users/xpy/Videos/cat.mp4',
            outputPath: '/Users/xpy/Videos/cat-transparent.webm',
            crop: { x: 0, y: 0, width: 854, height: 480 },
            startSeconds: 0,
            endSeconds: 3.5,
            threshold: 24,
            brushStrokes: [],
        };
        invokeMock.mockResolvedValue({ outputPath: request.outputPath });

        await expect(processBackgroundRemovedVideo(request)).resolves.toEqual({
            outputPath: request.outputPath,
        });
        expect(invokeMock).toHaveBeenCalledWith('process_background_removed_video', { request });
    });

    it('reports whether the native BackgroundRemover runtime is ready', async () => {
        invokeMock.mockResolvedValue({ ready: false, message: '未找到 BackgroundRemover' });

        await expect(videoEditorRuntimeStatus()).resolves.toEqual({
            ready: false,
            message: '未找到 BackgroundRemover',
        });
        expect(invokeMock).toHaveBeenCalledWith('video_editor_runtime_status');
    });

    it('forwards native progress payloads and returns the native cleanup function', async () => {
        const cleanup = vi.fn();
        let nativeHandler: ((event: { payload: unknown }) => void) | undefined;
        listenMock.mockImplementation(async (_eventName, handler) => {
            nativeHandler = handler;
            return cleanup;
        });
        const handler = vi.fn();

        await expect(listenVideoEditorProgress(handler)).resolves.toBe(cleanup);
        nativeHandler?.({ payload: { jobId: 'job-1', percent: 40, stage: '正在抠图' } });

        expect(listenMock).toHaveBeenCalledWith('video-editor-progress', expect.any(Function));
        expect(handler).toHaveBeenCalledWith({ jobId: 'job-1', percent: 40, stage: '正在抠图' });
    });
});
