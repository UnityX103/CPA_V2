import { useState, useEffect, useRef } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import {
    useSettingsStore,
    type SettingsTab,
    MIN_SCALE,
    MAX_SCALE,
} from '../domain/settings';
import {
    usePomodoroStore,
    type PomodoroEndActionMode,
    type PomodoroEndActionVideo,
} from '../domain/pomodoro';
import {
    BUILTIN_POMODORO_VIDEOS,
    DEFAULT_BUILTIN_POMODORO_VIDEO_ID,
} from '../domain/pomodoroVideos';
import { pickCustomWebmPath } from '../domain/videoFiles';
import { useNetworkStore } from '../domain/network';
import { useBindingKeyStore } from '../domain/bindingKey';
import './SettingsPanel.css';

const TABS: Array<{ id: SettingsTab; label: string }> = [
    { id: 'pomodoro', label: '番茄钟' },
    { id: 'online', label: '联机' },
    { id: 'pet', label: '宠物' },
    { id: 'global', label: '全局' },
];

export function SettingsPanel() {
    const activeTab = useSettingsStore((s) => s.activeTab);
    const setActiveTab = useSettingsStore((s) => s.setActiveTab);

    const onClose = () => { void invoke('close_settings_window'); };

    const onHeaderPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
        if (e.button !== 0) return;
        const target = e.target as HTMLElement;
        if (target.closest('button')) return;
        void getCurrentWindow().startDragging().catch(() => {
            /* drag may fail in non-Tauri/test env; swallow */
        });
    };

    return (
        <div
            className="settings-panel"
            role="dialog"
            aria-label="设置"
        >
            <div className="settings-head" onPointerDown={onHeaderPointerDown}>
                <h2 className="settings-title">设置</h2>
                <div className="settings-head-spacer" />
                <button className="settings-close" onClick={onClose} aria-label="关闭">
                    <CloseIcon />
                </button>
            </div>
            <div className="settings-body">
                <nav className="settings-nav">
                    {TABS.map((t) => (
                        <button
                            key={t.id}
                            className={`settings-tab ${activeTab === t.id ? 'active' : ''}`}
                            onClick={() => setActiveTab(t.id)}
                        >
                            {t.label}
                        </button>
                    ))}
                </nav>
                <div className="settings-content">
                    {activeTab === 'pomodoro' && <PomodoroTab />}
                    {activeTab === 'online' && <OnlineTab />}
                    {activeTab === 'pet' && <PetTab />}
                    {activeTab === 'global' && <GlobalTab />}
                </div>
            </div>
        </div>
    );
}

/* ============================================================
 * Pomodoro Settings (gs1Tv)
 * ============================================================ */

