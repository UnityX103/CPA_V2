import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useAppUpdateStore } from '../domain/appUpdate';
import './AppUpdatePreview.css';

export function AppUpdatePreview() {
    const update = useAppUpdateStore();
    const panel = useRef<HTMLDialogElement>(null);
    const visible = ['available', 'downloading', 'installing', 'readyToRestart'].includes(update.status)
        || (update.status === 'error' && !!update.availableVersion);
    useEffect(() => {
        if (visible && !panel.current?.open) panel.current?.showModal();
        if (!visible && panel.current?.open) panel.current.close();
    }, [visible]);
    const busy = update.status === 'downloading' || update.status === 'installing';
    const sections = (update.releaseNotes ?? '此版本未提供更新说明。').split(/^## (?=\d+\.\d+\.\d+\s*$)/m);
    return createPortal(<dialog ref={panel} className="app-update-preview" aria-labelledby="update-preview-title"
        onPointerDown={(event) => event.stopPropagation()}
        onCancel={(event) => { event.preventDefault(); if (['available', 'error'].includes(update.status)) void update.remindLater(); }}>
        <h2 id="update-preview-title">发现新版本 {update.availableVersion}</h2>
        <p>当前版本 {update.currentVersion} → {update.availableVersion}</p>
        <div className="app-update-preview__notes" tabIndex={0} aria-label="版本更新内容">
            {sections.filter(Boolean).map((section, index) => {
                const [heading, ...lines] = section.trim().split('\n');
                return <details key={index} open>
                    <summary>{/^\d+\.\d+\.\d+$/.test(heading) ? `版本 ${heading}` : '更新说明'}</summary>
                    <div>{/^\d+\.\d+\.\d+$/.test(heading) ? lines.join('\n') : section}</div>
                </details>;
            })}
        </div>
        {busy && <p role="status">{update.status === 'installing' ? '正在安装…' : `正在下载${update.downloadTotalBytes ? ` ${Math.min(100, Math.floor(update.downloadedBytes / update.downloadTotalBytes * 100))}%` : '…'}`}</p>}
        {update.status === 'error' && <p role="alert">更新失败：{update.errorMessage}</p>}
        <div className="app-update-preview__actions">
            {update.status === 'readyToRestart' ? <button className="btn btn-primary" onClick={() => void update.restartForUpdate()}>重启更新</button> : <>
                <button className="btn btn-primary" disabled={busy} onClick={() => void (update.status === 'error' ? update.checkNow() : update.installUpdate())}>{update.status === 'error' ? '重新检查' : '更新'}</button>
                <button className="btn btn-secondary" disabled={busy} onClick={() => void update.skipUpdate()}>跳过此版本</button>
                <button className="btn btn-secondary" disabled={busy} onClick={() => void update.remindLater()}>稍后提醒（1 小时）</button>
            </>}
        </div>
    </dialog>, document.body);
}
