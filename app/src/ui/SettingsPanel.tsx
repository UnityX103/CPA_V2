import { useState, useEffect, useRef, useCallback } from 'react';
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
import {
    BREAK_END_SOUNDS,
    clonePomodoroEndSounds,
    FOCUS_END_SOUNDS,
    playPomodoroSound,
    samePomodoroEndSounds,
    type PomodoroEndSounds,
    type PomodoroSoundPhase,
    type PomodoroSoundSelection,
} from '../domain/pomodoroSounds';
import { pickCustomMp3Path } from '../domain/soundFiles';
import { listAudioOutputDevices, type AudioOutputDevice } from '../domain/audioPlayback';
import { useNetworkStore } from '../domain/network';
import {
    labelForInput,
    MOUSE_BUTTON_LABELS,
    normalizeEntryInput,
    useBindingKeyStore,
    type BindingInput,
    type MouseButton,
    type KeyCounterHealth,
} from '../domain/bindingKey';
import { useAppUpdateStore, type AppUpdateStatus } from '../domain/appUpdate';
import { InputBindingBadge } from './InputBindingBadge';
import { shouldStartWindowDrag } from './windowDrag';
import {
    PRESENCE_ABSENCE_POLICIES,
    usePresenceStore,
    type PresenceAbsenceSensitivity,
    type PresenceObservation,
} from '../domain/presence';
import {
    MAX_PRESENCE_SECONDS,
    MIN_PRESENCE_SECONDS,
} from '../domain/presencePersistence';
import {
    presenceAuthorizationView,
    type PresenceAuthorizationAction,
} from './presenceAuthorization';
import './SettingsPanel.css';

const TABS: Array<{ id: SettingsTab; label: string }> = [
    { id: 'pomodoro', label: '番茄钟' },
    { id: 'online', label: '联机' },
    { id: 'global', label: '全局' },
];

interface OrdinaryApplyState {
    dirty: boolean;
    canApply: boolean;
    apply: () => void;
}

const EMPTY_APPLY_STATE: OrdinaryApplyState = {
    dirty: false,
    canApply: false,
    apply: () => {},
};

function isKeyCounterHealth(value: unknown): value is KeyCounterHealth {
    if (!value || typeof value !== 'object') return false;
    const health = value as Partial<KeyCounterHealth>;
    return typeof health.permissionGranted === 'boolean' && typeof health.listenerRunning === 'boolean';
}

function inputForPointerButton(button: number): { kind: 'mouse'; button: MouseButton } | null {
    if (button === 0) return { kind: 'mouse', button: 'left' };
    if (button === 1) return { kind: 'mouse', button: 'middle' };
    if (button === 2) return { kind: 'mouse', button: 'right' };
    return null;
}

export function SettingsPanel() {
    const activeTab = useSettingsStore((s) => s.activeTab);
    const setActiveTab = useSettingsStore((s) => s.setActiveTab);
    const dangerousChange = useSettingsStore((s) => s.dangerousChange);
    const revertDangerousChange = useSettingsStore((s) => s.revertDangerousChange);
    const [ordinaryApply, setOrdinaryApply] = useState<OrdinaryApplyState>(EMPTY_APPLY_STATE);

    useEffect(() => {
        setOrdinaryApply(EMPTY_APPLY_STATE);
    }, [activeTab]);

    const onClose = () => {
        if (dangerousChange) {
            revertDangerousChange(dangerousChange.id);
        }
        void invoke('close_settings_window');
    };

    const onPanelPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
        if (!shouldStartWindowDrag(e.button, e.target)) return;
        void getCurrentWindow().startDragging().catch(() => {
            /* drag may fail in non-Tauri/test env; swallow */
        });
    };

    return (
        <div
            className="settings-panel"
            role="dialog"
            aria-label="设置"
            onPointerDown={onPanelPointerDown}
        >
            <div className="settings-head">
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
                <div className="settings-content" data-no-window-drag>
                    {activeTab === 'pomodoro' && <PomodoroTab onApplyStateChange={setOrdinaryApply} />}
                    {activeTab === 'online' && <OnlineTab />}
                    {activeTab === 'global' && <GlobalTab />}
                    <SettingsApplyRow
                        visible={ordinaryApply.dirty}
                        enabled={ordinaryApply.canApply}
                        onApply={ordinaryApply.apply}
                    />
                </div>
            </div>
        </div>
    );
}

function SettingsApplyRow({ visible, enabled, onApply }: {
    visible: boolean;
    enabled: boolean;
    onApply: () => void;
}) {
    return (
        <div className={`apply-row ${visible ? '' : 'hidden'}`} aria-hidden={!visible}>
            {visible && (
                <button className="btn btn-primary apply-btn" disabled={!enabled} onClick={onApply}>
                    应用
                </button>
            )}
        </div>
    );
}

/* ============================================================
 * Pomodoro Settings
 * ============================================================ */

