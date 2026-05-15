import { useState, useEffect } from 'react';
import { useSettingsStore, type SettingsTab, MIN_SCALE, MAX_SCALE } from '../domain/settings';
import { usePomodoroStore } from '../domain/pomodoro';
import { useNetworkStore } from '../domain/network';
import './SettingsPanel.css';

const TABS: Array<{ id: SettingsTab; label: string }> = [
    { id: 'pomodoro', label: '番茄钟' },
    { id: 'online', label: '联机' },
    { id: 'pet', label: '宠物' },
    { id: 'global', label: '全局' },
];

export function SettingsPanel() {
    const { isOpen, activeTab, close, setActiveTab } = useSettingsStore();
    if (!isOpen) return null;

    return (
        <div className="settings-overlay" onClick={close}>
            <div className="settings-panel" onClick={(e) => e.stopPropagation()}>
                <div className="settings-head">
                    <h2 className="settings-title">设置</h2>
                    <button className="settings-close" onClick={close} aria-label="关闭">×</button>
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
        </div>
    );
}

function PomodoroTab() {
    const pomo = usePomodoroStore();
    const [focusMin, setFocusMin] = useState(Math.round(pomo.focusDurationSeconds / 60));
    const [breakMin, setBreakMin] = useState(Math.round(pomo.breakDurationSeconds / 60));
    const [rounds, setRounds] = useState(pomo.totalRounds);
    const [autoStart, setAutoStart] = useState(pomo.autoStartBreak);

    useEffect(() => {
        setFocusMin(Math.round(pomo.focusDurationSeconds / 60));
        setBreakMin(Math.round(pomo.breakDurationSeconds / 60));
        setRounds(pomo.totalRounds);
    }, [pomo.focusDurationSeconds, pomo.breakDurationSeconds, pomo.totalRounds]);

    const dirty =
        focusMin * 60 !== pomo.focusDurationSeconds ||
        breakMin * 60 !== pomo.breakDurationSeconds ||
        rounds !== pomo.totalRounds ||
        autoStart !== pomo.autoStartBreak;

    const apply = () => {
        pomo.applySettings(focusMin * 60, breakMin * 60, rounds, true);
        usePomodoroStore.setState({ autoStartBreak: autoStart });
    };

    return (
        <div className="tab-pane">
            <div className="apply-row">
                <button className="btn btn-primary apply-btn" disabled={!dirty} onClick={apply}>应用</button>
            </div>
            <div className="card">
                <div className="card-row">
                    <label>专注时长</label>
                    <NumberInput value={focusMin} onChange={setFocusMin} min={1} max={120} suffix="分钟" />
                </div>
                <div className="card-row">
                    <label>休息时长</label>
                    <NumberInput value={breakMin} onChange={setBreakMin} min={0} max={60} suffix="分钟" />
                </div>
                <div className="card-row">
                    <label>总轮次</label>
                    <NumberInput value={rounds} onChange={setRounds} min={1} max={12} />
                </div>
                <div className="card-row">
                    <label>休息自动开始</label>
                    <Toggle checked={autoStart} onChange={setAutoStart} />
                </div>
            </div>
        </div>
    );
}

function OnlineTab() {
    const net = useNetworkStore();
    const [name, setName] = useState(net.playerName);
    const [code, setCode] = useState(net.roomCode);

    const isJoined = net.status === 'joined';

    return (
        <div className="tab-pane">
            <div className="card">
                <div className="card-row">
                    <label>自动联网</label>
                    <Toggle checked={net.autoConnect} onChange={net.setAutoConnect} />
                </div>
            </div>
            <div className="card">
                <div className="card-row">
                    <label>玩家名称</label>
                    <input
                        className="text-input"
                        value={name}
                        onChange={(e) => setName(e.currentTarget.value)}
                        onBlur={() => net.setPlayerName(name)}
                    />
                </div>
                <div className="card-row">
                    <label>房间号</label>
                    <input
                        className="text-input"
                        value={code}
                        onChange={(e) => setCode(e.currentTarget.value.toUpperCase())}
                        placeholder="留空则自动生成"
                        disabled={isJoined}
                    />
                </div>
                <div className="card-actions">
                    {!isJoined && (
                        <>
                            <button className="btn btn-primary" onClick={() => net.createRoom(code)}>
                                创建房间
                            </button>
                            <button
                                className="btn btn-secondary"
                                onClick={() => net.joinRoom(code)}
                                disabled={!code}
                            >
                                加入房间
                            </button>
                        </>
                    )}
                    {isJoined && (
                        <>
                            <span className="status-text">
                                ROOM-{net.roomCode} · {Object.keys(net.players).length} 位成员
                            </span>
                            <button className="btn btn-secondary" onClick={net.leaveRoom}>
                                退出房间
                            </button>
                        </>
                    )}
                </div>
                {net.lastError && <div className="error-text">{net.lastError}</div>}
            </div>
        </div>
    );
}

function PetTab() {
    return (
        <div className="tab-pane">
            <div className="card">
                <div className="card-row">
                    <label>桌面宠物显示（未实现）</label>
                </div>
            </div>
        </div>
    );
}

function GlobalTab() {
    const settings = useSettingsStore();
    return (
        <div className="tab-pane">
            <div className="card">
                <div className="card-row">
                    <label>UI 缩放</label>
                    <NumberInput
                        value={Math.round(settings.uiScale * 100)}
                        onChange={(v) => settings.setUiScale(v / 100)}
                        min={Math.round(MIN_SCALE * 100)}
                        max={Math.round(MAX_SCALE * 100)}
                        suffix="%"
                    />
                </div>
                <div className="card-row">
                    <label>目标显示器</label>
                    <NumberInput
                        value={settings.targetMonitorIndex}
                        onChange={settings.setTargetMonitor}
                        min={0}
                        max={4}
                    />
                </div>
            </div>
        </div>
    );
}

interface NumberInputProps {
    value: number;
    onChange: (v: number) => void;
    min: number;
    max: number;
    suffix?: string;
}

function NumberInput({ value, onChange, min, max, suffix }: NumberInputProps) {
    return (
        <div className="num-input">
            <input
                type="number"
                value={value}
                min={min}
                max={max}
                onChange={(e) => onChange(Number(e.currentTarget.value))}
            />
            {suffix && <span className="num-suffix">{suffix}</span>}
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
