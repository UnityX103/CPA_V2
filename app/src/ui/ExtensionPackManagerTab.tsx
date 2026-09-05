import {
    extensionPackCatalog,
    extensionPackRegistry,
    useExtensionPackStore,
    type ExtensionPackId,
} from '../domain/extensionPacks';
import './ExtensionPackManagerTab.css';

const FEATURE_PACKS = extensionPackCatalog.filter((pack) => pack.kind === 'feature');
const COMMON_PACKS = extensionPackCatalog.filter((pack) => pack.kind === 'common');

export function ExtensionPackManagerTab() {
    const hydrated = useExtensionPackStore((state) => state.hydrated);
    const statuses = useExtensionPackStore((state) => state.statuses);
    const busyPackId = useExtensionPackStore((state) => state.busyPackId);
    const progress = useExtensionPackStore((state) => state.progress);
    const error = useExtensionPackStore((state) => state.error);
    const install = useExtensionPackStore((state) => state.install);
    const setEnabled = useExtensionPackStore((state) => state.setEnabled);
    const uninstall = useExtensionPackStore((state) => state.uninstall);

    const renderPack = (packId: ExtensionPackId) => {
        const descriptor = extensionPackRegistry[packId];
        const status = statuses[packId];
        const dependentDescriptor = extensionPackCatalog.find((candidate) => (
            candidate.dependencies.includes(packId)
        ));
        const dependent = dependentDescriptor ? statuses[dependentDescriptor.id] : null;
        const disableBlocked = Boolean(dependent?.installed && dependent.enabled);
        const uninstallBlocked = Boolean(dependent?.installed);
        const anyBusy = busyPackId !== null;
        const isBusy = busyPackId === packId;
        const packProgress = isBusy && progress?.packId === packId ? progress : null;
        const percent = packProgress?.totalBytes
            ? Math.min(100, Math.round((packProgress.downloadedBytes / packProgress.totalBytes) * 100))
            : null;

        return (
            <article className={`extension-pack-card ${descriptor.kind}`} key={packId}>
                <div className="extension-pack-heading">
                    <span className="extension-pack-icon" aria-hidden="true">{descriptor.icon}</span>
                    <div className="extension-pack-title-block">
                        <div className="extension-pack-title-row">
                            <h3>{descriptor.name}</h3>
                            <span className={`extension-pack-status ${status.enabled ? 'enabled' : status.installed ? 'disabled' : ''}`}>
                                {status.enabled ? '已启用' : status.installed ? '已禁用' : '未安装'}
                            </span>
                        </div>
                        <span className="extension-pack-version">
                            {status.version
                                ? descriptor.kind === 'feature' ? `v${status.version}` : status.version
                                : status.target === 'unknown' ? '正在读取状态…' : status.target}
                        </span>
                    </div>
                </div>
                <p className="extension-pack-description">{descriptor.description}</p>
                <div className="extension-pack-contents">{descriptor.contents}</div>

                {status.installed ? (
                    <div className="extension-pack-actions">
                        <button
                            type="button"
                            className="btn btn-secondary"
                            aria-label={`升级 ${descriptor.name}`}
                            disabled={anyBusy}
                            onClick={() => { void install(packId); }}
                        >
                            {isBusy ? '处理中…' : '升级'}
                        </button>
                        <button
                            type="button"
                            className="btn btn-secondary"
                            aria-label={`${status.enabled ? '禁用' : '启用'} ${descriptor.name}`}
                            disabled={anyBusy || (status.enabled && disableBlocked)}
                            onClick={() => { void setEnabled(packId, !status.enabled); }}
                        >
                            {status.enabled ? '禁用' : '启用'}
                        </button>
                        <button
                            type="button"
                            className="btn btn-secondary extension-pack-uninstall"
                            aria-label={`卸载 ${descriptor.name}`}
                            disabled={anyBusy || uninstallBlocked}
                            onClick={() => { void uninstall(packId); }}
                        >
                            卸载
                        </button>
                    </div>
                ) : (
                    <button
                        type="button"
                        className="btn btn-primary extension-pack-download"
                        aria-label={`下载 ${descriptor.name}`}
                        disabled={!hydrated || anyBusy}
                        onClick={() => { void install(packId); }}
                    >
                        {isBusy ? '下载中…' : '下载'}
                    </button>
                )}

                {packProgress ? (
                    <div className="extension-pack-progress" aria-label={`${descriptor.name}下载进度`}>
                        <div className="extension-pack-progress-track">
                            <span
                                className={percent === null ? 'indeterminate' : ''}
                                style={percent === null ? undefined : { width: `${percent}%` }}
                            />
                        </div>
                        <span>{packProgress.message}{percent === null ? '' : ` · ${percent}%`}</span>
                    </div>
                ) : null}

                {descriptor.kind === 'common' && dependent ? (
                    <span className="extension-pack-guard">
                        {dependent.installed
                            ? `${extensionPackRegistry[dependent.id].name} 正在依赖此包`
                            : '当前没有功能包依赖，可单独卸载'}
                    </span>
                ) : null}
            </article>
        );
    };

    return (
        <div className="settings-content-scroll">
            <div className="tab-pane extension-manager-pane">
                <header className="extension-manager-intro">
                    <h3>扩展包</h3>
                    <p>按需安装功能；大型通用运行时只下载一次，并可被同类扩展复用。</p>
                </header>

                <div className="extension-manager-group-heading">
                    <strong>功能扩展</strong>
                    <span>启用后自动加入左侧设置栏目</span>
                </div>
                <div className="extension-pack-grid">
                    {FEATURE_PACKS.map((pack) => renderPack(pack.id))}
                </div>

                <div className="extension-manager-group-heading">
                    <strong>通用运行时</strong>
                    <span>依赖保护会阻止误禁用或误卸载</span>
                </div>
                <div className="extension-common-list">
                    {COMMON_PACKS.map((pack) => renderPack(pack.id))}
                </div>

                {error ? <div className="extension-pack-error" role="alert">{error}</div> : null}
            </div>
        </div>
    );
}
