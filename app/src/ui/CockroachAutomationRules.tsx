import { useEffect, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { POMODORO_RULE_EVENTS } from '../domain/pomodoroEvents';
import {
    COCKROACH_ACTIONS, COCKROACH_AUTOMATION_RESULT,
    readCockroachRules, saveCockroachRules, type CockroachRule,
} from '../domain/cockroachAutomation';

export function CockroachAutomationRules() {
    const [rows, setRows] = useState<Array<CockroachRule & { key: string }>>([]);
    const [ready, setReady] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [saved, setSaved] = useState(false);
    useEffect(() => {
        let disposed = false;
        let unlisten: (() => void) | undefined;
        void readCockroachRules().then((rules) => {
            if (disposed) return;
            setRows(rules.map((rule) => ({ ...rule, key: crypto.randomUUID() })));
            setReady(true);
        }).catch((reason) => { if (!disposed) setError(String(reason)); });
        void listen<{ error: string | null }>(COCKROACH_AUTOMATION_RESULT, ({ payload }) => {
            if (!disposed && payload.error) setError(payload.error);
        }).then((cleanup) => { if (disposed) cleanup(); else unlisten = cleanup; }).catch(() => {});
        return () => { disposed = true; unlisten?.(); };
    }, []);
    const change = (key: string, patch: Partial<CockroachRule>) => {
        setRows((current) => current.map((row) => row.key === key ? { ...row, ...patch } : row));
        setSaved(false);
    };
    const save = async () => {
        setSaving(true); setError(''); setSaved(false);
        try { await saveCockroachRules(rows.map(({ event, action }) => ({ event, action }))); setSaved(true); }
        catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
        finally { setSaving(false); }
    };
    return (
        <section className="cockroach-rules" aria-label="蟑螂事件规则">
            <div className="cockroach-rules-heading">
                <strong>事件与操作</strong>
                <button type="button" className="btn btn-secondary" disabled={!ready || saving || rows.length >= 32}
                    onClick={() => { setRows((current) => [...current, { key: crypto.randomUUID(), event: 'break.present', action: 'spawn-one' }]); setSaved(false); }}>
                    添加规则
                </button>
            </div>
            <div className="cockroach-rule-columns" aria-hidden="true"><span>事件</span><span>操作</span><span /></div>
            {rows.map((row, index) => (
                <div className="cockroach-rule-row" key={row.key}>
                    <select aria-label={`规则 ${index + 1} 事件`} value={row.event} disabled={saving}
                        onChange={(event) => change(row.key, { event: event.target.value as CockroachRule['event'] })}>
                        {POMODORO_RULE_EVENTS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                    </select>
                    <select aria-label={`规则 ${index + 1} 操作`} value={row.action} disabled={saving}
                        onChange={(event) => change(row.key, { action: event.target.value as CockroachRule['action'] })}>
                        {COCKROACH_ACTIONS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                    </select>
                    <button type="button" className="cockroach-rule-remove" aria-label={`删除规则 ${index + 1}`} disabled={saving}
                        onClick={() => { setRows((current) => current.filter((item) => item.key !== row.key)); setSaved(false); }}>×</button>
                </div>
            ))}
            {ready && rows.length === 0 ? <p className="cockroach-rules-empty">暂无规则，蟑螂不会自动出现。点击“添加规则”设置触发方式。</p> : null}
            <p className="cockroach-rules-hint">同一事件按列表顺序执行。在工位事件需要开启摄像头检测；休息期间每次因在场检测而暂停时触发一次。</p>
            <div className="cockroach-rules-save">
                <button type="button" className="btn btn-primary" disabled={!ready || saving} onClick={() => { void save(); }}>{saving ? '保存中…' : '保存规则'}</button>
                {saved ? <span role="status">规则已保存</span> : null}
            </div>
            {error ? <div className="cockroach-module-error" role="alert">{error}</div> : null}
        </section>
    );
}