function PomodoroTab({ onApplyStateChange }: {
    onApplyStateChange: (state: OrdinaryApplyState) => void;
}) {
    const pomo = usePomodoroStore();
    const presence = usePresenceStore();
    const [focusMin, setFocusMin] = useState(Math.round(pomo.focusDurationSeconds / 60));
    const [breakMin, setBreakMin] = useState(Math.round(pomo.breakDurationSeconds / 60));
    const [autoStartBreak, setAutoStartBreak] = useState(pomo.autoStartBreak);
    const [autoPinAfterFocus, setAutoPinAfterFocus] = useState(pomo.autoPinAfterFocus);
    const [endActionMode, setEndActionMode] = useState<PomodoroEndActionMode>(pomo.endActionMode);
    const [endActionVideo, setEndActionVideo] = useState<PomodoroEndActionVideo>({ ...pomo.endActionVideo });
    const [endSounds, setEndSounds] = useState<PomodoroEndSounds>(clonePomodoroEndSounds(pomo.endSounds));
    const [presenceEnabled, setPresenceEnabled] = useState(presence.enabled);
    const [presenceIntervalSeconds, setPresenceIntervalSeconds] = useState(presence.intervalSeconds);
    const [absenceSensitivity, setAbsenceSensitivity] = useState(presence.absenceSensitivity);
    const committedRef = useRef({
        focusDurationSeconds: pomo.focusDurationSeconds,
        breakDurationSeconds: pomo.breakDurationSeconds,
        autoStartBreak: pomo.autoStartBreak,
        autoPinAfterFocus: pomo.autoPinAfterFocus,
        endActionMode: pomo.endActionMode,
        endActionVideo: { ...pomo.endActionVideo },
        endSounds: clonePomodoroEndSounds(pomo.endSounds),
        presenceEnabled: presence.enabled,
        presenceIntervalSeconds: presence.intervalSeconds,
        absenceSensitivity: presence.absenceSensitivity,
    });

    useEffect(() => {
        const previous = committedRef.current;
        const durationDraftDirty =
            focusMin * 60 !== previous.focusDurationSeconds ||
            breakMin * 60 !== previous.breakDurationSeconds ||
            autoStartBreak !== previous.autoStartBreak ||
            autoPinAfterFocus !== previous.autoPinAfterFocus;
        const endActionDraftDirty =
            endActionMode !== previous.endActionMode ||
            !sameEndActionVideo(endActionVideo, previous.endActionVideo);
        const endSoundDraftDirty = !samePomodoroEndSounds(endSounds, previous.endSounds);
        const presenceDraftDirty =
            presenceEnabled !== previous.presenceEnabled
            || presenceIntervalSeconds !== previous.presenceIntervalSeconds
            || absenceSensitivity !== previous.absenceSensitivity;
        if (!durationDraftDirty) {
            setFocusMin(Math.round(pomo.focusDurationSeconds / 60));
            setBreakMin(Math.round(pomo.breakDurationSeconds / 60));
            setAutoStartBreak(pomo.autoStartBreak);
            setAutoPinAfterFocus(pomo.autoPinAfterFocus);
        }
        if (!endActionDraftDirty) {
            setEndActionMode(pomo.endActionMode);
            setEndActionVideo((current) => (
                sameEndActionVideo(current, pomo.endActionVideo)
                    ? current
                    : { ...pomo.endActionVideo }
            ));
        }
        if (!endSoundDraftDirty) {
            setEndSounds((current) => (
                samePomodoroEndSounds(current, pomo.endSounds)
                    ? current
                    : clonePomodoroEndSounds(pomo.endSounds)
            ));
        }
        if (!presenceDraftDirty) {
            setPresenceEnabled(presence.enabled);
            setPresenceIntervalSeconds(presence.intervalSeconds);
            setAbsenceSensitivity(presence.absenceSensitivity);
        }

        committedRef.current = {
            focusDurationSeconds: pomo.focusDurationSeconds,
            breakDurationSeconds: pomo.breakDurationSeconds,
            autoStartBreak: pomo.autoStartBreak,
            autoPinAfterFocus: pomo.autoPinAfterFocus,
            endActionMode: pomo.endActionMode,
            endActionVideo: { ...pomo.endActionVideo },
            endSounds: clonePomodoroEndSounds(pomo.endSounds),
            presenceEnabled: presence.enabled,
            presenceIntervalSeconds: presence.intervalSeconds,
            absenceSensitivity: presence.absenceSensitivity,
        };
    }, [
        pomo.focusDurationSeconds,
        pomo.breakDurationSeconds,
        pomo.autoStartBreak,
        pomo.autoPinAfterFocus,
        pomo.endActionMode,
        pomo.endActionVideo.sourceKind,
        pomo.endActionVideo.builtinVideoId,
        pomo.endActionVideo.customVideoPath,
        pomo.endSounds.focus.sourceKind,
        pomo.endSounds.focus.builtinSoundId,
        pomo.endSounds.focus.customSoundPath,
        pomo.endSounds.break.sourceKind,
        pomo.endSounds.break.builtinSoundId,
        pomo.endSounds.break.customSoundPath,
        presence.enabled,
        presence.intervalSeconds,
        presence.absenceSensitivity,
        focusMin,
        breakMin,
        autoStartBreak,
        autoPinAfterFocus,
        endActionMode,
        endActionVideo,
        endSounds,
        presenceEnabled,
        presenceIntervalSeconds,
        absenceSensitivity,
    ]);

    const dirty =
        focusMin * 60 !== pomo.focusDurationSeconds ||
        breakMin * 60 !== pomo.breakDurationSeconds ||
        autoStartBreak !== pomo.autoStartBreak ||
        autoPinAfterFocus !== pomo.autoPinAfterFocus ||
        endActionMode !== pomo.endActionMode ||
        !sameEndActionVideo(endActionVideo, pomo.endActionVideo) ||
        !samePomodoroEndSounds(endSounds, pomo.endSounds) ||
        presenceEnabled !== presence.enabled ||
        presenceIntervalSeconds !== presence.intervalSeconds ||
        absenceSensitivity !== presence.absenceSensitivity;
    const hasMissingCustomVideo =
        endActionMode === 'playVideo' &&
        endActionVideo.sourceKind === 'custom' &&
        !endActionVideo.customVideoPath;
    const hasMissingCustomSound =
        (endSounds.focus.sourceKind === 'custom' && !endSounds.focus.customSoundPath)
        || (endSounds.break.sourceKind === 'custom' && !endSounds.break.customSoundPath);
    const canApply = dirty && !hasMissingCustomVideo && !hasMissingCustomSound;

    const apply = useCallback(() => {
        if (!canApply) return;
        const focusSeconds = focusMin * 60;
        const breakSeconds = breakMin * 60;
        const durationChanged =
            focusSeconds !== pomo.focusDurationSeconds ||
            breakSeconds !== pomo.breakDurationSeconds ||
            autoStartBreak !== pomo.autoStartBreak;
        const autoPinAfterFocusChanged = autoPinAfterFocus !== pomo.autoPinAfterFocus;
        const endActionChanged =
            endActionMode !== pomo.endActionMode ||
            !sameEndActionVideo(endActionVideo, pomo.endActionVideo);
        const endSoundsChanged = !samePomodoroEndSounds(endSounds, pomo.endSounds);
        const presenceChanged =
            presenceEnabled !== presence.enabled
            || presenceIntervalSeconds !== presence.intervalSeconds
            || absenceSensitivity !== presence.absenceSensitivity;

        if (durationChanged) {
            pomo.applySettings(focusSeconds, breakSeconds, pomo.totalRounds, true, autoStartBreak);
        }
        if (autoPinAfterFocusChanged) {
            pomo.setAutoPinAfterFocus(autoPinAfterFocus);
        }
        if (endActionChanged) {
            void Promise.resolve(pomo.applyEndActionSettings(endActionMode, endActionVideo))
                .catch((error) => {
                    console.warn('[settings] failed to apply Pomodoro end action', error);
                });
        }
        if (endSoundsChanged) {
            void Promise.resolve(pomo.applyEndSoundSettings(endSounds))
                .catch((error) => {
                    console.warn('[settings] failed to apply Pomodoro end sounds', error);
                });
        }
        if (presenceChanged) {
            void Promise.resolve(presence.applySettings({
                enabled: presenceEnabled,
                intervalSeconds: presenceIntervalSeconds,
                absenceSensitivity,
            })).catch((error) => {
                console.warn('[settings] failed to apply presence settings', error);
            });
        }
    }, [
        canApply,
        focusMin,
        breakMin,
        autoStartBreak,
        autoPinAfterFocus,
        endActionMode,
        endActionVideo,
        endSounds,
        pomo,
        presence,
        presenceEnabled,
        presenceIntervalSeconds,
        absenceSensitivity,
    ]);

    useEffect(() => {
        onApplyStateChange({
            dirty,
            canApply,
            apply,
        });
    }, [onApplyStateChange, dirty, canApply, apply]);

    const selectedVideoOption = endActionVideo.sourceKind === 'custom'
        ? 'custom'
        : endActionVideo.builtinVideoId;
    const showVideoOptions = endActionMode === 'playVideo';
    const showCustomVideoRow = showVideoOptions && endActionVideo.sourceKind === 'custom';
    const customVideoName = endActionVideo.customVideoPath
        ? fileNameFromPath(endActionVideo.customVideoPath)
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
        try {
            const path = await pickCustomWebmPath();
            if (!path) return;
            setEndActionMode('playVideo');
            setEndActionVideo((current) => ({
                sourceKind: 'custom',
                builtinVideoId: current.builtinVideoId || DEFAULT_BUILTIN_POMODORO_VIDEO_ID,
                customVideoPath: path,
            }));
        } catch (error) {
            console.warn('[settings] failed to select custom Pomodoro video', error);
        }
    };

    const updateEndSound = (
        phase: PomodoroSoundPhase,
        update: (current: PomodoroSoundSelection) => PomodoroSoundSelection,
    ) => {
        setEndSounds((current) => ({
            ...current,
            [phase]: update(current[phase]),
        }));
    };

    const chooseCustomSound = async (phase: PomodoroSoundPhase) => {
        try {
            const path = await pickCustomMp3Path();
            if (!path) return;
            updateEndSound(phase, (current) => ({
                ...current,
                sourceKind: 'custom',
                customSoundPath: path,
            }));
        } catch (error) {
            console.warn(`[settings] failed to select ${phase} end sound`, error);
        }
    };

    return (
        <>
            <div className="settings-content-scroll">
                <div className="tab-pane">
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

                        <div className="card pomo-row">
                            <span className="pomo-row-label">摄像头自动控制</span>
                            <Toggle
                                checked={presenceEnabled}
                                onChange={setPresenceEnabled}
                                ariaLabel="摄像头自动控制"
                            />
                        </div>

                        <PresenceAuthorizationControl
                            enabled={presence.enabled}
                            availability={presence.availability}
                            onRequestAccess={() => { void presence.requestAccess(); }}
                            onRetry={() => { void presence.retry(); }}
                            onOpenPrivacySettings={() => { void presence.openPrivacySettings(); }}
                        />

                        <div className="card card-grid">
                            <div className="card">
                                <span className="card-label">检测间隔</span>
                                <NumberSuffix
                                    value={presenceIntervalSeconds}
                                    onChange={setPresenceIntervalSeconds}
                                    min={MIN_PRESENCE_SECONDS}
                                    max={MAX_PRESENCE_SECONDS}
                                    suffix="秒"
                                />
                            </div>
                            <div className="card">
                                <span className="card-label">离席判定阈值</span>
                                <select
                                    className="dropdown"
                                    aria-label="离席判定阈值"
                                    value={absenceSensitivity}
                                    onChange={(event) => setAbsenceSensitivity(
                                        event.currentTarget.value as PresenceAbsenceSensitivity,
                                    )}
                                >
                                    {PRESENCE_ABSENCE_POLICIES.map((policy) => (
                                        <option key={policy.value} value={policy.value}>
                                            {policy.label}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        </div>

                        <div className="card pomo-row">
                            <span className="pomo-row-label">工位状态</span>
                            <span className="pomo-row-value">{presenceObservationText(presence.confirmedPresence)}</span>
                        </div>

                        {/* pomoAutoStartBreak fnZ59: 结束提示音下方 → Toggle */}
                        <div className="card pomo-row">
                            <span className="pomo-row-label">自动开始休息</span>
                            <Toggle checked={autoStartBreak} onChange={setAutoStartBreak} ariaLabel="自动开始休息" />
                        </div>

                        <div className="card pomo-row">
                            <span className="pomo-row-label">专注结束后自动置顶</span>
                            <Toggle
                                checked={autoPinAfterFocus}
                                onChange={setAutoPinAfterFocus}
                                ariaLabel="专注结束后自动置顶"
                            />
                        </div>

                        <div className="pomodoro-sound-grid">
                            <SoundSettingsCard
                                phase="focus"
                                label="专注结束声音"
                                selection={endSounds.focus}
                                sounds={FOCUS_END_SOUNDS}
                                onChange={(selection) => updateEndSound('focus', () => selection)}
                                onChooseCustom={() => { void chooseCustomSound('focus'); }}
                            />
                            <SoundSettingsCard
                                phase="break"
                                label="休息结束声音"
                                selection={endSounds.break}
                                sounds={BREAK_END_SOUNDS}
                                onChange={(selection) => updateEndSound('break', () => selection)}
                                onChooseCustom={() => { void chooseCustomSound('break'); }}
                            />
                        </div>

                        <div className="card pomo-row">
                            <span className="pomo-row-label">计时结束提示</span>
                            <select
                                className="dropdown dropdown-fit"
                                aria-label="计时结束提示"
                                value={endActionMode}
                                onChange={(event) => setEndActionMode(event.currentTarget.value as PomodoroEndActionMode)}
                            >
                                <option value="topWindow">弹窗到顶部</option>
                                <option value="playVideo">播放视频</option>
                            </select>
                        </div>

                        {showVideoOptions && (
                            <div className="card pomo-row">
                                <span className="pomo-row-label">视频选项</span>
                                <select
                                    className="dropdown dropdown-fit"
                                    aria-label="视频选项"
                                    value={selectedVideoOption}
                                    onChange={(event) => setVideoOption(event.currentTarget.value)}
                                >
                                    {BUILTIN_POMODORO_VIDEOS.map((video) => (
                                        <option key={video.id} value={video.id}>{video.name}</option>
                                    ))}
                                    <option value="custom">自定义视频</option>
                                </select>
                            </div>
                        )}

                        {showCustomVideoRow && (
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
                        )}

                    </div>
                </div>
            </div>
        </>
    );
}

function SoundSettingsCard({
    phase,
    label,
    selection,
    sounds,
    onChange,
    onChooseCustom,
}: {
    phase: PomodoroSoundPhase;
    label: string;
    selection: PomodoroSoundSelection;
    sounds: typeof FOCUS_END_SOUNDS | typeof BREAK_END_SOUNDS;
    onChange: (selection: PomodoroSoundSelection) => void;
    onChooseCustom: () => void;
}) {
    const selectedOption = selection.sourceKind === 'builtin'
        ? selection.builtinSoundId
        : selection.sourceKind;
    const canPreview = selection.sourceKind !== 'off'
        && (selection.sourceKind !== 'custom' || Boolean(selection.customSoundPath));
    const customFileName = selection.customSoundPath
        ? fileNameFromPath(selection.customSoundPath)
        : '未选择';

    const selectSound = (value: string) => {
        if (value === 'off' || value === 'custom') {
            onChange({ ...selection, sourceKind: value });
            return;
        }
        onChange({
            ...selection,
            sourceKind: 'builtin',
            builtinSoundId: value,
        });
    };

    const preview = async () => {
        try {
            await playPomodoroSound(selection, phase);
        } catch (error) {
            console.warn(`[settings] failed to preview ${phase} end sound`, error);
        }
    };

    return (
        <div className={`card pomodoro-sound-card ${phase === 'break' ? 'pomodoro-sound-card-break' : ''}`}>
            <span className="card-label">{label}</span>
            <div className="pomodoro-sound-select-row">
                <select
                    className="dropdown pomodoro-sound-select"
                    aria-label={label}
                    value={selectedOption}
                    onChange={(event) => selectSound(event.currentTarget.value)}
                >
                    <option value="off">关闭</option>
                    {sounds.map((sound) => (
                        <option key={sound.id} value={sound.id}>{sound.name}</option>
                    ))}
                    <option value="custom">自定义 MP3</option>
                </select>
                <button
                    className="pomodoro-sound-preview"
                    type="button"
                    aria-label={`试听${label}`}
                    title={`试听${label}`}
                    disabled={!canPreview}
                    onClick={() => { void preview(); }}
                >
                    <PlayIcon />
                </button>
            </div>
            <button
                className="pomodoro-sound-file"
                type="button"
                aria-label={`选择${label}本机 MP3`}
                title={`选择${label}本机 MP3`}
                onClick={onChooseCustom}
            >
                <span className={selection.customSoundPath ? 'pomo-row-value-link' : 'pomo-row-value-muted'}>
                    本机 MP3 · {customFileName}
                </span>
                <FolderIcon />
            </button>
        </div>
    );
}

function sameEndActionVideo(a: PomodoroEndActionVideo, b: PomodoroEndActionVideo): boolean {
    return (
        a.sourceKind === b.sourceKind &&
        a.builtinVideoId === b.builtinVideoId &&
        a.customVideoPath === b.customVideoPath
    );
}

function fileNameFromPath(path: string): string {
    return path.split(/[\\/]/).pop() || path;
}

function presenceObservationText(observation: PresenceObservation): string {
    if (observation === 'present') return '在场';
    if (observation === 'absent') return '离场';
    return '未知';
}

function PresenceAuthorizationControl({
    enabled,
    availability,
    onRequestAccess,
    onRetry,
    onOpenPrivacySettings,
}: {
    enabled: boolean;
    availability: ReturnType<typeof usePresenceStore.getState>['availability'];
    onRequestAccess: () => void;
    onRetry: () => void;
    onOpenPrivacySettings: () => void;
}) {
    const view = presenceAuthorizationView(enabled, availability);
    const actionHandlers: Record<PresenceAuthorizationAction, () => void> = {
        requestAccess: onRequestAccess,
        retry: onRetry,
        openSettings: onOpenPrivacySettings,
    };
    const actionLabels: Record<PresenceAuthorizationAction, string> = {
        requestAccess: '申请权限',
        retry: '重试',
        openSettings: '打开系统设置',
    };

    return (
        <div
            className={`presence-auth-control presence-auth-${view.tone}`}
            role="group"
            aria-label="摄像头授权状态"
        >
            <div className="presence-auth-copy" role="status" aria-live="polite">
                <span className="presence-auth-label">摄像头授权</span>
                <span className="presence-auth-status">{view.status}</span>
            </div>
            <div className="presence-auth-actions" aria-label="摄像头授权操作">
                {view.actions.map((action) => (
                    <button
                        key={action}
                        type="button"
                        onClick={actionHandlers[action]}
                    >
                        {actionLabels[action]}
                    </button>
                ))}
            </div>
            <span className="presence-auth-detail">{view.detail}</span>
        </div>
    );
}

/* ============================================================
 * Online Settings (8Le5R)
 * ============================================================ */

function accountErrorText(error: string): string {
    switch (error) {
        case 'USERNAME_TAKEN':
            return '用户名已存在';
        case 'INVALID_CREDENTIALS':
            return '用户名或密码错误';
        case 'INVALID_ACCOUNT_INPUT':
            return '账号或密码格式不正确';
        case 'INVALID_SESSION':
            return '登录已失效，请重新登录';
        case 'AUTH_REQUIRED':
            return '请先登录账号';
        case 'CONNECTION_ERROR':
            return '无法连接服务器';
        default:
            return '操作失败，请稍后重试';
    }
}

function cloudSyncStatusText(status: ReturnType<typeof useNetworkStore.getState>['cloudSyncStatus']): string {
    switch (status) {
        case 'pulling':
        case 'saving':
            return '云同步中';
        case 'synced':
            return '已同步';
        case 'offline':
            return '离线保存中';
        case 'conflict':
            return '数据冲突已合并';
        case 'error':
            return '同步失败';
        default:
            return '本地保存';
    }
}

function OnlineTab() {
    const net = useNetworkStore();
    const [name, setName] = useState(net.playerName);
    const [code, setCode] = useState(net.roomCode);
    const [accountName, setAccountName] = useState(net.accountUser?.username ?? '');
    const [accountPassword, setAccountPassword] = useState('');

    const isJoined = net.status === 'joined';
    const isLoggedIn = net.accountStatus === 'loggedIn' && net.accountUser != null;
    const accountBusy =
        net.accountStatus === 'checking' ||
        net.accountStatus === 'creating' ||
        net.accountStatus === 'loggingIn';
    const accountError = net.accountError ? accountErrorText(net.accountError) : null;
    // reconnecting is shown inline as a banner inside the joined-room card (see onlReconnectBanner).
    // connecting is shown as a full-card overlay (3aoUs onlBusyOverlay) during the initial room join.
    const reconnecting = net.status === 'reconnecting';
    const connecting = net.status === 'connecting' && isLoggedIn && !accountBusy;

    return (
        <div className="settings-content-scroll online-tab-root">
            <div className="tab-pane">
                <div className="card account-card">
                    <span className="card-title">账号</span>
                    {!isLoggedIn ? (
                        <>
                            <label className="card card-row-stack account-field">
                                <span className="card-label">账号</span>
                                <input
                                    aria-label="账号"
                                    className="text-input"
                                    value={accountName}
                                    onChange={(e) => setAccountName(e.currentTarget.value)}
                                    placeholder="用户名"
                                    disabled={accountBusy}
                                />
                            </label>
                            <label className="card card-row-stack account-field">
                                <span className="card-label">密码</span>
                                <input
                                    aria-label="密码"
                                    className="text-input"
                                    type="password"
                                    value={accountPassword}
                                    onChange={(e) => setAccountPassword(e.currentTarget.value)}
                                    placeholder="密码"
                                    disabled={accountBusy}
                                />
                            </label>
                            <div className="card-actions" style={{ width: '100%' }}>
                                <button
                                    className="btn btn-secondary btn-block"
                                    disabled={accountBusy || !accountName || !accountPassword}
                                    onClick={() => net.createAccount(accountName, accountPassword)}
                                >
                                    创建账号
                                </button>
                                <button
                                    className="btn btn-primary btn-block"
                                    disabled={accountBusy || !accountName || !accountPassword}
                                    onClick={() => net.login(accountName, accountPassword)}
                                >
                                    登录
                                </button>
                            </div>
                            {accountError && <div className="error-text">{accountError}</div>}
                        </>
                    ) : (
                        <div className="account-summary">
                            <span className="account-identity">
                                <span className="account-name">{net.accountUser!.username}</span>
                                <span className="cloud-sync-status">
                                    {cloudSyncStatusText(net.cloudSyncStatus)}
                                </span>
                            </span>
                            <button className="btn btn-secondary btn-fit" onClick={net.logout}>
                                退出登录
                            </button>
                        </div>
                    )}
                </div>

                {/* onlAutoRow FUrip */}
                <div className="card pomo-row">
                    <span className="pomo-row-label">自动联网</span>
                    <Toggle checked={net.autoConnect} onChange={net.setAutoConnect} />
                </div>

                {isLoggedIn && !isJoined && (
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
                                    disabled={!isLoggedIn}
                                >
                                    创建房间
                                </button>
                                <button
                                    className="btn btn-primary btn-block"
                                    onClick={() => net.joinRoom(code)}
                                    disabled={!isLoggedIn || !code}
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
 * Global Settings (Pdj9C)
 * ============================================================ */

function GlobalTab() {
    const settings = useSettingsStore();
    const bk = useBindingKeyStore();
    const [scaleDragPercent, setScaleDragPercent] = useState<number | null>(null);

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

        const health = invoke<KeyCounterHealth>('key_counter_health');
        if (health && typeof health.then === 'function') {
            health.then((h) => {
                if (cancelled || !isKeyCounterHealth(h)) return;
                useBindingKeyStore.getState().setListenerHealth(h);
            }).catch(() => { /* non-Tauri env (vitest jsdom) — swallow */ });
        }

        let unlisten = () => {};
        let unlistenHealth = () => {};
        listen<{ granted: boolean; platform: 'macos' | 'windows' | 'other' }>('accessibility-permission-changed', (e) => {
            if (cancelled) return;
            const { granted, platform } = e.payload;
            useBindingKeyStore.getState().setPermission(granted, platform);
        }).then((u) => {
            if (cancelled) u();
            else unlisten = u;
        }).catch(() => { /* swallow */ });

        listen<KeyCounterHealth>('key-counter-health-changed', (e) => {
            if (cancelled || !isKeyCounterHealth(e.payload)) return;
            useBindingKeyStore.getState().setListenerHealth(e.payload);
        }).then((u) => {
            if (cancelled) u();
            else unlistenHealth = u;
        }).catch(() => { /* swallow */ });

        return () => {
            cancelled = true;
            unlisten();
            unlistenHealth();
        };
    }, []);

    useEffect(() => {
        if (bk.platform !== 'windows' || !bk.capturingId) return;

        const completeWindowsCapture = (event: KeyboardEvent) => {
            const keyCode = event.keyCode || event.which;
            if (!keyCode) return;
            event.preventDefault();
            event.stopPropagation();
            const input: BindingInput = { kind: 'keyboard', code: keyCode };
            useBindingKeyStore.getState().completeCapture(input, labelForInput(input, 'windows'));
        };

        const completeWindowsPointerCapture = (event: PointerEvent) => {
            const input = inputForPointerButton(event.button);
            if (!input) return;
            event.preventDefault();
            event.stopPropagation();
            useBindingKeyStore.getState().completeCapture(input, MOUSE_BUTTON_LABELS[input.button]);
        };

        window.addEventListener('keydown', completeWindowsCapture, true);
        window.addEventListener('pointerdown', completeWindowsPointerCapture, true);
        return () => {
            window.removeEventListener('keydown', completeWindowsCapture, true);
            window.removeEventListener('pointerdown', completeWindowsPointerCapture, true);
        };
    }, [bk.platform, bk.capturingId]);

    const scalePercent = Math.round(settings.uiScale * 100);
    const displayScalePercent = scaleDragPercent ?? scalePercent;
    const minPct = Math.round(MIN_SCALE * 100);
    const maxPct = Math.round(MAX_SCALE * 100);
    const showListenerBanner = bk.permissionGranted && bk.listenerRunning === false;
    const retryListener = () => {
        void invoke<KeyCounterHealth>('restart_key_counter_listener')
            .then((health) => {
                useBindingKeyStore.getState().setListenerHealth(health);
            })
            .catch(() => {});
    };

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
                            onPreviewChange={setScaleDragPercent}
                            onChange={(v) => {
                                setScaleDragPercent(null);
                                settings.previewDangerousUiScale(v / 100);
                            }}
                        />
                        <span className="slider-value">{(displayScalePercent / 100).toFixed(1)}×</span>
                    </div>
                </div>

                <AudioSettingsCard />

                <div className="card">
                    <div className="card-row">
                        <span className="card-label">开机自启动</span>
                        <Toggle
                            checked={settings.autostartEnabled}
                            onChange={(enabled) => { void settings.setAutostartEnabled(enabled); }}
                            ariaLabel="开机自启动"
                        />
                    </div>
                </div>

                <AppUpdateSettingsRow />

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
                    {showListenerBanner && (
                        <div className="bk-perm-banner bk-health-banner" role="status">
                            <span className="bk-perm-msg">已授予权限，但监听器未启动</span>
                            <button onClick={retryListener}>重试监听</button>
                            <button onClick={() => { void invoke('open_accessibility_settings'); }}>
                                打开系统设置
                            </button>
                            {bk.listenerError && (
                                <span className="bk-health-detail">{bk.listenerError}</span>
                            )}
                            {bk.listenerDiagnostic?.codeSignIdentifier && (
                                <span className="bk-health-detail">
                                    签名：{bk.listenerDiagnostic.codeSignIdentifier}
                                </span>
                            )}
                        </div>
                    )}
                    <div className="card-row">
                        <span className="card-label">按键计数</span>
                        <Toggle checked={bk.panelEnabled} onChange={bk.setPanelEnabled} ariaLabel="按键计数" />
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
                                        {bk.capturingId === entry.id ? (
                                            '请按下要绑定的键或鼠标按钮…'
                                        ) : (
                                            <>
                                                <InputBindingBadge input={normalizeEntryInput(entry)} label={entry.label} />
                                                <span className="bk-listener-label">{entry.label}</span>
                                            </>
                                        )}
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
                        <PlusIcon /> 添加输入
                    </button>
                </div>
            </div>
        </div>
    );
}

function AudioSettingsCard() {
    const audioOutputDeviceId = useSettingsStore((s) => s.audioOutputDeviceId);
    const soundVolume = useSettingsStore((s) => s.soundVolume);
    const setAudioOutputDeviceId = useSettingsStore((s) => s.setAudioOutputDeviceId);
    const setSoundVolume = useSettingsStore((s) => s.setSoundVolume);
    const [devices, setDevices] = useState<AudioOutputDevice[]>([]);
    const [loadError, setLoadError] = useState(false);
    const [volumePreview, setVolumePreview] = useState<number | null>(null);

    useEffect(() => {
        let cancelled = false;
        void listAudioOutputDevices()
            .then((nextDevices) => {
                if (cancelled) return;
                setDevices(nextDevices);
                setLoadError(false);
            })
            .catch((error) => {
                if (cancelled) return;
                console.warn('[settings] failed to list audio output devices', error);
                setLoadError(true);
            });
        return () => { cancelled = true; };
    }, []);

    const selectedDeviceIsMissing = audioOutputDeviceId !== null
        && !devices.some((device) => device.id === audioOutputDeviceId);
    const volumePercent = Math.round(soundVolume * 100);
    const displayVolumePercent = volumePreview ?? volumePercent;

    return (
        <div className="card audio-settings-card">
            <span className="card-title">声音</span>
            <label className="audio-setting-field">
                <span className="card-label">播放设备</span>
                <select
                    className="dropdown audio-device-select"
                    aria-label="播放声音的设备"
                    value={audioOutputDeviceId ?? ''}
                    onChange={(event) => setAudioOutputDeviceId(event.currentTarget.value || null)}
                >
                    <option value="">跟随系统默认设备</option>
                    {selectedDeviceIsMissing && (
                        <option value={audioOutputDeviceId!}>当前选择的设备不可用</option>
                    )}
                    {devices.map((device) => (
                        <option key={device.id} value={device.id}>
                            {device.name}{device.isDefault ? '（系统默认）' : ''}
                        </option>
                    ))}
                </select>
            </label>
            <div className="audio-setting-field">
                <span className="card-label">声音音量</span>
                <div className="slider-row">
                    <Slider
                        value={volumePercent}
                        min={0}
                        max={100}
                        ariaLabel="声音音量"
                        onPreviewChange={setVolumePreview}
                        onChange={(value) => {
                            setVolumePreview(null);
                            setSoundVolume(value / 100);
                        }}
                    />
                    <span className="slider-value">{displayVolumePercent}%</span>
                </div>
            </div>
            {loadError && <span className="status-text">无法读取设备列表，将跟随系统默认设备</span>}
        </div>
    );
}

function AppUpdateSettingsRow() {
    const autoUpdateEnabled = useAppUpdateStore((s) => s.autoUpdateEnabled);
    const status = useAppUpdateStore((s) => s.status);
    const currentVersion = useAppUpdateStore((s) => s.currentVersion);
    const availableVersion = useAppUpdateStore((s) => s.availableVersion);
    const errorMessage = useAppUpdateStore((s) => s.errorMessage);
    const downloadedBytes = useAppUpdateStore((s) => s.downloadedBytes);
    const downloadTotalBytes = useAppUpdateStore((s) => s.downloadTotalBytes);
    const setAutoUpdateEnabled = useAppUpdateStore((s) => s.setAutoUpdateEnabled);
    const checkNow = useAppUpdateStore((s) => s.checkNow);
    const restartForUpdate = useAppUpdateStore((s) => s.restartForUpdate);
    const busy = status === 'checking' || status === 'downloading' || status === 'installing';

    return (
        <div className="card app-update-card">
            <div className="card-row">
                <span className="card-label">自动下载并安装更新</span>
                <Toggle
                    checked={autoUpdateEnabled}
                    onChange={(enabled) => { void setAutoUpdateEnabled(enabled); }}
                    ariaLabel="自动下载并安装更新"
                />
            </div>
            <div className="app-update-footer">
                <span className="status-text app-update-status">
                    {appUpdateStatusText(
                        status,
                        currentVersion,
                        availableVersion,
                        errorMessage,
                        downloadedBytes,
                        downloadTotalBytes,
                    )}
                </span>
                {status === 'readyToRestart' ? (
                    <button
                        className="btn btn-primary btn-fit app-update-action"
                        type="button"
                        onClick={() => { void restartForUpdate(); }}
                    >
                        重启更新
                    </button>
                ) : (
                    <button
                        className="btn btn-secondary btn-fit app-update-action"
                        type="button"
                        disabled={!autoUpdateEnabled || busy}
                        onClick={() => { void checkNow(); }}
                    >
                        立即检查
                    </button>
                )}
            </div>
        </div>
    );
}

function appUpdateStatusText(
    status: AppUpdateStatus,
    currentVersion: string | null,
    availableVersion: string | null,
    errorMessage: string | null,
    downloadedBytes: number,
    downloadTotalBytes: number | null,
): string {
    const current = currentVersion ?? '未知版本';
    const available = availableVersion ?? '新版本';
    if (status === 'disabled') return '自动更新已关闭';
    if (status === 'checking') return `当前版本 ${current} · 正在检查`;
    if (status === 'upToDate') return `当前版本 ${current} · 已是最新`;
    if (status === 'downloading') {
        if (downloadTotalBytes && downloadTotalBytes > 0) {
            const percent = Math.min(100, Math.floor((downloadedBytes / downloadTotalBytes) * 100));
            return `发现版本 ${available} · 正在下载 ${percent}%`;
        }
        if (downloadedBytes > 0) {
            return `发现版本 ${available} · 已下载 ${(downloadedBytes / 1024 / 1024).toFixed(1)} MB`;
        }
        return `发现版本 ${available} · 正在下载`;
    }
    if (status === 'installing') return `发现版本 ${available} · 正在安装`;
    if (status === 'readyToRestart') return `新版本 ${available} 已安装 · 重启后生效`;
    if (status === 'error') return `更新失败：${errorMessage ?? '请稍后再试'}`;
    return `当前版本 ${current} · 等待检查`;
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

interface ToggleProps {
    checked: boolean;
    onChange: (v: boolean) => void;
    ariaLabel?: string;
}

function Toggle({ checked, onChange, ariaLabel }: ToggleProps) {
    return (
        <button
            type="button"
            className={`toggle ${checked ? 'on' : ''}`}
            onClick={() => onChange(!checked)}
            aria-pressed={checked}
            aria-label={ariaLabel}
        >
            <span className="toggle-knob" />
        </button>
    );
}

interface SliderProps {
    value: number;
    min: number;
    max: number;
    onPreviewChange?: (v: number | null) => void;
    onChange: (v: number) => void;
    ariaLabel?: string;
}

function Slider({ value, min, max, onPreviewChange, onChange, ariaLabel }: SliderProps) {
    const draggingPointerIdRef = useRef<number | null>(null);
    const [isDragging, setIsDragging] = useState(false);
    const [dragValue, setDragValue] = useState(value);
    const displayValue = isDragging ? dragValue : value;
    const ratio = Math.max(0, Math.min(1, (displayValue - min) / (max - min)));

    useEffect(() => {
        if (!isDragging) setDragValue(value);
    }, [isDragging, value]);

    const valueFromClientX = (element: HTMLDivElement, clientX: number, fallbackValue: number): number => {
        const rect = element.getBoundingClientRect();
        if (rect.width <= 0 || !Number.isFinite(clientX)) return fallbackValue;
        const r = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
        return Math.round(min + r * (max - min));
    };

    const updateDragFromPointer = (e: React.PointerEvent<HTMLDivElement>): number => {
        const nextValue = valueFromClientX(e.currentTarget, e.clientX, displayValue);
        setDragValue(nextValue);
        onPreviewChange?.(nextValue);
        return nextValue;
    };

    const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
        if (e.button !== 0) return;
        e.currentTarget.setPointerCapture?.(e.pointerId);
        draggingPointerIdRef.current = e.pointerId;
        setIsDragging(true);
        updateDragFromPointer(e);
    };

    const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
        if (draggingPointerIdRef.current !== e.pointerId) return;
        updateDragFromPointer(e);
    };

    const stopDragging = (e: React.PointerEvent<HTMLDivElement>) => {
        if (draggingPointerIdRef.current !== e.pointerId) return;
        const shouldApply = e.type === 'pointerup';
        const finalValue = shouldApply ? updateDragFromPointer(e) : dragValue;
        e.currentTarget.releasePointerCapture?.(e.pointerId);
        draggingPointerIdRef.current = null;
        setIsDragging(false);
        if (shouldApply) onChange(finalValue);
        else onPreviewChange?.(null);
    };

    return (
        <div
            className={`slider ${isDragging ? 'dragging' : ''}`}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={stopDragging}
            onPointerCancel={stopDragging}
            role="slider"
            aria-label={ariaLabel}
            aria-valuenow={displayValue}
            aria-valuemin={min}
            aria-valuemax={max}
        >
            <div className="slider-fill" style={{ width: `${ratio * 100}%` }} />
            <div className="slider-thumb" style={{ left: `${ratio * 100}%` }} />
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

function FolderIcon() {
    return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
        </svg>
    );
}

function PlayIcon() {
    return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m7 4 13 8-13 8Z" />
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
