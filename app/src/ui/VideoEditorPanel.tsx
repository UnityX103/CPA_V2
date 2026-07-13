import {
    useEffect,
    useMemo,
    useRef,
    useState,
    type CSSProperties,
    type PointerEvent as ReactPointerEvent,
} from 'react';
import {
    type BrushPoint,
    type VideoCrop,
    type VideoProbe,
} from '../domain/videoEditor';
import {
    useVideoEditorLifecycle,
    useVideoEditorStore,
} from '../domain/videoEditorStore';
import { fileNameFromPath } from '../domain/filePath';
import './VideoEditorPanel.css';

export function VideoEditorPanel() {
    useVideoEditorLifecycle();
    const editor = useVideoEditorStore();
    const {
        draft,
        previewSrc,
        tool,
        runtime,
        isLoading,
        isChoosingOutput,
        isProcessing,
        isPreparingResultPreview,
        isApplyingToPomodoro,
        progress,
        error,
        generatedPath,
        exportedPath,
        resultPreviewSrc,
        resultPreviewPlaybackState,
        appliedToPomodoro,
    } = editor;
    const activePointerRef = useRef<number | null>(null);
    const cropStartRef = useRef<BrushPoint | null>(null);
    const editingLocked = isLoading
        || isChoosingOutput
        || isProcessing
        || isPreparingResultPreview
        || isApplyingToPomodoro;

    const previewStyle = useMemo(() => previewVideoStyle(draft.crop, draft.probe, tool), [
        draft.crop,
        draft.probe,
        tool,
    ]);
    const brushPreview = brushPreviewGeometry(draft.crop);

    const onPreviewPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
        if (!draft.probe || tool === 'preview' || event.button !== 0 || editingLocked) return;
        const point = pointInElement(event);
        activePointerRef.current = event.pointerId;
        event.currentTarget.setPointerCapture?.(event.pointerId);
        if (tool === 'erase') {
            editor.beginStroke(point);
        } else {
            cropStartRef.current = point;
            editor.setCrop(cropFromPoints(point, point, draft.probe.width, draft.probe.height));
        }
    };

    const onPreviewPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
        if (activePointerRef.current !== event.pointerId || !draft.probe) return;
        const point = pointInElement(event);
        if (tool === 'erase') {
            editor.extendStroke(point);
            return;
        }
        if (cropStartRef.current) {
            editor.setCrop(cropFromPoints(
                cropStartRef.current,
                point,
                draft.probe.width,
                draft.probe.height,
            ));
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
                            disabled={
                                isLoading
                                || isChoosingOutput
                                || isProcessing
                                || isPreparingResultPreview
                                || isApplyingToPomodoro
                            }
                            onClick={() => { void editor.chooseVideo(); }}
                        >
                            {isLoading ? '读取中…' : '导入视频'}
                        </button>
                    </div>
                    <div className={`video-editor-runtime ${runtime?.ready ? 'ready' : 'missing'}`}>
                        <span>{runtime?.message ?? '正在检查 BackgroundRemover…'}</span>
                        {runtime && !runtime.ready ? (
                            <button
                                type="button"
                                className="video-editor-runtime-retry"
                                aria-label="重新检查运行环境"
                                onClick={() => { void editor.refreshRuntime(); }}
                            >
                                重新检查
                            </button>
                        ) : null}
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
                                    onClick={() => editor.setTool('preview')}
                                >预览</button>
                                <button
                                    type="button"
                                    className={tool === 'crop' ? 'active' : ''}
                                    aria-label="裁剪工具"
                                    onClick={() => editor.setTool('crop')}
                                >裁剪</button>
                                <button
                                    type="button"
                                    className={tool === 'erase' ? 'active' : ''}
                                    aria-label="剔除画笔"
                                    onClick={() => editor.setTool('erase')}
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
                                    <svg
                                        className="video-editor-brush-overlay"
                                        viewBox={`0 0 ${brushPreview.width} ${brushPreview.height}`}
                                        preserveAspectRatio="none"
                                        aria-hidden="true"
                                    >
                                        {draft.strokes.map((stroke, index) => (
                                            <polyline
                                                key={`${index}-${stroke.points.length}`}
                                                points={stroke.points.map((point) => (
                                                    `${point.x * brushPreview.width},${point.y * brushPreview.height}`
                                                )).join(' ')}
                                                fill="none"
                                                stroke="rgba(239, 68, 68, 0.72)"
                                                strokeWidth={stroke.radius * 2 * brushPreview.shortEdge}
                                                strokeLinecap="round"
                                                strokeLinejoin="round"
                                            />
                                        ))}
                                    </svg>
                                ) : null}
                            </div>
                        </section>

                        {tool === 'crop' && (
                            <section className="card video-editor-controls-card">
                                <div className="video-editor-heading-row">
                                    <h3 className="card-title">裁剪与时间</h3>
                                    <button
                                        type="button"
                                        className="btn btn-secondary btn-fit"
                                        aria-label="复原裁剪与时间"
                                        disabled={editingLocked}
                                        onClick={editor.restoreOriginal}
                                    >
                                        复原
                                    </button>
                                </div>
                                <div className="video-editor-number-grid">
                                    <EditorNumber label="裁剪 X" value={draft.crop.x} min={0} disabled={editingLocked} onChange={(value) => setCropPart(editor.setCrop, draft.crop, 'x', value)} />
                                    <EditorNumber label="裁剪 Y" value={draft.crop.y} min={0} disabled={editingLocked} onChange={(value) => setCropPart(editor.setCrop, draft.crop, 'y', value)} />
                                    <EditorNumber label="裁剪宽度" value={draft.crop.width} min={2} disabled={editingLocked} onChange={(value) => setCropPart(editor.setCrop, draft.crop, 'width', value)} />
                                    <EditorNumber label="裁剪高度" value={draft.crop.height} min={2} disabled={editingLocked} onChange={(value) => setCropPart(editor.setCrop, draft.crop, 'height', value)} />
                                    <EditorNumber label="开始时间" value={draft.startSeconds} min={0} step={0.1} suffix="秒" disabled={editingLocked} onChange={editor.setStartSeconds} />
                                    <EditorNumber label="结束时间" value={draft.endSeconds} min={0.1} step={0.1} suffix="秒" disabled={editingLocked} onChange={editor.setEndSeconds} />
                                </div>
                            </section>
                        )}

                        {tool === 'erase' && (
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
                                    disabled={editingLocked}
                                    onChange={(event) => editor.setThreshold(Number(event.currentTarget.value))}
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
                                    disabled={editingLocked}
                                    onChange={(event) => editor.setBrushRadius(Number(event.currentTarget.value) / 1000)}
                                />
                            </label>
                            <div className="card-actions">
                                <button type="button" className="btn btn-secondary btn-fit" disabled={editingLocked || draft.strokes.length === 0} onClick={editor.undoStroke}>撤销一笔</button>
                                <button type="button" className="btn btn-secondary btn-fit" disabled={editingLocked || draft.strokes.length === 0} onClick={editor.clearStrokes}>清空画笔</button>
                                <span className="video-editor-stroke-count">{draft.strokes.length} 笔</span>
                            </div>
                            </section>
                        )}

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
                                aria-label="生成透明视频"
                                disabled={
                                    !runtime?.ready
                                    || isLoading
                                    || isChoosingOutput
                                    || isProcessing
                                    || isPreparingResultPreview
                                    || isApplyingToPomodoro
                                }
                                onClick={() => { void editor.generateVideo(); }}
                            >
                                {isProcessing
                                    ? 'BackgroundRemover 处理中…'
                                    : isPreparingResultPreview
                                        ? '正在准备兼容预览…'
                                        : '生成透明视频'}
                            </button>
                            {generatedPath && isPreparingResultPreview && (
                                <div className="video-editor-result-preparing" role="status">
                                    正在准备可播放的透明成品预览…
                                </div>
                            )}
                            {generatedPath && resultPreviewSrc && (
                                <div className="video-editor-result-preview">
                                    <div className="video-editor-result-preview-copy">
                                        <span className="card-label">透明成品预览</span>
                                        <span>已应用当前裁剪、阈值与画笔效果</span>
                                    </div>
                                    <div className="video-editor-alpha-stage">
                                        <video
                                            aria-label="透明成品视频预览"
                                            src={resultPreviewSrc}
                                            controls
                                            muted
                                            loop
                                            playsInline
                                            preload="auto"
                                            onCanPlay={editor.markResultPreviewReady}
                                            onError={editor.markResultPreviewError}
                                        />
                                    </div>
                                    {resultPreviewPlaybackState === 'error' && (
                                        <div className="video-editor-error" role="alert">
                                            透明成品已生成，但当前系统无法播放兼容预览
                                        </div>
                                    )}
                                </div>
                            )}
                            {generatedPath && (
                                <div className="video-editor-result">
                                    <div>
                                        <span className="card-label">已生成临时成品</span>
                                        <strong>{fileNameFromPath(generatedPath)}</strong>
                                    </div>
                                    <button
                                        type="button"
                                        className="btn btn-secondary btn-fit"
                                        aria-label="导出透明视频"
                                        disabled={
                                            isLoading
                                            || isChoosingOutput
                                            || isProcessing
                                            || isApplyingToPomodoro
                                            || isPreparingResultPreview
                                        }
                                        onClick={() => { void editor.exportVideo(); }}
                                    >
                                        {isChoosingOutput ? '选择导出位置…' : '导出透明视频'}
                                    </button>
                                </div>
                            )}
                            {exportedPath && (
                                <div className="video-editor-result">
                                    <div>
                                        <span className="card-label">已导出</span>
                                        <strong>{fileNameFromPath(exportedPath)}</strong>
                                    </div>
                                    <button
                                        type="button"
                                        className="btn btn-secondary btn-fit"
                                        aria-label="设为番茄钟结束视频"
                                        disabled={
                                            isLoading
                                            || isChoosingOutput
                                            || isProcessing
                                            || isApplyingToPomodoro
                                            || isPreparingResultPreview
                                        }
                                        onClick={() => { void editor.setAsPomodoroVideo(); }}
                                    >
                                        {isApplyingToPomodoro ? '设置中…' : '设为番茄钟结束视频'}
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
    disabled = false,
    onChange,
}: {
    label: string;
    value: number;
    min: number;
    step?: number;
    suffix?: string;
    disabled?: boolean;
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
                    disabled={disabled}
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
    setCrop: (crop: VideoCrop) => void,
    crop: VideoCrop,
    key: keyof VideoCrop,
    value: number,
): void {
    setCrop({ ...crop, [key]: value });
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

function brushPreviewGeometry(crop: VideoCrop): {
    width: number;
    height: number;
    shortEdge: number;
} {
    const width = Math.max(1, crop.width);
    const height = Math.max(1, crop.height);
    return { width, height, shortEdge: Math.min(width, height) };
}

function previewVideoStyle(
    crop: VideoCrop,
    probe: VideoProbe | null,
    tool: 'preview' | 'crop' | 'erase',
): { stage: CSSProperties; video: CSSProperties } {
    if (!probe || tool === 'crop') {
        const width = probe?.width ?? 16;
        const height = probe?.height ?? 9;
        return {
            stage: previewStageStyle(width, height),
            video: { inset: 0, width: '100%', height: '100%' },
        };
    }
    return {
        stage: previewStageStyle(crop.width, crop.height),
        video: {
            width: `${(probe.width / crop.width) * 100}%`,
            height: `${(probe.height / crop.height) * 100}%`,
            left: `${(-crop.x / crop.width) * 100}%`,
            top: `${(-crop.y / crop.height) * 100}%`,
        },
    };
}

function previewStageStyle(width: number, height: number): CSSProperties {
    const safeWidth = Math.max(1, width);
    const safeHeight = Math.max(1, height);
    return {
        aspectRatio: `${safeWidth} / ${safeHeight}`,
        maxWidth: `min(100%, ${(280 * safeWidth) / safeHeight}px)`,
        marginInline: 'auto',
    };
}
