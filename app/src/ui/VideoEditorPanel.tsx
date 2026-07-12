import {
    useEffect,
    useMemo,
    useReducer,
    useRef,
    useState,
    type CSSProperties,
    type Dispatch,
    type PointerEvent as ReactPointerEvent,
} from 'react';
import {
    buildVideoProcessRequest,
    INITIAL_VIDEO_EDITOR_DRAFT,
    videoEditorReducer,
    type BrushPoint,
    type VideoCrop,
    type VideoEditorAction,
    type VideoProbe,
} from '../domain/videoEditor';
import {
    listenVideoEditorProgress,
    pickEditedVideoOutputPath,
    pickVideoForEditing,
    probeVideoForEditing,
    processBackgroundRemovedVideo,
    videoEditorPreviewSrc,
    videoEditorRuntimeStatus,
    type VideoEditorProgress,
    type VideoEditorRuntimeStatus,
} from '../domain/videoEditorFiles';
import { usePomodoroStore } from '../domain/pomodoro';
import { DEFAULT_BUILTIN_POMODORO_VIDEO_ID } from '../domain/pomodoroVideos';
import './VideoEditorPanel.css';

type EditorTool = 'preview' | 'crop' | 'erase';

export function VideoEditorPanel() {
    const [draft, dispatch] = useReducer(videoEditorReducer, INITIAL_VIDEO_EDITOR_DRAFT);
    const [previewSrc, setPreviewSrc] = useState('');
    const [tool, setTool] = useState<EditorTool>('crop');
    const [runtime, setRuntime] = useState<VideoEditorRuntimeStatus | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [isProcessing, setIsProcessing] = useState(false);
    const [progress, setProgress] = useState<VideoEditorProgress | null>(null);
    const [error, setError] = useState('');
    const [savedPath, setSavedPath] = useState('');
    const [appliedToPomodoro, setAppliedToPomodoro] = useState(false);
    const activePointerRef = useRef<number | null>(null);
    const cropStartRef = useRef<BrushPoint | null>(null);
    const activeJobIdRef = useRef<string | null>(null);

    useEffect(() => {
        let active = true;
        void videoEditorRuntimeStatus()
            .then((status) => {
                if (active) setRuntime(status);
            })
            .catch((cause) => {
                if (active) {
                    setRuntime({ ready: false, message: errorMessage(cause) });
                }
            });
        return () => { active = false; };
    }, []);

    useEffect(() => {
        let active = true;
        let unlisten: (() => void) | undefined;
        void listenVideoEditorProgress((event) => {
            if (event.jobId === activeJobIdRef.current) setProgress(event);
        }).then((cleanup) => {
            if (active) unlisten = cleanup;
            else cleanup();
        });
        return () => {
            active = false;
            unlisten?.();
        };
    }, []);

    const chooseVideo = async () => {
        setError('');
        setIsLoading(true);
        try {
            const path = await pickVideoForEditing();
            if (!path) return;
            const probe = await probeVideoForEditing(path);
            dispatch({ type: 'clearStrokes' });
            dispatch({ type: 'load', sourcePath: path, probe });
            setPreviewSrc(videoEditorPreviewSrc(path));
            setSavedPath('');
            setAppliedToPomodoro(false);
            setTool('crop');
        } catch (cause) {
            setError(errorMessage(cause));
        } finally {
            setIsLoading(false);
        }
    };

    const saveVideo = async () => {
        if (!draft.sourcePath || !runtime?.ready || isProcessing) return;
        setError('');
        const outputPath = await pickEditedVideoOutputPath(draft.sourcePath);
        if (!outputPath) return;

        const jobId = createJobId();
        activeJobIdRef.current = jobId;
        setIsProcessing(true);
        setSavedPath('');
        setAppliedToPomodoro(false);
        setProgress({ jobId, percent: 0, stage: '准备视频' });
        try {
            const result = await processBackgroundRemovedVideo(
                buildVideoProcessRequest(draft, outputPath, jobId),
            );
            setSavedPath(result.outputPath);
            setProgress({ jobId, percent: 100, stage: '处理完成' });
        } catch (cause) {
            setError(errorMessage(cause));
        } finally {
            activeJobIdRef.current = null;
            setIsProcessing(false);
        }
    };

    const setAsPomodoroVideo = () => {
        if (!savedPath) return;
        const pomodoro = usePomodoroStore.getState();
        pomodoro.applyEndActionSettings('playVideo', {
            sourceKind: 'custom',
            builtinVideoId:
                pomodoro.endActionVideo.builtinVideoId || DEFAULT_BUILTIN_POMODORO_VIDEO_ID,
            customVideoPath: savedPath,
        });
        setAppliedToPomodoro(true);
    };

    const previewStyle = useMemo(() => previewVideoStyle(draft.crop, draft.probe, tool), [
        draft.crop,
        draft.probe,
        tool,
    ]);

    const onPreviewPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
        if (!draft.probe || tool === 'preview' || event.button !== 0 || isProcessing) return;
        const point = pointInElement(event);
        activePointerRef.current = event.pointerId;
        event.currentTarget.setPointerCapture?.(event.pointerId);
        if (tool === 'erase') {
            dispatch({ type: 'beginStroke', point });
        } else {
            cropStartRef.current = point;
            dispatch({ type: 'setCrop', crop: cropFromPoints(point, point, draft.probe.width, draft.probe.height) });
        }
    };

    const onPreviewPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
        if (activePointerRef.current !== event.pointerId || !draft.probe) return;
        const point = pointInElement(event);
        if (tool === 'erase') {
            dispatch({ type: 'extendStroke', point });
            return;
        }
        if (cropStartRef.current) {
            dispatch({
                type: 'setCrop',
                crop: cropFromPoints(
                    cropStartRef.current,
                    point,
                    draft.probe.width,
                    draft.probe.height,
                ),
            });
        }
    };

    const finishPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
        if (activePointerRef.current !== event.pointerId) return;
        event.currentTarget.releasePointerCapture?.(event.pointerId);
        activePointerRef.current = null;
        cropStartRef.current = null;
    };

    return (
        <div className="settings-content-scroll video-editor-scroll">
            <div className="tab-pane video-editor-pane">
                <section className="card video-editor-import-card">
                    <div className="video-editor-heading-row">
                        <div>
                            <h3 className="card-title video-editor-title">视频编辑</h3>
                            <p className="video-editor-hint">BackgroundRemover 自动抠图，画笔剔除区域会应用到整个片段。</p>
                        </div>
                        <button
                            type="button"
                            className="btn btn-secondary video-editor-import"
                            aria-label="导入视频"
                            disabled={isLoading || isProcessing}
                            onClick={() => { void chooseVideo(); }}
                        >
                            {isLoading ? '读取中…' : '导入视频'}
                        </button>
                    </div>
                    <div className={`video-editor-runtime ${runtime?.ready ? 'ready' : 'missing'}`}>
                        {runtime?.message ?? '正在检查 BackgroundRemover…'}
                    </div>
                </section>

                {draft.probe && previewSrc ? (
                    <>
                        <section className="card video-editor-preview-card">
                            <div className="video-editor-meta">
                                <span>{draft.probe.width} × {draft.probe.height}</span>
                                <span>{draft.probe.durationSeconds.toFixed(2)} 秒 · {draft.probe.frameRate.toFixed(2)} FPS</span>
                            </div>
                            <div className="video-editor-tools" role="group" aria-label="编辑工具">
                                <button
                                    type="button"
                                    className={tool === 'preview' ? 'active' : ''}
                                    aria-label="播放预览"
                                    onClick={() => setTool('preview')}
                                >预览</button>
                                <button
                                    type="button"
                                    className={tool === 'crop' ? 'active' : ''}
                                    aria-label="裁剪工具"
                                    onClick={() => setTool('crop')}
                                >裁剪</button>
                                <button
                                    type="button"
                                    className={tool === 'erase' ? 'active' : ''}
                                    aria-label="剔除画笔"
                                    onClick={() => setTool('erase')}
                                >画笔剔除</button>
                            </div>
                            <div
                                className={`video-editor-stage tool-${tool}`}
                                aria-label="视频编辑预览区"
                                style={previewStyle.stage}
                                onPointerDown={onPreviewPointerDown}
                                onPointerMove={onPreviewPointerMove}
                                onPointerUp={finishPointer}
                                onPointerCancel={finishPointer}
                            >
                                <video
                                    aria-label="视频预览"
                                    src={previewSrc}
                                    style={previewStyle.video}
                                    controls
                                    muted
                                    playsInline
                                />
                                {tool === 'crop' ? (
                                    <div className="video-editor-crop-box" style={cropOverlayStyle(draft.crop, draft.probe)} />
                                ) : tool === 'erase' ? (
                                    <svg className="video-editor-brush-overlay" viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-hidden="true">
                                        {draft.strokes.map((stroke, index) => (
                                            <polyline
                                                key={`${index}-${stroke.points.length}`}
                                                points={stroke.points.map((point) => `${point.x * 1000},${point.y * 1000}`).join(' ')}
                                                fill="none"
                                                stroke="rgba(239, 68, 68, 0.72)"
                                                strokeWidth={stroke.radius * 2000}
                                                strokeLinecap="round"
                                                strokeLinejoin="round"
                                            />
                                        ))}
                                    </svg>
                                ) : null}
                            </div>
                        </section>

                        <section className="card video-editor-controls-card">
                            <h3 className="card-title">裁剪与时间</h3>
                            <div className="video-editor-number-grid">
                                <EditorNumber label="裁剪 X" value={draft.crop.x} min={0} onChange={(value) => setCropPart(dispatch, draft.crop, 'x', value)} />
                                <EditorNumber label="裁剪 Y" value={draft.crop.y} min={0} onChange={(value) => setCropPart(dispatch, draft.crop, 'y', value)} />
                                <EditorNumber label="裁剪宽度" value={draft.crop.width} min={2} onChange={(value) => setCropPart(dispatch, draft.crop, 'width', value)} />
                                <EditorNumber label="裁剪高度" value={draft.crop.height} min={2} onChange={(value) => setCropPart(dispatch, draft.crop, 'height', value)} />
                                <EditorNumber label="开始时间" value={draft.startSeconds} min={0} step={0.1} suffix="秒" onChange={(value) => dispatch({ type: 'setStartSeconds', value })} />
                                <EditorNumber label="结束时间" value={draft.endSeconds} min={0.1} step={0.1} suffix="秒" onChange={(value) => dispatch({ type: 'setEndSeconds', value })} />
                            </div>
                        </section>

                        <section className="card video-editor-controls-card">
                            <label className="video-editor-range-row">
                                <span className="card-label">背景清除阈值（越高剔除越多）</span>
                                <span className="video-editor-range-value">{draft.threshold}</span>
                                <input
                                    aria-label="背景清除阈值"
                                    type="range"
                                    min={0}
                                    max={255}
                                    value={draft.threshold}
                                    onChange={(event) => dispatch({ type: 'setThreshold', value: Number(event.currentTarget.value) })}
                                />
                            </label>
                            <label className="video-editor-range-row">
                                <span className="card-label">画笔大小</span>
                                <span className="video-editor-range-value">{Math.round(draft.brushRadius * 1000)}‰</span>
                                <input
                                    aria-label="画笔大小"
                                    type="range"
                                    min={5}
                                    max={200}
                                    value={Math.round(draft.brushRadius * 1000)}
                                    onChange={(event) => dispatch({ type: 'setBrushRadius', value: Number(event.currentTarget.value) / 1000 })}
                                />
                            </label>
                            <div className="card-actions">
                                <button type="button" className="btn btn-secondary btn-fit" disabled={draft.strokes.length === 0} onClick={() => dispatch({ type: 'undoStroke' })}>撤销一笔</button>
                                <button type="button" className="btn btn-secondary btn-fit" disabled={draft.strokes.length === 0} onClick={() => dispatch({ type: 'clearStrokes' })}>清空画笔</button>
                                <span className="video-editor-stroke-count">{draft.strokes.length} 笔</span>
                            </div>
                        </section>

                        <section className="card video-editor-save-card">
                            {isProcessing && progress && (
                                <div className="video-editor-progress-wrap">
                                    <div className="video-editor-progress-copy">
                                        <span>{progress.stage}</span>
                                        <span>{Math.round(progress.percent)}%</span>
                                    </div>
                                    <progress max={100} value={progress.percent} aria-label="视频处理进度" />
                                </div>
                            )}
                            <button
                                type="button"
                                className="btn btn-primary btn-block video-editor-save"
                                aria-label="保存透明视频"
                                disabled={!runtime?.ready || isProcessing}
                                onClick={() => { void saveVideo(); }}
                            >
                                {isProcessing ? 'BackgroundRemover 处理中…' : '保存透明视频'}
                            </button>
                            {savedPath && (
                                <div className="video-editor-result">
                                    <div>
                                        <span className="card-label">已保存</span>
                                        <strong>{pathBasename(savedPath)}</strong>
                                    </div>
                                    <button type="button" className="btn btn-secondary btn-fit" aria-label="设为番茄钟结束视频" onClick={setAsPomodoroVideo}>
                                        设为番茄钟结束视频
                                    </button>
                                </div>
                            )}
                            {appliedToPomodoro && <div className="video-editor-success">已设为番茄钟结束视频</div>}
                        </section>
                    </>
                ) : (
                    <section className="video-editor-empty">
                        <span>导入视频后可裁剪画面和时间，再用画笔剔除不需要的区域。</span>
                    </section>
                )}

                {error && <div className="video-editor-error" role="alert">{error}</div>}
            </div>
        </div>
    );
}

