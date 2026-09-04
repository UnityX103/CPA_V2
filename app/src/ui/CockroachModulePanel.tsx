import { useEffect, useState } from 'react';
import {
    killAllCockroaches,
    launchCockroachModule,
    readCockroachModuleStatus,
    saveCockroachModuleSettings,
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
    const [busy, setBusy] = useState<'launch' | 'kill' | 'save' | null>(null);
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
        return () => {
            disposed = true;
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
                    {installed ? (status?.running ? '运行中' : '已启用') : '不可用'}
                </span>
            </div>

            {!installed ? (
                <div className="cockroach-module-download">
                    <div>
                        <strong>蟑螂入侵当前不可用</strong>
                        <span>请前往“扩展包”检查安装与启用状态。</span>
                    </div>
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
                    </div>
                    <span className="cockroach-module-lifecycle-note">
                        安装、升级、启停与卸载请前往“扩展包”。
                    </span>
                </div>
            )}
            {error ? <div className="cockroach-module-error" role="alert">{error}</div> : null}
        </section>
    );
}

function errorText(reason: unknown): string {
    if (reason instanceof Error) return reason.message;
    return typeof reason === 'string' ? reason : '蟑螂模块操作失败';
}