function PomodoroTab() {
    const pomo = usePomodoroStore();
    const [focusMin, setFocusMin] = useState(Math.round(pomo.focusDurationSeconds / 60));
    const [breakMin, setBreakMin] = useState(Math.round(pomo.breakDurationSeconds / 60));
    const [endActionMode, setEndActionMode] = useState<PomodoroEndActionMode>(pomo.endActionMode);
    const [endActionVideo, setEndActionVideo] = useState<PomodoroEndActionVideo>({ ...pomo.endActionVideo });
    const committedRef = useRef({
        focusDurationSeconds: pomo.focusDurationSeconds,
        breakDurationSeconds: pomo.breakDurationSeconds,
        endActionMode: pomo.endActionMode,
        endActionVideo: { ...pomo.endActionVideo },
    });

    useEffect(() => {
        const previous = committedRef.current;
        const durationDraftDirty =
            focusMin * 60 !== previous.focusDurationSeconds ||
            breakMin * 60 !== previous.breakDurationSeconds;
        const endActionDraftDirty =
            endActionMode !== previous.endActionMode ||
            !sameEndActionVideo(endActionVideo, previous.endActionVideo);

        if (!durationDraftDirty) {
            setFocusMin(Math.round(pomo.focusDurationSeconds / 60));
            setBreakMin(Math.round(pomo.breakDurationSeconds / 60));
        }
        if (!endActionDraftDirty) {
            setEndActionMode(pomo.endActionMode);
            setEndActionVideo((current) =>
                sameEndActionVideo(current, pomo.endActionVideo)
                    ? current
                    : { ...pomo.endActionVideo }
            );
        }

        committedRef.current = {
            focusDurationSeconds: pomo.focusDurationSeconds,
            breakDurationSeconds: pomo.breakDurationSeconds,
            endActionMode: pomo.endActionMode,
            endActionVideo: { ...pomo.endActionVideo },
        };
    }, [
        pomo.focusDurationSeconds,
        pomo.breakDurationSeconds,
        pomo.endActionMode,
        pomo.endActionVideo.sourceKind,
        pomo.endActionVideo.builtinVideoId,
        pomo.endActionVideo.customVideoPath,
        focusMin,
        breakMin,
        endActionMode,
        endActionVideo,
    ]);

    const dirty =
        focusMin * 60 !== pomo.focusDurationSeconds ||
        breakMin * 60 !== pomo.breakDurationSeconds ||
        endActionMode !== pomo.endActionMode ||
        !sameEndActionVideo(endActionVideo, pomo.endActionVideo);

    const apply = () => {
        const focusSeconds = focusMin * 60;
        const breakSeconds = breakMin * 60;
        const durationChanged =
            focusSeconds !== pomo.focusDurationSeconds ||
            breakSeconds !== pomo.breakDurationSeconds;
        const endActionChanged =
            endActionMode !== pomo.endActionMode ||
            !sameEndActionVideo(endActionVideo, pomo.endActionVideo);

        if (durationChanged) {
            pomo.applySettings(focusSeconds, breakSeconds, pomo.totalRounds, true);
        }
        if (endActionChanged) {
            pomo.applyEndActionSettings(endActionMode, endActionVideo);
        }
    };

    const selectedVideoOption = endActionVideo.sourceKind === 'custom'
        ? 'custom'
        : endActionVideo.builtinVideoId;

    const customVideoName = endActionVideo.customVideoPath
        ? pathBasename(endActionVideo.customVideoPath)
        : '未选择';

    const setVideoOption = (value: string) => {
        setEndActionMode('playVideo');
        if (value === 'custom') {
            setEndActionVideo((current) => ({
                sourceKind: 'custom',
                builtinVideoId: current.builtinVideoId || DEFAULT_BUILTIN_POMODORO_VIDEO_ID,
                customVideoPath: current.customVideoPath,
            }));
            return;
        }
        setEndActionVideo((current) => ({
            sourceKind: 'builtin',
            builtinVideoId: value,
            customVideoPath: current.customVideoPath,
        }));
    };

    const chooseCustomVideo = async () => {
        const path = await pickCustomWebmPath();
        if (!path) return;
        setEndActionMode('playVideo');
        setEndActionVideo((current) => ({
            sourceKind: 'custom',
            builtinVideoId: current.builtinVideoId || DEFAULT_BUILTIN_POMODORO_VIDEO_ID,
            customVideoPath: path,
        }));
    };

    return (
        <>
            <div className="apply-row">
                <button className="btn btn-primary apply-btn" disabled={!dirty} onClick={apply}>
                    应用
                </button>
            </div>
            <div className="settings-content-scroll">
                <div className="tab-pane has-apply">
                    {/* pomoGrid aIr3d */}
                    <div className="card card-grid">
                        <div className="card">
                            <span className="card-label">专注时长</span>
                            <NumberSuffix value={focusMin} onChange={setFocusMin} min={1} max={120} suffix="分钟" />
                        </div>
                        <div className="card card-break">
                            <span className="card-label">休息时长</span>
                            <NumberSuffix
                                value={breakMin} onChange={setBreakMin} min={0} max={60} suffix="分钟"
                                variant="warning"
                            />
                        </div>
                    </div>

                    {/* pomoFooter JpJcn */}
                    <div className="pomo-footer">
                        {/* pomoNotif aCOWE: 结束提示音 → 状态值文字（链接色） */}
                        <div className="card pomo-row">
                            <span className="pomo-row-label">结束提示音</span>
                            <span className="pomo-row-value pomo-row-value-link">柔和铃声</span>
                        </div>

                        {/* pomoEndAction I6SsL5: 计时结束提示 → Dropdown */}
                        <div className="card pomo-row">
                            <span className="pomo-row-label">计时结束提示</span>
                            <select
                                className="dropdown dropdown-fit"
                                aria-label="计时结束提示"
                                value={endActionMode}
                                onChange={(e) => setEndActionMode(e.currentTarget.value as PomodoroEndActionMode)}
                            >
                                <option value="topWindow">弹窗到顶部</option>
                                <option value="playVideo">播放视频</option>
                            </select>
                        </div>

                        {/* pomoVideoPath WSnlp: enabled:false → 设计稿收起，不渲染 */}
                        {endActionMode === 'playVideo' && (
                            <div className="card pomo-row">
                                <span className="pomo-row-label">视频选项</span>
                                <select
                                    className="dropdown dropdown-fit"
                                    aria-label="视频选项"
                                    value={selectedVideoOption}
                                    onChange={(e) => setVideoOption(e.currentTarget.value)}
                                >
                                    {BUILTIN_POMODORO_VIDEOS.map((video) => (
                                        <option key={video.id} value={video.id}>{video.name}</option>
                                    ))}
                                    <option value="custom">自定义视频</option>
                                </select>
                            </div>
                        )}

                        {/* pomoVideoCustom Jvg0I: 自定义视频文件 → 状态文字 + 文件夹图标 */}
                        <button
                            className="card pomo-row pomo-row-button"
                            type="button"
                            aria-label="选择自定义视频"
                            onClick={() => { void chooseCustomVideo(); }}
                        >
                            <span className="pomo-row-label">自定义视频文件</span>
                            <span className="pomo-row-right">
                                <span className={`pomo-row-value ${endActionVideo.customVideoPath ? 'pomo-row-value-link' : 'pomo-row-value-muted'}`}>
                                    {customVideoName}
                                </span>
                                <FolderIcon />
                            </span>
                        </button>
                    </div>
                </div>
            </div>
        </>
    );
}