function EditorNumber({
    label,
    value,
    min,
    step = 1,
    suffix = 'px',
    onChange,
}: {
    label: string;
    value: number;
    min: number;
    step?: number;
    suffix?: string;
    onChange: (value: number) => void;
}) {
    const [draftValue, setDraftValue] = useState(String(value));
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (document.activeElement !== inputRef.current) {
            setDraftValue(String(value));
        }
    }, [value]);

    const commit = () => {
        const next = Number(draftValue);
        if (draftValue.trim() !== '' && Number.isFinite(next)) {
            onChange(next);
        } else {
            setDraftValue(String(value));
        }
    };

    return (
        <label className="video-editor-number">
            <span className="card-label">{label}</span>
            <span className="num-input">
                <input
                    ref={inputRef}
                    type="number"
                    aria-label={label}
                    value={draftValue}
                    min={min}
                    step={step}
                    onChange={(event) => setDraftValue(event.currentTarget.value)}
                    onBlur={commit}
                    onKeyDown={(event) => {
                        if (event.key === 'Enter') event.currentTarget.blur();
                        if (event.key === 'Escape') {
                            setDraftValue(String(value));
                            event.currentTarget.blur();
                        }
                    }}
                />
                <span className="num-suffix">{suffix}</span>
            </span>
        </label>
    );
}

