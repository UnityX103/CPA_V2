import { useEffect, useMemo, useState } from 'react';
import { useSettingsStore, type DangerousChange } from '../domain/settings';

function secondsRemaining(change: DangerousChange, now: number): number {
    return Math.max(0, Math.ceil((change.expiresAt - now) / 1000));
}

export function DangerousChangeDialog() {
    const change = useSettingsStore((s) => s.dangerousChange);
    const applyDangerousChange = useSettingsStore((s) => s.applyDangerousChange);
    const revertDangerousChange = useSettingsStore((s) => s.revertDangerousChange);
    const [now, setNow] = useState(() => Date.now());

    useEffect(() => {
        if (!change) return;
        setNow(Date.now());
        const interval = window.setInterval(() => {
            setNow(Date.now());
        }, 250);
        return () => window.clearInterval(interval);
    }, [change?.id]);

    useEffect(() => {
        if (!change) return;
        if (now >= change.expiresAt) {
            revertDangerousChange(change.id);
        }
    }, [change, now, revertDangerousChange]);

    const copy = useMemo(() => {
        if (change?.kind === 'uiScale') {
            return {
                title: '应用界面缩放？',
                body: '界面缩放会立即影响所有窗口。如果当前比例导致界面难以操作，倒计时结束后会自动还原。',
            };
        }
        return {
            title: '应用危险设置？',
            body: '此设置会立即影响全局界面。倒计时结束后会自动还原。',
        };
    }, [change?.kind]);

    if (!change) return null;

    return (
        <div className="danger-modal-layer" aria-modal="true">
            <div className="danger-modal-mask" data-testid="dangerous-change-mask" />
            <div className="danger-dialog" role="dialog" aria-label={copy.title}>
                <div className="danger-dialog-header">
                    <div className="danger-dialog-title-wrap">
                        <h3 className="danger-dialog-title">{copy.title}</h3>
                    </div>
                </div>
                <div className="danger-dialog-countdown">
                    剩余 {secondsRemaining(change, now)}s 后自动还原
                </div>
                <p className="danger-dialog-body">{copy.body}</p>
                <div className="danger-dialog-actions">
                    <button className="btn btn-secondary btn-fit" onClick={() => revertDangerousChange(change.id)}>
                        取消
                    </button>
                    <button className="btn btn-primary btn-fit" onClick={() => applyDangerousChange(change.id)}>
                        应用
                    </button>
                </div>
            </div>
        </div>
    );
}
