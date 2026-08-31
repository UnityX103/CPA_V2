import { useEffect, useState } from 'react';
import {
    cockroachModuleProgressText,
    downloadCockroachModule,
    killAllCockroaches,
    launchCockroachModule,
    listenCockroachModuleProgress,
    readCockroachModuleStatus,
    saveCockroachModuleSettings,
    uninstallCockroachModule,
    type CockroachModuleProgress,
    type CockroachModuleSettings,
    type CockroachModuleStatus,
} from '../domain/cockroachModule';
import './CockroachModulePanel.css';

const DEFAULT_SETTINGS: CockroachModuleSettings = {
    maxCount: 30,
    babyGrowthMinutes: 10,
};

export function CockroachModulePanel() {
    const [status, setStatus] = useState<CockroachModuleStatus | null>(null);
    const [settings, setSettings] = useState<CockroachModuleSettings>(DEFAULT_SETTINGS);
    const [progress, setProgress] = useState<CockroachModuleProgress | null>(null);
    const [busy, setBusy] = useState<'download' | 'launch' | 'kill' | 'save' | 'uninstall' | null>(null);
    const [error, setError] = useState('');

    useEffect(() => {
        let disposed = false;
        void readCockroachModuleStatus()
            .then((value) => {
                if (disposed) return;
                setStatus(value);
                setSettings(value.settings);
            })
            .catch((reason) => { if (!disposed) setError(errorText(reason)); });
        let unlisten: (() => void) | undefined;
        void listenCockroachModuleProgress((value) => {
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

    const perform = async (
        operation: NonNullable<typeof busy>,
        action: () => Promise<CockroachModuleStatus>,
    ) => {
        setBusy(operation);
        setError('');
        try {
            const next = await action();
            setStatus(next);
            setSettings(next.settings);
            if (operation === 'uninstall') setProgress(null);
        } catch (reason) {
            setError(errorText(reason));
        } finally {
            setBusy(null);
        }
    };

    const updateSetting = (key: keyof CockroachModuleSettings, raw: string) => {
        const bounds = key === 'maxCount' ? [1, 99] : [1, 60];
        const parsed = Number.parseInt(raw, 10);
        const value = Number.isFinite(parsed)
            ? Math.max(bounds[0], Math.min(bounds[1], parsed))
            : bounds[0];
        setSettings((current) => ({ ...current, [key]: value }));
    };

    const installed = status?.installed ?? false;
    return (
        <section className="card cockroach-module-card" aria-label="蟑螂入侵模块设置">
            <div className="cockroach-module-heading">
                <div>
                    <strong>蟑螂入侵模块</strong>
                    <span>基于 CockroachPet-Public-Electron，作为独立进程按需安装与运行。</span>
                </div>
                <span className={`cockroach-module-badge ${installed ? 'installed' : ''}`}>
                    {installed ? (status?.running ? '运行中' : '已下载') : '未下载'}
                </span>
            </div>

            {!installed ? (
                <div className="cockroach-module-download">
                    <div>
                        <strong>蟑螂模块需要单独下载</strong>
                        <span>默认安装包不包含 Electron 运行时和蟑螂程序。</span>
                        <span>当前平台：{status?.target ?? '正在识别…'}</span>
                    </div>
                    <button
                        type="button"
                        className="btn btn-primary"
                        aria-label="下载蟑螂模块"
                        disabled={busy !== null}
                        onClick={() => { void perform('download', downloadCockroachModule); }}
                    >
                        {busy === 'download' ? '下载中…' : '下载模块'}
                    </button>
                    {progress && busy === 'download' ? <ModuleProgress progress={progress} /> : null}
                </div>
            ) : (
                <div className="cockroach-module-ready">
                    <div className="cockroach-module-fields">
                        <label>
                            <span>最大蟑螂数量</span>
                            <input
                                aria-label="最大蟑螂数量"
                                type="number"
                                min="1"
                                max="99"
                                value={settings.maxCount}
                                onChange={(event) => updateSetting('maxCount', event.currentTarget.value)}
                            />
                        </label>
                        <label>
                            <span>幼虫成长时间</span>
                            <span className="cockroach-module-number-with-unit">
                                <input
                                    aria-label="幼虫成长时间"
                                    type="number"
                                    min="1"
                                    max="60"
                                    value={settings.babyGrowthMinutes}
                                    onChange={(event) => updateSetting('babyGrowthMinutes', event.currentTarget.value)}
                                />
                                分钟
                            </span>
                        </label>
                    </div>
                    <div className="cockroach-module-actions">
                        <button
                            type="button"
                            className="btn btn-secondary"
                            aria-label="保存蟑螂设置"
                            disabled={busy !== null}
                            onClick={() => { void perform('save', () => saveCockroachModuleSettings(settings)); }}
                        >
                            {busy === 'save' ? '保存中…' : '保存设置'}
                        </button>
                        <button
                            type="button"
                            className="btn btn-primary"
                            aria-label="模拟蟑螂入侵"
                            disabled={busy !== null}
                            onClick={() => { void perform('launch', () => launchCockroachModule(settings)); }}
                        >
                            {busy === 'launch' ? '启动中…' : '模拟'}
                        </button>
                        <button
                            type="button"
                            className="btn btn-danger"
                            aria-label="杀死所有蟑螂"
                            disabled={busy !== null}
                            onClick={() => { void perform('kill', killAllCockroaches); }}
                        >
                            {busy === 'kill' ? '处理中…' : '杀死所有'}
                        </button>
                        <button
                            type="button"
                            className="btn btn-secondary"
                            aria-label="删除蟑螂模块"
                            disabled={busy !== null}
                            onClick={() => { void perform('uninstall', uninstallCockroachModule); }}
                        >
                            {busy === 'uninstall' ? '删除中…' : '删除模块'}
                        </button>
                    </div>
                </div>
            )}
            {error ? <div className="cockroach-module-error" role="alert">{error}</div> : null}
        </section>
    );
}

function ModuleProgress({ progress }: { progress: CockroachModuleProgress }) {
    const percent = progress.totalBytes && progress.totalBytes > 0
        ? Math.min(100, Math.floor((progress.downloadedBytes / progress.totalBytes) * 100))
        : null;
    return (
        <div className="cockroach-module-progress" aria-label="蟑螂模块下载进度">
            <div className="cockroach-module-progress-track">
                <div
                    className={`cockroach-module-progress-fill ${percent === null ? 'indeterminate' : ''}`}
                    style={percent === null ? undefined : { width: `${percent}%` }}
                />
            </div>
            <span>{cockroachModuleProgressText(progress)}</span>
        </div>
    );
}

function errorText(reason: unknown): string {
    if (reason instanceof Error) return reason.message;
    return typeof reason === 'string' ? reason : '蟑螂模块操作失败';
}
