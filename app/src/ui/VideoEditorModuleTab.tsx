import { useState } from 'react';
import { launchVideoEditorModule } from '../domain/videoEditorModule';
import { useExtensionPackStore } from '../domain/extensionPacks';
import './VideoEditorModuleTab.css';

export function VideoEditorModuleTab() {
    const status = useExtensionPackStore((state) => state.statuses['video.editor']);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    const launch = async () => {
        setBusy(true);
        setError('');
        try {
            await launchVideoEditorModule();
        } catch (reason) {
            setError(errorText(reason));
        } finally {
            setBusy(false);
        }
    };

    const available = status.installed && status.enabled;
    return (
        <div className="settings-content-scroll video-module-scroll">
            <div className="tab-pane video-module-pane">
                <section className="card video-module-hero">
                    <div>
                        <h3 className="card-title video-module-title">AI 视频编辑器</h3>
                        <p className="video-module-description">
                            使用 SAM 2.1 跟踪主体，并由 BiRefNet 恢复毛发软边；支持自动/点选主体和可调抠图参数。
                        </p>
                    </div>
                    <span className={`video-module-badge ${available ? 'installed' : ''}`}>
                        {available ? '已启用' : '不可用'}
                    </span>
                </section>

                {!available ? (
                    <section className="card video-module-download-card">
                        <div className="video-module-download-copy">
                            <strong>视频编辑功能包当前不可用</strong>
                            <span>请前往“扩展包”检查安装与启用状态。</span>
                        </div>
                    </section>
                ) : (
                    <section className="card video-module-ready-card">
                        <div>
                            <strong>视频编辑功能包 {status.version}</strong>
                            <span>编辑器在独立进程中运行；包生命周期由“扩展包”页面统一管理。</span>
                        </div>
                        <div className="video-module-buttons">
                            <button
                                type="button"
                                className="btn btn-primary"
                                aria-label="打开视频编辑器"
                                disabled={busy}
                                onClick={() => { void launch(); }}
                            >
                                {busy ? '启动中…' : '打开编辑器'}
                            </button>
                        </div>
                    </section>
                )}

                {error ? <div className="video-module-error" role="alert">{error}</div> : null}
            </div>
        </div>
    );
}

function errorText(reason: unknown): string {
    if (reason instanceof Error) return reason.message;
    return typeof reason === 'string' ? reason : '视频编辑模块操作失败';
}