function setCropPart(
    dispatch: Dispatch<VideoEditorAction>,
    crop: VideoCrop,
    key: keyof VideoCrop,
    value: number,
): void {
    dispatch({ type: 'setCrop', crop: { ...crop, [key]: value } });
}

function pointInElement(event: ReactPointerEvent<HTMLElement>): BrushPoint {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
        x: rect.width > 0 ? (event.clientX - rect.left) / rect.width : 0,
        y: rect.height > 0 ? (event.clientY - rect.top) / rect.height : 0,
    };
}

function cropFromPoints(a: BrushPoint, b: BrushPoint, width: number, height: number): VideoCrop {
    const left = Math.min(a.x, b.x);
    const top = Math.min(a.y, b.y);
    return {
        x: left * width,
        y: top * height,
        width: Math.max(2, Math.abs(a.x - b.x) * width),
        height: Math.max(2, Math.abs(a.y - b.y) * height),
    };
}

function cropOverlayStyle(crop: VideoCrop, probe: VideoProbe): CSSProperties {
    return {
        left: `${(crop.x / probe.width) * 100}%`,
        top: `${(crop.y / probe.height) * 100}%`,
        width: `${(crop.width / probe.width) * 100}%`,
        height: `${(crop.height / probe.height) * 100}%`,
    };
}

function previewVideoStyle(
    crop: VideoCrop,
    probe: VideoProbe | null,
    tool: EditorTool,
): { stage: CSSProperties; video: CSSProperties } {
    if (!probe || tool === 'crop') {
        return {
            stage: { aspectRatio: probe ? `${probe.width} / ${probe.height}` : '16 / 9' },
            video: { inset: 0, width: '100%', height: '100%' },
        };
    }
    return {
        stage: { aspectRatio: `${crop.width} / ${crop.height}` },
        video: {
            width: `${(probe.width / crop.width) * 100}%`,
            height: `${(probe.height / crop.height) * 100}%`,
            left: `${(-crop.x / crop.width) * 100}%`,
            top: `${(-crop.y / crop.height) * 100}%`,
        },
    };
}

function pathBasename(path: string): string {
    return path.split(/[\\/]/).pop() || path;
}

function createJobId(): string {
    return globalThis.crypto?.randomUUID?.() ?? `video-edit-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function errorMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    return typeof error === 'string' ? error : '视频处理失败，请检查运行环境后重试';
}
