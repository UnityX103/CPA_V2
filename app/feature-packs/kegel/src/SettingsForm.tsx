import { useEffect, useState } from 'react';
import type { KegelSettings as Settings } from './domain/kegel';
import { kegelStats, localDay, type KegelRecord } from './domain/kegelHistory';
import { NumberInput } from '../../../src/ui/TextInput';

export function KegelSettingsForm({ settings, apply }: {
    settings: Settings; apply: (settings: Settings) => Promise<void>; compact?: boolean;
}) {
    const [draft, setDraft] = useState(settings);
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState('');
    useEffect(() => { setDraft(settings); }, [settings.enabled, settings.repetitions,
        settings.contractSeconds, settings.relaxSeconds, settings.volume, settings.muted]);
    const edit = (patch: Partial<Settings>) => { setDraft((s) => ({ ...s, ...patch })); setMessage(''); };
    const save = async () => {
        setSaving(true); setMessage('');
        try { await apply(draft); setMessage('已保存'); }
        catch (reason) { setMessage(`保存失败：${String(reason)}`); }
        finally { setSaving(false); }
    };
    return <div className="kegel-settings-form" data-kegel-hit="panel">
        <label><span>每组次数</span><NumberInput aria-label="每组次数" value={draft.repetitions} min={1} max={99} suffix="次" onChange={(repetitions) => edit({ repetitions })} /></label>
        <label><span>收缩含保持</span><NumberInput aria-label="收缩含保持秒数" value={draft.contractSeconds} min={1} max={60} suffix="秒" onChange={(contractSeconds) => edit({ contractSeconds })} /></label>
        <label><span>缓慢放松</span><NumberInput aria-label="放松秒数" value={draft.relaxSeconds} min={1} max={60} suffix="秒" onChange={(relaxSeconds) => edit({ relaxSeconds })} /></label>
        <label><span>编钟音效</span><input aria-label="编钟音效音量" type="range" min="0" max="1" step="0.01" value={draft.volume} onChange={(e) => edit({ volume: Number(e.target.value) })} /></label>
        <label><span>静音</span><input type="checkbox" checked={draft.muted} onChange={(e) => edit({ muted: e.target.checked })} /></label>
        <p className="kegel-form-note">每次休息做 1 组，约 {draft.repetitions * (draft.contractSeconds + draft.relaxSeconds)} 秒。参数用于节奏提示。</p>
        <button className="kegel-primary" disabled={saving} onClick={() => { void save(); }}>{saving ? '保存中…' : '保存设置'}</button>
        {message && <p role="status" className="kegel-form-note">{message}</p>}
    </div>;
}

export function KegelStatistics({ history }: { history: KegelRecord[] }) {
    const [today, setToday] = useState(localDay());
    useEffect(() => { const id = window.setInterval(() => setToday(localDay()), 10000); return () => window.clearInterval(id); }, []);
    const stats = kegelStats(history, today);
    return <section className="kegel-statistics" aria-label="凯格尔运动记录">
        <div className="kegel-stats-grid">
            <div><strong>{stats.streak}</strong><span>连续天数</span></div>
            <div><strong>{stats.sets}</strong><span>今日完成组</span></div>
            <div><strong>{stats.repetitions}</strong><span>今日完成次数</span></div>
        </div>
        <p className="kegel-form-note">{stats.todayDone ? '今天已完成，继续保持你的节奏。' : '今天完成至少 1 整组，即计入连续天数。'}</p>
        {stats.records.length > 0 && <ol className="kegel-history-list">{stats.records.map((r, index) => {
            const total = Object.values(r.repsByDay).reduce((sum, count) => sum + count, 0);
            return <li key={r.id}><span>第 {index + 1} 组 · 目标 {r.targetReps} 次</span>
                <span>{r.completedOn ? '已完成' : `已做 ${total} 次 / 未完成`}</span></li>;
        })}</ol>}
    </section>;
}
