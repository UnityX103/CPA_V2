import { useEffect, useState } from 'react';
import {
    downloadVideoEditorModule,
    launchVideoEditorModule,
    listenVideoEditorModuleProgress,
    readVideoEditorModuleStatus,
    uninstallVideoEditorModule,
    videoEditorModuleProgressText,
    type VideoEditorModuleProgress,
    type VideoEditorModuleStatus,
} from '../domain/videoEditorModule';
import './VideoEditorModuleTab.css';

export function VideoEditorModuleTab() {
    const [status, setStatus] = useState<VideoEditorModuleStatus | null>(null);
    const [progress, setProgress] = useState<VideoEditorModuleProgress | null>(null);
    const [busy, setBusy] = useState<'download' | 'launch' | 'uninstall' | null>(null);
    const [error, setError] = useState('');

    useEffect(() => {
        let disposed = false;
        void readVideoEditorModuleStatus()
            .then((value) => { if (!disposed) setStatus(value); })
            .catch((reason) => { if (!disposed) setError(errorText(reason)); });
        let unlisten: (() => void) | undefined;
        void listenVideoEditorModuleProgress((value) => {
            if (!disposed) setProgress(value);
        }).then((value) => {
            if (disposed) value();
            else unlisten = value;
        });
        return () => {
            disposed = true;
            unlisten?.();
        };
    }, []);

    const download = async () => {
        setBusy('download');
        setError('');
        try {
            setStatus(await downloadVideoEditorModule());
        } catch (reason) {
            setError(errorText(reason));
        } finally {
            setBusy(null);
        }
    };

    const launch = async () => {
        setBusy('launch');
        setError('');
        try {
            await launchVideoEditorModule();
        } catch (reason) {
            setError(errorText(reason));
        } finally {
            setBusy(null);
        }
    };

    const uninstall = async () => {
        setBusy('uninstall');
        setError('');
        try {
            setStatus(await uninstallVideoEditorModule());
            setProgress(null);
        } catch (reason) {
            setError(errorText(reason));
        } finally {
            setBusy(null);
        }
    };

    const installed = status?.installed ?? false;
    return (
        <div className="settings-content-scroll video-module-scroll">
            <div className="tab-pane video-module-pane">
                <section className="card video-module-hero">
                    <div>
                        <h3 className="card-title video-module-title">AI 视频编辑器</h3>
                        <p className="video-module-description">
                            使用 SAM 2.1 跟踪主体，并由 BiRefNet 恢复毛发软边，生成当前软件可用的透明 WebM。
                        </p>
                    </div>
                    <span className={`video-module-badge ${installed ? 'installed' : ''}`}>
                        {installed ? '已下载' : '未下载'}
                    </span>
                </section>

                {!installed ? (
                    <section className="card video-module-download-card">
                        <div className="video-module-download-copy">
                            <strong>视频编辑模板需要单独下载</strong>
                            <span>
                                下载包包含完整编辑界面、SAM2/BiRefNet worker、模型、媒体工具和第三方许可；默认应用包不包含这些内容。
                            </span>
                            <span className="video-module-target">
                                当前平台：{status?.target ?? '正在识别…'}
                            </span>
                            <span className="video-module-target">
                                正式下载仅接受已签名索引、合规模型和通过目标平台验收的运行包。
                            </span>
                        </div>
                        <button
                            type="button"
                            className="btn btn-primary video-module-action"
                            aria-label="下载视频编辑模板"
                            disabled={busy !== null}
                            onClick={() => { void download(); }}
                        >
                            {busy === 'download' ? '下载中…' : '下载模板'}
                        </button>
                        {progress && busy === 'download' ? <ModuleProgress progress={progress} /> : null}
                    </section>
                ) : (
                    <section className="card video-module-ready-card">
                        <div>
                            <strong>视频编辑模板 {status?.version}</strong>
                            <span>界面与 AI 运行时位于应用数据目录，可独立升级或删除。</span>
                        </div>
                        <div className="video-module-buttons">
                            <button
                                type="button"
                                className="btn btn-primary"
                                aria-label="打开视频编辑器"
                                disabled={busy !== null}
                                onClick={() => { void launch(); }}
                            >
                                {busy === 'launch' ? '启动中…' : '打开编辑器'}
                            </button>
                            <button
                                type="button"
                                className="btn btn-secondary"
                                aria-label="删除视频编辑模板"
                                disabled={busy !== null}
                                onClick={() => { void uninstall(); }}
                            >
                                {busy === 'uninstall' ? '删除中…' : '删除模板'}
                            </button>
                        </div>
                    </section>
                )}

                <section className="card video-module-boundary-card">
                    <span>模板内保留：当前帧截图、输出分辨率、时间范围、透明成品预览与导出。</span>
                    <span>模板内移除：裁剪框拖拽、画笔剔除和任何区域绘制工具。</span>
                </section>
                {error ? <div className="video-module-error" role="alert">{error}</div> : null}
            </div>
        </div>
    );
}

function ModuleProgress({ progress }: { progress: VideoEditorModuleProgress }) {
    const percent = progress.totalBytes && progress.totalBytes > 0
        ? Math.min(100, Math.floor((progress.downloadedBytes / progress.totalBytes) * 100))
        : null;
    return (
        <div className="video-module-progress" aria-label="视频编辑模板下载进度">
            <div className="video-module-progress-track">
                <div
                    className={`video-module-progress-fill ${percent === null ? 'indeterminate' : ''}`}
                    style={percent === null ? undefined : { width: `${percent}%` }}
                />
            </div>
            <span>{videoEditorModuleProgressText(progress)}</span>
        </div>
    );
}

function errorText(reason: unknown): string {
    if (reason instanceof Error) return reason.message;
    return typeof reason === 'string' ? reason : '视频编辑模块操作失败';
}
