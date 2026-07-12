import { useState, type ReactNode } from 'react';
import { PomodoroPanel } from './ui/PomodoroPanel';
import { PlayerCard } from './ui/PlayerCard';
import { SettingsPanel } from './ui/SettingsPanel';
import { CheckinPlanEditorPanel } from './ui/CheckinPlanEditorPanel';
import { useSettingsStore, type SettingsTab } from './domain/settings';
import type { RemotePlayer } from './domain/network';
import type { CheckinPlanTemplate } from './domain/checkin';
import './styles/global.css';
import './DevAlignApp.css';

/* DevAlign：本地仅用，把 Pencil 设计稿 PNG 与活组件并排（或叠加）展示。
 * 启动：npm run dev → http://localhost:1420/?window=devalign
 *
 * 注意：tab 子面板（gs1Tv/8Le5R/Pdj9C/v2ZgA）在设计稿里是 572 宽的独立画布；
 * 实际嵌入 vnYnS 后会 reflow 到 349 宽。所以这里只对齐 vnYnS / YRqeB / drqFB 这种
 * 标准实例尺寸的节点；想看子 tab 就在 vnYnS 上切 activeTab。
 */

interface Target {
    id: string;
    label: string;
    image: string;        // 相对 public 的路径
    width: number;        // 设计稿逻辑宽
    height: number;       // 设计稿逻辑高
    render: () => ReactNode;
    note?: string;        // 备注，例如「Pomodoro tab 当前默认显示」
}

const MOCK_PLAYER: RemotePlayer = {
    playerId: 'mock-1',
    playerName: '示例玩家',
    state: {
        pomodoro: {
            phase: 0,
            isRunning: true,
            remainingSeconds: 1200,
            currentRound: 2,
            totalRounds: 4,
        },
        activeApp: { name: 'Visual Studio Code', bundleId: 'com.microsoft.VSCode' },
        bindingKey: { keyLabel: 'Space', pressCount: 234 },
    },
};

const MOCK_CHECKIN_TEMPLATE: CheckinPlanTemplate = {
    schemaVersion: 2,
    carryToNextWeek: true,
    items: [
        {
            id: 'read',
            title: '阅读',
            type: 'manual',
            targetCount: 2,
            icon: 'bookOpen',
            repeatDays: ['mon', 'tue', 'wed', 'thu', 'fri'],
            editMode: 'cycle',
            perUseAmount: 30,
            perUseUnit: '分钟',
        },
        {
            id: 'water',
            title: '喝水',
            type: 'manual',
            targetCount: 10,
            icon: 'droplet',
            repeatDays: ['tue', 'thu', 'sat'],
            editMode: 'count',
            perUseAmount: 2,
            perUseUnit: '杯',
            countInputValue: 10,
            countUnitSize: 2,
            countUnitLabel: '杯',
            countLoopCount: 5,
        },
        {
            id: 'focus',
            title: '专注番茄',
            type: 'pomodoroFocus',
            targetCount: 4,
            icon: 'clock',
            repeatDays: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'],
            editMode: 'cycle',
            perUseAmount: 25,
            perUseUnit: '分钟',
        },
    ],
};

const TARGETS: Target[] = [
    {
        id: 'vnYnS',
        label: '设置面板 vnYnS (460×394→440)',
        image: 'dev-align/vnYnS.png',
        width: 460,
        height: 394,
        render: () => <SettingsPanel />,
        note: '设计稿 394；活组件已扩到 440 (WSnlp 收起)，所以下边会比设计稿多 46px。',
    },
    {
        id: 'YRqeB',
        label: '番茄面板 YRqeB (233×155)',
        image: 'dev-align/YRqeB.png',
        width: 233,
        height: 155,
        render: () => <PomodoroPanel />,
    },
    {
        id: 'drqFB',
        label: '玩家卡片 drqFB (153×94)',
        image: 'dev-align/drqFB.png',
        width: 153,
        height: 94,
        render: () => <PlayerCard player={MOCK_PLAYER} />,
    },
    {
        id: 's6g1w-html',
        label: '打卡计划编辑器 s6g1w HTML sync (460×898)',
        image: 'dev-align/s6g1w.png',
        width: 460,
        height: 898,
        render: () => <CheckinPlanEditorPanel initialTemplate={MOCK_CHECKIN_TEMPLATE} />,
        note: '左侧为 Pencil s6g1w 导出；右侧为当前 React 编辑器。',
    },
];

type Mode = 'side' | 'overlay';

const TABS: Array<{ id: SettingsTab; label: string }> = [
    { id: 'pomodoro', label: '番茄钟' },
    { id: 'online', label: '联机' },
    { id: 'global', label: '全局' },
    { id: 'videoEditor', label: '视频编辑' },
];

