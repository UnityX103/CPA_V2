import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { isTauri, invoke } from '@tauri-apps/api/core';
import type { KegelWindowSnapshot } from './controller';
import { kegelColors, kegelOwnsBreak, kegelScale, KEGEL_RESET_SECONDS, type KegelSettings } from './domain/kegel';
import { kegelStats } from './domain/kegelHistory';
import { KegelAudio, type KegelAudioPlayer } from './domain/kegelAudio';
import { KegelNativeAudio } from './domain/kegelNativeAudio';
import { KegelSettingsForm } from './SettingsForm';
const formatMmSs = (seconds: number) => `${Math.floor(Math.max(0, seconds) / 60).toString().padStart(2, '0')}:${Math.floor(Math.max(0, seconds) % 60).toString().padStart(2, '0')}`;

export function KegelView({ snapshot, toggle, dismiss, apply }: {
    snapshot: KegelWindowSnapshot;
    toggle: () => Promise<void> | void;
    dismiss: () => Promise<void> | void;
    apply: (settings: KegelSettings) => Promise<void>;
}) {
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [error, setError] = useState('');
    const [audioError, setAudioError] = useState('');
    const [displayScale, setDisplayScale] = useState(1);
    const latest = useRef(snapshot);
    latest.current = snapshot;
    const audio = useRef<KegelAudioPlayer | null>(null);
    const scaleRef = useRef(1);
    const session = snapshot.session;
    const scale = kegelScale(session);
    const colors = kegelColors(session);
    const stats = kegelStats(snapshot.history);
    const waiting = session?.phase === 'waiting';
    const paused = session?.paused;
    const resetting = session?.phase === 'resetting';
    const complete = snapshot.completed || session?.phase === 'finished';
    const title = complete ? '这一组，完成了' : waiting ? '给自己一个休息' : paused ? '已暂停'
        : resetting ? '准备继续' : session?.phase === 'contract' ? '收缩 · 保持' : '慢慢放松';
    const call = async (action: () => Promise<void> | void) => {
        try { await action(); setError(''); }
        catch (reason) { setError(String(reason)); }
    };
    const onToggle = async () => {
        if (complete) return;
        try { await audio.current?.unlock(); }
        catch { setAudioError('声音暂不可用，可继续使用泡泡引导。'); }
        setSettingsOpen(false);
        await call(toggle);
    };
    useEffect(() => {
        audio.current = isTauri() ? new KegelNativeAudio(setAudioError) : new KegelAudio();
        return () => { audio.current?.dispose(); audio.current = null; };
    }, []);
    useEffect(() => { audio.current?.setOutputDevice(snapshot.audioOutputDeviceId ?? null); }, [snapshot.audioOutputDeviceId]);
    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            if (event.key !== 'Escape') return;
            if (event.defaultPrevented) return;
            event.preventDefault();
            if (settingsOpen) setSettingsOpen(false); else void call(dismiss);
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [settingsOpen, dismiss]);
    useEffect(() => {
        if (complete) return;
        audio.current?.update(scale, !!session && kegelOwnsBreak(session) && !session.paused && !waiting,
            snapshot.settings.muted ? 0 : snapshot.settings.volume,
            session?.phase ?? 'waiting', `${session?.id}:${session?.completedReps}:${session?.phase}`,
            resetting ? KEGEL_RESET_SECONDS : session?.phase === 'contract' ? session.plan.contractSeconds : session?.plan.relaxSeconds);
    }, [snapshot, scale, waiting]);
    useEffect(() => {
        if (complete) audio.current?.finish(snapshot.settings.muted ? 0 : snapshot.settings.volume);
    }, [complete]);
    useEffect(() => {
        // Snapshot updates are 20 Hz. Interpolate only between received positions, so
        // pausing or losing transport never silently advances the exercise.
        let frame = 0;
        let lastHitAt = 0;
        const animate = (now: number) => {
            const target = kegelScale(latest.current.session);
            scaleRef.current += (target - scaleRef.current) * 0.45;
            if (Math.abs(target - scaleRef.current) < 0.00005) scaleRef.current = target;
            setDisplayScale(scaleRef.current);
            if (isTauri() && now - lastHitAt >= 50) {
                lastHitAt = now;
                const regions = Array.from(document.querySelectorAll<HTMLElement>('[data-kegel-hit]')).map((element) => {
                    const rect = element.getBoundingClientRect();
                    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height,
                        radius: element.dataset.kegelHit === 'circle' ? rect.width / 2 : 18 };
                });
                void invoke('update_kegel_hit_regions', { width: window.innerWidth, height: window.innerHeight, regions }).catch(() => {});
            }
            frame = requestAnimationFrame(animate);
        };
        frame = requestAnimationFrame(animate);
        return () => cancelAnimationFrame(frame);
    }, []);
    useEffect(() => { scaleRef.current = scale; }, [paused]);
    return <main className="kegel-stage" aria-label="凯格尔运动引导">
        <div className="kegel-topline" data-kegel-hit="panel">
            <span className="kegel-wordmark">休息 · 凯格尔</span>
            <span>连续 {stats.streak} 天 · 今日 {stats.sets} 组 / {stats.repetitions} 次</span>
        </div>
        <div className="kegel-orbit" data-color-temperature={colors.warm ? 'warm' : 'cold'} style={{ '--bubble-scale': displayScale,
            '--bubble-cold-light': colors.coldLight, '--bubble-cold-dark': colors.coldDark,
            '--bubble-warm-light': colors.warmLight, '--bubble-warm-dark': colors.warmDark,
            '--warm-opacity': colors.warm || complete ? 1 : 0 } as CSSProperties}>
            <button data-kegel-hit="circle" className="kegel-bubble" aria-label={waiting ? '开始凯格尔运动' : paused ? '恢复凯格尔运动' : '暂停凯格尔运动'}
                disabled={complete} onClick={() => { void onToggle(); }}>
                <span className="kegel-bubble-glint" />
            </button>
            <div className="kegel-center-copy">
                <span className="kegel-eyebrow">{waiting ? `${snapshot.settings.repetitions} 次 · 1 组` : complete ? 'GOOD REST' : `${Math.min((session?.completedReps ?? 0) + 1, session?.plan.repetitions ?? 15)} / ${session?.plan.repetitions ?? 15} 次`}</span>
                <h1>{title}</h1>
                <p>{waiting ? '点击泡泡，运动与休息同时开始' : complete ? '回到自己的节奏' : paused ? '点击继续，重新开始当前动作' : resetting ? '舒张复位中' : '点击泡泡暂停'}</p>
            </div>
        </div>
        <div className="kegel-bottomline" data-kegel-hit="panel">
            <div className="kegel-time"><span>休息剩余</span><strong>{formatMmSs(snapshot.remainingSeconds)}</strong>
                {snapshot.remainingSeconds === 0 && !complete && <span>完成本组后结束休息</span>}</div>
            <div className="kegel-actions">
                {waiting && <button onClick={() => setSettingsOpen((s) => !s)}>节奏设置</button>}
                <button onClick={() => { void call(() => apply({ ...snapshot.settings, muted: !snapshot.settings.muted })); }} aria-label={snapshot.settings.muted ? '开启音效' : '静音'}>{snapshot.settings.muted ? '音效关' : '音效开'}</button>
                {!complete && <button onClick={() => { void call(dismiss); }}>{waiting ? '本次跳过' : '结束运动'}</button>}
            </div>
            {(error || audioError || snapshot.error) && <p role="alert">{error || audioError || snapshot.error}</p>}
        </div>
        {settingsOpen && <aside className="kegel-floating-settings" data-kegel-hit="panel">
            <div className="kegel-floating-heading"><strong>运动节奏</strong><button aria-label="关闭节奏设置" onClick={() => setSettingsOpen(false)}>×</button></div>
            <KegelSettingsForm compact settings={snapshot.settings} apply={apply} />
        </aside>}
    </main>;
}