function sameEndActionVideo(a: PomodoroEndActionVideo, b: PomodoroEndActionVideo): boolean {
    return (
        a.sourceKind === b.sourceKind &&
        a.builtinVideoId === b.builtinVideoId &&
        a.customVideoPath === b.customVideoPath
    );
}

function pathBasename(path: string): string {
    return path.split(/[\\/]/).pop() || path;
}

/* ============================================================
 * Online Settings (8Le5R)
 * ============================================================ */

function OnlineTab() {
    const net = useNetworkStore();
    const [name, setName] = useState(net.playerName);
    const [code, setCode] = useState(net.roomCode);

    const isJoined = net.status === 'joined';
    // reconnecting is shown inline as a banner inside the joined-room card (see onlReconnectBanner).
    // connecting is shown as a full-card overlay (3aoUs onlBusyOverlay) during the initial join.
    const reconnecting = net.status === 'reconnecting';
    const connecting = net.status === 'connecting';

    return (
        <div className="settings-content-scroll online-tab-root">
            <div className="tab-pane">
                {/* onlAutoRow FUrip */}
                <div className="card pomo-row">
                    <span className="pomo-row-label">自动联网</span>
                    <Toggle checked={net.autoConnect} onChange={net.setAutoConnect} />
                </div>

                {!isJoined && (
                    <>
                        {/* onlJoinCard ArRDI */}
                        <div className="card">
                            <span className="card-title">加入房间</span>
                            <div className="card card-row-stack" style={{ background: 'transparent', padding: 0 }}>
                                <span className="card-label">用户名</span>
                                <input
                                    className="text-input"
                                    value={name}
                                    onChange={(e) => setName(e.currentTarget.value)}
                                    onBlur={() => net.setPlayerName(name)}
                                    placeholder="我的昵称"
                                />
                            </div>
                            <div className="card card-row-stack" style={{ background: 'transparent', padding: 0 }}>
                                <span className="card-label">房间号</span>
                                <input
                                    className="text-input"
                                    value={code}
                                    onChange={(e) => setCode(e.currentTarget.value.toUpperCase())}
                                    placeholder="ROOM-001"
                                />
                            </div>
                            <div className="card-actions" style={{ width: '100%' }}>
                                <button
                                    className="btn btn-secondary btn-block"
                                    onClick={() => net.createRoom(code)}
                                >
                                    创建房间
                                </button>
                                <button
                                    className="btn btn-primary btn-block"
                                    onClick={() => net.joinRoom(code)}
                                    disabled={!code}
                                >
                                    加入房间
                                </button>
                            </div>
                            {net.lastError && <div className="error-text">{net.lastError}</div>}
                        </div>

                        {/* onlHistCard E3S4e */}
                        <div className="card">
                            <span className="card-title">历史房间</span>
                            <div className="history-list">
                                <button type="button" className="history-item" disabled>
                                    <span className="history-name">尚无历史</span>
                                    <span className="history-spacer" />
                                </button>
                            </div>
                        </div>
                    </>
                )}

                {isJoined && (
                    <div className="card card-room">
                        {reconnecting && (
                            <div className="online-reconnect">正在重新连接…</div>
                        )}
                        <div className="online-room-head">
                            <div className="online-room-info">
                                <span className="online-room-name">ROOM-{net.roomCode}</span>
                                <span className="online-room-sub">
                                    {Object.keys(net.players).length} 位成员
                                </span>
                            </div>
                            <button className="btn btn-secondary btn-fit" onClick={net.leaveRoom}>
                                退出房间
                            </button>
                        </div>
                        <div className="member-list">
                            {Object.values(net.players).map((p) => {
                                const isSelf = p.playerId === net.playerId;
                                const status = phaseToText(p.state?.pomodoro.phase, p.state?.pomodoro.isRunning ?? false);
                                return (
                                    <div key={p.playerId} className="member-item">
                                        <span className={`member-dot ${status.idle ? 'member-dot-idle' : ''}`} />
                                        <span className={`member-name ${isSelf ? 'member-name-self' : ''}`}>
                                            {p.playerName}{isSelf ? '（我）' : ''}
                                        </span>
                                        <span className={`member-status ${status.cls}`}>{status.label}</span>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}
            </div>

            {/* onlBusyOverlay 3aoUs — absolute, shown during connecting */}
            {connecting && (
                <div className="online-busy-overlay">
                    <span className="online-busy-text">正在加入房间…</span>
                </div>
            )}
        </div>
    );
}

function phaseToText(phase: number | undefined, isRunning: boolean): { label: string; cls: string; idle: boolean } {
    if (phase === undefined || !isRunning) {
        if (phase === 2) return { label: '已完成', cls: '', idle: false };
        return { label: '未开始', cls: 'member-status-idle', idle: true };
    }
    if (phase === 1) return { label: '休息中', cls: 'member-status-rest', idle: false };
    return { label: '专注中', cls: '', idle: false };
}

/* ============================================================
 * Pet Settings (v2ZgA) — 设计稿为占位，保持空容器
 * ============================================================ */

function PetTab() {
    return (
        <div className="settings-content-scroll">
            <div className="tab-pane">
                <div className="card">
                    <span className="card-label">桌宠形态</span>
                    <div className="card-empty">尚未实现 — 设计稿 v2ZgA 仅占 70px 占位。</div>
                </div>
            </div>
        </div>
    );
}

/* ============================================================
 * Global Settings (Pdj9C)
 * ============================================================ */

function GlobalTab() {
    const settings = useSettingsStore();
    const bk = useBindingKeyStore();
    const [globalEnabled, setGlobalEnabled] = useState(true);

    // Settings window doesn't run useBindingKeyListener, so we fetch
    // accessibility_status directly here and subscribe to the broadcast
    // event so the banner reflects the real permission state.
    useEffect(() => {
        let cancelled = false;
        const perm = invoke<{ granted: boolean; platform: 'macos' | 'windows' | 'other' }>('accessibility_status');
        // invoke() returns undefined in non-Tauri / jsdom test env — guard before chaining
        if (perm && typeof perm.then === 'function') {
            perm.then((s) => {
                if (cancelled) return;
                useBindingKeyStore.getState().setPermission(s.granted, s.platform);
            }).catch(() => { /* non-Tauri env (vitest jsdom) — swallow */ });
        }

        let unlisten = () => {};
        listen<{ granted: boolean; platform: 'macos' | 'windows' | 'other' }>('accessibility-permission-changed', (e) => {
            const { granted, platform } = e.payload;
            useBindingKeyStore.getState().setPermission(granted, platform);
        }).then((u) => {
            if (cancelled) u();
            else unlisten = u;
        }).catch(() => { /* swallow */ });

        return () => {
            cancelled = true;
            unlisten();
        };
    }, []);

    const scalePercent = Math.round(settings.uiScale * 100);
    const minPct = Math.round(MIN_SCALE * 100);
    const maxPct = Math.round(MAX_SCALE * 100);

    return (
        <div className="settings-content-scroll">
            <div className="tab-pane">
                {/* gspScale arfmO */}
                <div className="card">
                    <span className="card-label">界面缩放</span>
                    <div className="slider-row">
                        <Slider
                            value={scalePercent}
                            min={minPct}
                            max={maxPct}
                            onChange={(v) => settings.setUiScale(v / 100)}
                        />
                        <span className="slider-value">{(scalePercent / 100).toFixed(1)}×</span>
                    </div>
                </div>

                {/* gspBindingKey yjJtt */}
                <div className="card">
                    {!bk.permissionGranted && (
                        <div className="bk-perm-banner" role="status">
                            <span className="bk-perm-msg">需要辅助功能权限才能统计按键</span>
                            <button onClick={() => { void invoke('request_accessibility_permission'); }}>
                                申请权限
                            </button>
                            <button onClick={() => { void invoke('open_accessibility_settings'); }}>
                                打开系统设置
                            </button>
                        </div>
                    )}
                    <div className="card-row">
                        <span className="card-label">按键计数</span>
                        <Toggle checked={globalEnabled} onChange={setGlobalEnabled} />
                    </div>
                    <p className="bk-desc">
                        添加按键监听绑定；启用某一项后弹出独立的输入计数面板；最多 1 个标记为同步到远端。
                    </p>
                    {bk.entries.length > 0 && (
                        <div className="member-list" style={{ gap: 8 }}>
                            {bk.entries.map((entry) => (
                                <div key={entry.id} className="bk-row">
                                    <button
                                        className={`bk-listener ${bk.capturingId === entry.id ? 'listening' : ''}`}
                                        onClick={() => bk.beginCapture(entry.id)}
                                        title="点击重新捕获"
                                    >
                                        {bk.capturingId === entry.id ? '请按下要绑定的键…' : entry.label}
                                        {bk.capturingId !== entry.id && (
                                            <span className="bk-count">{entry.pressCount}</span>
                                        )}
                                    </button>
                                    <button
                                        className={`bk-icon-btn ${bk.syncedKeyId === entry.id ? 'active' : ''}`}
                                        onClick={() =>
                                            bk.setSynced(bk.syncedKeyId === entry.id ? null : entry.id)
                                        }
                                        title={bk.syncedKeyId === entry.id ? '取消同步' : '同步到房间'}
                                    >
                                        ⇄
                                    </button>
                                    <button
                                        className="bk-icon-btn"
                                        onClick={() => bk.removeEntry(entry.id)}
                                        title="删除"
                                    >
                                        ×
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                    <button className="bk-add" onClick={() => bk.addEntry()}>
                        <PlusIcon /> 添加按键
                    </button>
                </div>
            </div>
        </div>
    );
}

/* ============================================================
 * Form controls
 * ============================================================ */

interface NumSuffixProps {
    value: number;
    onChange: (v: number) => void;
    min: number;
    max: number;
    suffix: string;
    variant?: 'default' | 'warning';
}

function NumberSuffix({ value, onChange, min, max, suffix, variant }: NumSuffixProps) {
    return (
        <div className={`num-input ${variant === 'warning' ? 'input-suffix-warning' : ''}`}>
            <input
                type="number"
                value={value}
                min={min}
                max={max}
                onChange={(e) => onChange(Number(e.currentTarget.value))}
            />
            <span className="num-suffix">{suffix}</span>
        </div>
    );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
    return (
        <button
            type="button"
            className={`toggle ${checked ? 'on' : ''}`}
            onClick={() => onChange(!checked)}
            aria-pressed={checked}
        >
            <span className="toggle-knob" />
        </button>
    );
}

interface SliderProps {
    value: number;
    min: number;
    max: number;
    onChange: (v: number) => void;
}

function Slider({ value, min, max, onChange }: SliderProps) {
    const ratio = Math.max(0, Math.min(1, (value - min) / (max - min)));
    const onClick = (e: React.MouseEvent<HTMLDivElement>) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const r = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        onChange(Math.round(min + r * (max - min)));
    };
    return (
        <div className="slider" onClick={onClick} role="slider" aria-valuenow={value} aria-valuemin={min} aria-valuemax={max}>
            <div className="slider-fill" style={{ width: `calc((100% - 2px) * ${ratio})` }} />
            <div className="slider-thumb" style={{ left: `calc(${ratio * 100}%)` }} />
        </div>
    );
}

/* ============================================================
 * Inline icons
 * ============================================================ */

function CloseIcon() {
    return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 6 6 18M6 6l12 12" />
        </svg>
    );
}

function PlusIcon() {
    return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12h14M12 5v14" />
        </svg>
    );
}

function FolderIcon() {
    /* lucide `folder` — Pencil YQwLD: 16×16. Color comes from parent via currentColor;
     * see .pomo-row-right (color: var(--text-secondary)) */
    return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
        </svg>
    );
}