function initialTargetId(): string {
    const target = new URLSearchParams(window.location.search).get('target');
    return TARGETS.some((item) => item.id === target) ? target! : TARGETS[0].id;
}

function initialMode(): Mode {
    return new URLSearchParams(window.location.search).get('mode') === 'overlay' ? 'overlay' : 'side';
}

export default function DevAlignApp() {
    const [targetId, setTargetId] = useState(initialTargetId);
    const [mode, setMode] = useState<Mode>(initialMode);
    const [opacity, setOpacity] = useState(50);
    const [showGrid, setShowGrid] = useState(false);
    const [bg, setBg] = useState<'checker' | 'white' | 'dark'>('checker');
    const settingsActiveTab = useSettingsStore((s) => s.activeTab);
    const setSettingsActiveTab = useSettingsStore((s) => s.setActiveTab);

    const target = TARGETS.find((t) => t.id === targetId) ?? TARGETS[0];
    const isSettings = target.id === 'vnYnS';

    return (
        <div className="dev-align">
            <header className="dev-align-header">
                <div className="dev-align-title">Design ↔ Live 对齐</div>

                <div className="dev-align-controls">
                    <label className="dev-control">
                        <span>组件</span>
                        <select value={targetId} onChange={(e) => setTargetId(e.currentTarget.value)}>
                            {TARGETS.map((t) => (
                                <option key={t.id} value={t.id}>{t.label}</option>
                            ))}
                        </select>
                    </label>

                    {isSettings && (
                        <label className="dev-control">
                            <span>Tab</span>
                            <select
                                value={settingsActiveTab}
                                onChange={(e) => setSettingsActiveTab(e.currentTarget.value as SettingsTab)}
                            >
                                {TABS.map((t) => (
                                    <option key={t.id} value={t.id}>{t.label}</option>
                                ))}
                            </select>
                        </label>
                    )}

                    <div className="dev-control dev-mode">
                        <button
                            className={mode === 'side' ? 'on' : ''}
                            onClick={() => setMode('side')}
                        >并排</button>
                        <button
                            className={mode === 'overlay' ? 'on' : ''}
                            onClick={() => setMode('overlay')}
                        >叠加</button>
                    </div>

                    {mode === 'overlay' && (
                        <label className="dev-control dev-control-wide">
                            <span>Live 透明 {opacity}%</span>
                            <input
                                type="range"
                                min={0}
                                max={100}
                                value={opacity}
                                onChange={(e) => setOpacity(Number(e.currentTarget.value))}
                            />
                        </label>
                    )}

                    <label className="dev-control">
                        <span>网格</span>
                        <input
                            type="checkbox"
                            checked={showGrid}
                            onChange={(e) => setShowGrid(e.currentTarget.checked)}
                        />
                    </label>

                    <div className="dev-control dev-mode">
                        <button className={bg === 'checker' ? 'on' : ''} onClick={() => setBg('checker')}>棋盘</button>
                        <button className={bg === 'white' ? 'on' : ''} onClick={() => setBg('white')}>白</button>
                        <button className={bg === 'dark' ? 'on' : ''} onClick={() => setBg('dark')}>暗</button>
                    </div>
                </div>

                {target.note && <div className="dev-align-note">{target.note}</div>}
            </header>

            <div className={`dev-align-stage bg-${bg}`}>
                {mode === 'side' ? (
                    <div className="dev-align-row">
                        <PaneFrame title="Pencil 设计稿" width={target.width} height={target.height} showGrid={showGrid}>
                            <img src={target.image} alt={target.id} className="dev-png" />
                        </PaneFrame>
                        <PaneFrame title="Live React" width={target.width} height={target.height} showGrid={showGrid}>
                            {target.render()}
                        </PaneFrame>
                    </div>
                ) : (
                    <PaneFrame
                        title={`叠加 (Pencil 100% · Live ${opacity}%)`}
                        width={target.width}
                        height={target.height}
                        showGrid={showGrid}
                    >
                        <img src={target.image} alt={target.id} className="dev-png dev-overlay-bg" />
                        <div className="dev-overlay-top" style={{ opacity: opacity / 100 }}>
                            {target.render()}
                        </div>
                    </PaneFrame>
                )}
            </div>
        </div>
    );
}

interface PaneProps {
    title: string;
    width: number;
    height: number;
    showGrid: boolean;
    children: ReactNode;
}

function PaneFrame({ title, width, height, showGrid, children }: PaneProps) {
    return (
        <div className="dev-pane">
            <div className="dev-pane-title">
                {title} <span className="dev-pane-dim">{width}×{height}</span>
            </div>
            <div
                className={`dev-pane-frame ${showGrid ? 'with-grid' : ''}`}
                style={{ width, height }}
            >
                {children}
            </div>
        </div>
    );
}
