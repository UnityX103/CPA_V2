import { describe, expect, it } from 'vitest';
import {
    INITIAL_VIDEO_EDITOR_DRAFT,
    buildVideoProcessRequest,
    createVideoEditorDraft,
    videoEditorReducer,
    type VideoProbe,
} from './videoEditor';

const PROBE: VideoProbe = {
    width: 854,
    height: 480,
    durationSeconds: 3.5,
    frameRate: 24,
};

describe('video editor draft', () => {
    it('initialises a full-frame edit from probed video metadata', () => {
        expect(createVideoEditorDraft('/Users/xpy/Videos/cat.mp4', PROBE)).toMatchObject({
            sourcePath: '/Users/xpy/Videos/cat.mp4',
            probe: PROBE,
            crop: { x: 0, y: 0, width: 854, height: 480 },
            startSeconds: 0,
            endSeconds: 3.5,
            threshold: 24,
            brushRadius: 0.03,
            strokes: [],
        });
    });

    it('keeps crop coordinates inside the source and encoder-safe even dimensions', () => {
        const loaded = createVideoEditorDraft('/Users/xpy/Videos/cat.mp4', PROBE);
        const next = videoEditorReducer(loaded, {
            type: 'setCrop',
            crop: { x: 853, y: -10, width: 999, height: 1 },
        });

        expect(next.crop).toEqual({ x: 852, y: 0, width: 2, height: 2 });
    });

    it('clears crop-relative brush strokes whenever the crop changes', () => {
        const loaded = createVideoEditorDraft('/Users/xpy/Videos/cat.mp4', PROBE);
        const painted = videoEditorReducer(loaded, {
            type: 'beginStroke',
            point: { x: 0.5, y: 0.5 },
        });

        const unchanged = videoEditorReducer(painted, {
            type: 'setCrop',
            crop: painted.crop,
        });
        const changed = videoEditorReducer(painted, {
            type: 'setCrop',
            crop: { x: 10, y: 10, width: 400, height: 300 },
        });

        expect(unchanged.strokes).toHaveLength(1);
        expect(changed.strokes).toEqual([]);
    });

    it('clamps trim times and preserves a usable interval', () => {
        const loaded = createVideoEditorDraft('/Users/xpy/Videos/cat.mp4', PROBE);
        const withStart = videoEditorReducer(loaded, { type: 'setStartSeconds', value: 3.49 });
        const withEnd = videoEditorReducer(withStart, { type: 'setEndSeconds', value: -1 });

        expect(withStart.startSeconds).toBe(3.4);
        expect(withStart.endSeconds).toBe(3.5);
        expect(withEnd.startSeconds).toBe(0);
        expect(withEnd.endSeconds).toBe(0.1);
    });

    it('restores the original frame and duration without resetting erase settings', () => {
        const loaded = createVideoEditorDraft('/Users/xpy/Videos/cat.mp4', PROBE);
        const cropped = videoEditorReducer(loaded, {
            type: 'setCrop',
            crop: { x: 10, y: 20, width: 400, height: 300 },
        });
        const trimmed = videoEditorReducer(
            videoEditorReducer(cropped, { type: 'setStartSeconds', value: 0.5 }),
            { type: 'setEndSeconds', value: 2.5 },
        );
        const painted = videoEditorReducer(
            videoEditorReducer(
                videoEditorReducer(trimmed, { type: 'setThreshold', value: 96 }),
                { type: 'setBrushRadius', value: 0.08 },
            ),
            { type: 'beginStroke', point: { x: 0.5, y: 0.5 } },
        );

        const restored = videoEditorReducer(painted, { type: 'restoreOriginal' });

        expect(restored).toMatchObject({
            crop: { x: 0, y: 0, width: 854, height: 480 },
            startSeconds: 0,
            endSeconds: 3.5,
            threshold: 96,
            brushRadius: 0.08,
            strokes: [],
        });
    });

    it('keeps crop-relative brush strokes when restore only resets trim time', () => {
        const loaded = createVideoEditorDraft('/Users/xpy/Videos/cat.mp4', PROBE);
        const trimmed = videoEditorReducer(
            videoEditorReducer(loaded, { type: 'setStartSeconds', value: 0.5 }),
            { type: 'setEndSeconds', value: 2.5 },
        );
        const painted = videoEditorReducer(trimmed, {
            type: 'beginStroke',
            point: { x: 0.5, y: 0.5 },
        });

        const restored = videoEditorReducer(painted, { type: 'restoreOriginal' });

        expect(restored.startSeconds).toBe(0);
        expect(restored.endSeconds).toBe(3.5);
        expect(restored.strokes).toEqual(painted.strokes);
    });

    it('clamps alpha threshold and brush radius to supported ranges', () => {
        const loaded = createVideoEditorDraft('/Users/xpy/Videos/cat.mp4', PROBE);
        const threshold = videoEditorReducer(loaded, { type: 'setThreshold', value: 999 });
        const radius = videoEditorReducer(threshold, { type: 'setBrushRadius', value: 0 });

        expect(radius.threshold).toBe(255);
        expect(radius.brushRadius).toBe(0.005);
    });

    it('records normalised erase strokes and can clear them', () => {
        const loaded = createVideoEditorDraft('/Users/xpy/Videos/cat.mp4', PROBE);
        const begun = videoEditorReducer(loaded, {
            type: 'beginStroke',
            point: { x: -0.2, y: 0.25 },
        });
        const extended = videoEditorReducer(begun, {
            type: 'extendStroke',
            point: { x: 1.4, y: 0.75 },
        });

        expect(extended.strokes).toEqual([{
            radius: 0.03,
            points: [{ x: 0, y: 0.25 }, { x: 1, y: 0.75 }],
        }]);
        expect(videoEditorReducer(extended, { type: 'undoStroke' }).strokes).toEqual([]);
        expect(videoEditorReducer(extended, { type: 'clearStrokes' }).strokes).toEqual([]);
    });

    it('builds the native processing request only after a video is loaded', () => {
        expect(() => buildVideoProcessRequest(
            INITIAL_VIDEO_EDITOR_DRAFT,
            '/Users/xpy/Videos/cat-alpha.webm',
            'job-1',
        )).toThrow('请先选择视频');

        const loaded = createVideoEditorDraft('/Users/xpy/Videos/cat.mp4', PROBE);
        expect(buildVideoProcessRequest(
            loaded,
            '/Users/xpy/Videos/cat-alpha.webm',
            'job-1',
        )).toEqual({
            jobId: 'job-1',
            inputPath: '/Users/xpy/Videos/cat.mp4',
            outputPath: '/Users/xpy/Videos/cat-alpha.webm',
            crop: { x: 0, y: 0, width: 854, height: 480 },
            startSeconds: 0,
            endSeconds: 3.5,
            threshold: 24,
            brushStrokes: [],
        });
    });
});
