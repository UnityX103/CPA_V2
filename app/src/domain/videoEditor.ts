export interface VideoProbe {
    readonly width: number;
    readonly height: number;
    readonly durationSeconds: number;
    readonly frameRate: number;
}

export interface VideoCrop {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
}

export interface BrushPoint {
    readonly x: number;
    readonly y: number;
}

export interface BrushStroke {
    readonly radius: number;
    readonly points: readonly BrushPoint[];
}

export interface VideoEditorDraft {
    readonly sourcePath: string;
    readonly probe: VideoProbe | null;
    readonly crop: VideoCrop;
    readonly startSeconds: number;
    readonly endSeconds: number;
    readonly threshold: number;
    readonly brushRadius: number;
    readonly strokes: readonly BrushStroke[];
}

export interface VideoProcessRequest {
    readonly jobId: string;
    readonly inputPath: string;
    readonly outputPath: string;
    readonly crop: VideoCrop;
    readonly startSeconds: number;
    readonly endSeconds: number;
    readonly threshold: number;
    readonly brushStrokes: readonly BrushStroke[];
}

export type VideoEditorAction =
    | { readonly type: 'load'; readonly sourcePath: string; readonly probe: VideoProbe }
    | { readonly type: 'setCrop'; readonly crop: VideoCrop }
    | { readonly type: 'setStartSeconds'; readonly value: number }
    | { readonly type: 'setEndSeconds'; readonly value: number }
    | { readonly type: 'setThreshold'; readonly value: number }
    | { readonly type: 'setBrushRadius'; readonly value: number }
    | { readonly type: 'beginStroke'; readonly point: BrushPoint }
    | { readonly type: 'extendStroke'; readonly point: BrushPoint }
    | { readonly type: 'undoStroke' }
    | { readonly type: 'clearStrokes' };

const MIN_TRIM_SECONDS = 0.1;
const DEFAULT_THRESHOLD = 24;
const DEFAULT_BRUSH_RADIUS = 0.03;

export const INITIAL_VIDEO_EDITOR_DRAFT: VideoEditorDraft = {
    sourcePath: '',
    probe: null,
    crop: { x: 0, y: 0, width: 2, height: 2 },
    startSeconds: 0,
    endSeconds: 0,
    threshold: DEFAULT_THRESHOLD,
    brushRadius: DEFAULT_BRUSH_RADIUS,
    strokes: [],
};

export function createVideoEditorDraft(sourcePath: string, probe: VideoProbe): VideoEditorDraft {
    const width = evenFloor(Math.max(2, probe.width));
    const height = evenFloor(Math.max(2, probe.height));
    return {
        ...INITIAL_VIDEO_EDITOR_DRAFT,
        sourcePath,
        probe,
        crop: { x: 0, y: 0, width, height },
        endSeconds: roundSeconds(Math.max(MIN_TRIM_SECONDS, probe.durationSeconds)),
    };
}

export function videoEditorReducer(
    state: VideoEditorDraft,
    action: VideoEditorAction,
): VideoEditorDraft {
    switch (action.type) {
        case 'load':
            return createVideoEditorDraft(action.sourcePath, action.probe);
        case 'setCrop':
            if (!state.probe) return state;
            {
                const crop = normaliseCrop(action.crop, state.probe);
                const changed = !sameCrop(crop, state.crop);
                return { ...state, crop, strokes: changed ? [] : state.strokes };
            }
        case 'setStartSeconds': {
            if (!state.probe) return state;
            const maxStart = Math.max(0, state.endSeconds - MIN_TRIM_SECONDS);
            return {
                ...state,
                startSeconds: roundSeconds(clamp(finiteOr(action.value, 0), 0, maxStart)),
            };
        }
        case 'setEndSeconds': {
            if (!state.probe) return state;
            const duration = Math.max(MIN_TRIM_SECONDS, state.probe.durationSeconds);
            const endSeconds = roundSeconds(clamp(
                finiteOr(action.value, MIN_TRIM_SECONDS),
                MIN_TRIM_SECONDS,
                duration,
            ));
            return {
                ...state,
                startSeconds: roundSeconds(Math.min(state.startSeconds, endSeconds - MIN_TRIM_SECONDS)),
                endSeconds,
            };
        }
        case 'setThreshold':
            return { ...state, threshold: Math.round(clamp(finiteOr(action.value, 0), 0, 255)) };
        case 'setBrushRadius':
            return { ...state, brushRadius: clamp(finiteOr(action.value, DEFAULT_BRUSH_RADIUS), 0.005, 0.2) };
        case 'beginStroke':
            return {
                ...state,
                strokes: [
                    ...state.strokes,
                    { radius: state.brushRadius, points: [normalisePoint(action.point)] },
                ],
            };
        case 'extendStroke': {
            if (state.strokes.length === 0) return state;
            const strokes = [...state.strokes];
            const last = strokes[strokes.length - 1];
            strokes[strokes.length - 1] = {
                ...last,
                points: [...last.points, normalisePoint(action.point)],
            };
            return { ...state, strokes };
        }
        case 'undoStroke':
            return state.strokes.length === 0
                ? state
                : { ...state, strokes: state.strokes.slice(0, -1) };
        case 'clearStrokes':
            return state.strokes.length === 0 ? state : { ...state, strokes: [] };
    }
}

function sameCrop(a: VideoCrop, b: VideoCrop): boolean {
    return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

export function buildVideoProcessRequest(
    draft: VideoEditorDraft,
    outputPath: string,
    jobId: string,
): VideoProcessRequest {
    if (!draft.sourcePath || !draft.probe) {
        throw new Error('请先选择视频');
    }
    if (!outputPath) {
        throw new Error('请选择保存位置');
    }
    return {
        jobId,
        inputPath: draft.sourcePath,
        outputPath,
        crop: draft.crop,
        startSeconds: draft.startSeconds,
        endSeconds: draft.endSeconds,
        threshold: draft.threshold,
        brushStrokes: draft.strokes,
    };
}

function normaliseCrop(crop: VideoCrop, probe: VideoProbe): VideoCrop {
    const sourceWidth = evenFloor(Math.max(2, probe.width));
    const sourceHeight = evenFloor(Math.max(2, probe.height));
    const x = evenFloor(clamp(Math.floor(finiteOr(crop.x, 0)), 0, sourceWidth - 2));
    const y = evenFloor(clamp(Math.floor(finiteOr(crop.y, 0)), 0, sourceHeight - 2));
    const width = evenFloor(clamp(Math.floor(finiteOr(crop.width, 2)), 2, sourceWidth - x));
    const height = evenFloor(clamp(Math.floor(finiteOr(crop.height, 2)), 2, sourceHeight - y));
    return { x, y, width: Math.max(2, width), height: Math.max(2, height) };
}

function normalisePoint(point: BrushPoint): BrushPoint {
    return {
        x: clamp(finiteOr(point.x, 0), 0, 1),
        y: clamp(finiteOr(point.y, 0), 0, 1),
    };
}

function evenFloor(value: number): number {
    const integer = Math.floor(value);
    return integer - (integer % 2);
}

function roundSeconds(value: number): number {
    return Math.round(value * 1000) / 1000;
}

function finiteOr(value: number, fallback: number): number {
    return Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}
