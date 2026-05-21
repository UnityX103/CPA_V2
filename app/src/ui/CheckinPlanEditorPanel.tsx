import type { CSSProperties, PointerEvent } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import {
    type CheckinDayPlan,
    type CheckinItem,
    type CheckinItemIcon,
    type CheckinItemType,
    type WeekdayKey,
    type WeeklyCheckinPlan,
    useCheckinStore,
} from '../domain/checkin';
import {
    CHECKIN_ITEM_ICON_OPTIONS,
    resolveCheckinItemIcon,
} from './checkinItemIcons';
import { CheckinItemIconGlyph } from './CheckinItemIconGlyph';
import { shouldStartWindowDrag } from './windowDrag';
import './CheckinPlanEditorPanel.css';

const WEEKDAYS: Array<{ key: WeekdayKey; label: string; shortLabel: string }> = [
    { key: 'mon', label: '周一', shortLabel: '一' },
    { key: 'tue', label: '周二', shortLabel: '二' },
    { key: 'wed', label: '周三', shortLabel: '三' },
    { key: 'thu', label: '周四', shortLabel: '四' },
    { key: 'fri', label: '周五', shortLabel: '五' },
    { key: 'sat', label: '周六', shortLabel: '六' },
    { key: 'sun', label: '周日', shortLabel: '日' },
];

const WEEKDAY_ROWS: WeekdayKey[][] = [
    ['mon', 'tue', 'wed', 'thu'],
    ['fri', 'sat', 'sun'],
];

const ITEM_COLORS: Record<CheckinItemIcon, string> = {
    activity: '#D15F3D',
    dumbbell: '#2D8F4E',
    bookOpen: '#E08C10',
    droplet: '#7C3AED',
    listChecks: '#5B4636',
    sparkle: '#D15F3D',
    coffee: '#8B5E3C',
    moon: '#2D8F4E',
    sun: '#E08C10',
    leaf: '#2D8F4E',
    music: '#7C3AED',
    pencil: '#5B4636',
    target: '#D15F3D',
    flame: '#D15F3D',
    heart: '#D15F3D',
    apple: '#D15F3D',
    clock: '#D15F3D',
    meditation: '#7C3AED',
};

function clonePlan(plan: WeeklyCheckinPlan): WeeklyCheckinPlan {
    return {
        ...plan,
        days: Object.fromEntries(
            WEEKDAYS.map(({ key }) => {
                const day = plan.days[key];
                return [
                    key,
                    day.kind === 'items'
                        ? { kind: 'items', items: day.items.map((item) => ({ ...item })) }
                        : { ...day },
                ];
            }),
        ) as WeeklyCheckinPlan['days'],
    };
}

function createItem(type: CheckinItemType): CheckinItem {
    const id = `${type === 'pomodoroFocus' ? 'pomodoro' : 'manual'}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    if (type === 'pomodoroFocus') {
        return {
            id,
            title: '专注番茄',
            type,
            targetCount: 4,
            icon: 'clock',
            perUseAmount: 25,
            perUseUnit: '分钟',
        };
    }

    return {
        id,
        title: '新栏目',
        type,
        targetCount: 1,
        icon: 'sparkle',
        perUseAmount: 1,
        perUseUnit: '次',
    };
}

function emptyItemsPlan(): CheckinDayPlan {
    return { kind: 'items', items: [] };
}

function itemColor(item: CheckinItem): string {
    return ITEM_COLORS[resolveCheckinItemIcon(item)];
}

function normalizeItemsForSave(items: CheckinItem[]): CheckinItem[] {
    let sawPomodoro = false;
    return items.map((item) => {
        const type = item.type === 'pomodoroFocus' && !sawPomodoro ? 'pomodoroFocus' : 'manual';
        if (type === 'pomodoroFocus') sawPomodoro = true;
        return {
            ...item,
            type,
            title: item.title.trim() || (type === 'pomodoroFocus' ? '专注番茄' : '新栏目'),
            targetCount: Math.max(1, Number(item.targetCount) || 1),
            perUseAmount: Math.max(0, Number(item.perUseAmount) || 0),
            perUseUnit: item.perUseUnit?.trim() || '次',
        };
    });
}

function normalizePlanForSave(plan: WeeklyCheckinPlan): WeeklyCheckinPlan {
    return {
        ...plan,
        days: Object.fromEntries(
            WEEKDAYS.map(({ key }) => {
                const day = plan.days[key];
                return [
                    key,
                    day.kind === 'items'
                        ? { kind: 'items', items: normalizeItemsForSave(day.items) }
                        : { ...day },
                ];
            }),
        ) as WeeklyCheckinPlan['days'],
    };
}

function dayStateLabel(plan: CheckinDayPlan): string {
    if (plan.kind === 'rest') return '✓';
    return '';
}

interface CheckinPlanEditorPanelProps {
    initialPlan?: WeeklyCheckinPlan;
    initialSelectedDay?: WeekdayKey;
}

export function CheckinPlanEditorPanel({ initialPlan, initialSelectedDay = 'mon' }: CheckinPlanEditorPanelProps = {}) {
    const storePlan = useCheckinStore((state) => state.weeklyPlan);
    const setWeeklyPlan = useCheckinStore((state) => state.setWeeklyPlan);
    const sourcePlan = initialPlan ?? storePlan;
    const [draft, setDraft] = useState(() => clonePlan(sourcePlan));
    const [isDirty, setIsDirty] = useState(false);
    const [selectedDay, setSelectedDay] = useState<WeekdayKey>(initialSelectedDay);
    const [isChoosingNewType, setIsChoosingNewType] = useState(true);
    const [openIconPickerFor, setOpenIconPickerFor] = useState<string | null>(null);
    const selectedMeta = useMemo(
        () => WEEKDAYS.find((day) => day.key === selectedDay) ?? WEEKDAYS[0],
        [selectedDay],
    );
    const selectedPlan = draft.days[selectedDay];
    const selectedItems = selectedPlan.kind === 'items' ? selectedPlan.items : [];
    const hasPomodoroItem = selectedItems.some((item) => item.type === 'pomodoroFocus');

    useEffect(() => {
        if (isDirty) return;
        setDraft(clonePlan(sourcePlan));
    }, [isDirty, sourcePlan]);

    const setSelectedPlan = (plan: CheckinDayPlan) => {
        setIsDirty(true);
        setDraft((current) => ({
            ...current,
            days: {
                ...current.days,
                [selectedDay]: plan,
            },
        }));
    };

    const updateItem = (id: string, patch: Partial<CheckinItem>) => {
        const currentPlan = draft.days[selectedDay];
        if (currentPlan.kind !== 'items') return;
        setSelectedPlan({
            kind: 'items',
            items: currentPlan.items.map((item) => item.id === id ? { ...item, ...patch } : item),
        });
    };

    const addItem = (type: CheckinItemType) => {
        if (type === 'pomodoroFocus' && hasPomodoroItem) return;
        const items = selectedPlan.kind === 'items' ? selectedPlan.items : [];
        setSelectedPlan({ kind: 'items', items: [...items, createItem(type)] });
        setIsChoosingNewType(false);
    };

    const removeItem = (id: string) => {
        if (selectedPlan.kind !== 'items') return;
        setSelectedPlan({ kind: 'items', items: selectedPlan.items.filter((item) => item.id !== id) });
    };

    const toggleRestDay = () => {
        setIsChoosingNewType(false);
        setOpenIconPickerFor(null);
        setSelectedPlan(selectedPlan.kind === 'rest' ? emptyItemsPlan() : { kind: 'rest' });
    };

    const toggleCarryToNextWeek = () => {
        setIsDirty(true);
        setDraft((current) => ({ ...current, carryToNextWeek: !current.carryToNextWeek }));
    };

    const closeWindow = () => {
        setDraft(clonePlan(sourcePlan));
        setIsDirty(false);
        void invoke('close_checkin_editor_window');
    };

    const savePlan = () => {
        setIsDirty(false);
        setWeeklyPlan(normalizePlanForSave(clonePlan(draft)));
        void invoke('close_checkin_editor_window');
    };

    const onPanelPointerDown = (e: PointerEvent<HTMLDivElement>) => {
        if (!shouldStartWindowDrag(e.button, e.target)) return;
        void getCurrentWindow().startDragging().catch(() => {
            /* drag may fail outside the Tauri runtime */
        });
    };

    return (
        <div
            className="checkin-editor-panel"
            data-testid="checkin-plan-editor-panel"
            onPointerDown={onPanelPointerDown}
        >
            <header className="checkin-editor-head">
                <div className="checkin-editor-title-wrap">
                    <h2>本周计划</h2>
                    <p>点击上方星期切换当天计划；空白日期自动继承前一天内容</p>
                </div>
                <span className="checkin-editor-status"><i />按日编辑</span>
            </header>

            <section className="checkin-editor-section checkin-editor-week-card" aria-label="选择日期">
                <div className="checkin-editor-section-head">
                    <strong>选择日期</strong>
                    <span>点击星期切换到当天计划；绿色表示已完成或休息</span>
                </div>
                <div className="checkin-editor-week-grid">
                    {WEEKDAY_ROWS.map((row) => (
                        <div key={row.join('-')} className="checkin-editor-week-row">
                            {row.map((key) => {
                                const day = WEEKDAYS.find((candidate) => candidate.key === key) ?? WEEKDAYS[0];
                                const plan = draft.days[key];
                                const isRestLike = plan.kind === 'rest';
                                return (
                                    <button
                                        key={key}
                                        type="button"
                                        className={[
                                            'checkin-editor-day-pill',
                                            selectedDay === key ? 'active' : '',
                                            isRestLike ? 'complete' : '',
                                        ].filter(Boolean).join(' ')}
                                        aria-label={day.label}
                                        onClick={() => {
                                            setSelectedDay(key);
                                            setIsChoosingNewType(false);
                                            setOpenIconPickerFor(null);
                                        }}
                                    >
                                        <span>{day.shortLabel}</span>
                                        {dayStateLabel(plan) ? <small>{dayStateLabel(plan)}</small> : null}
                                    </button>
                                );
                            })}
                        </div>
                    ))}
                </div>
            </section>

            <section className="checkin-editor-section checkin-editor-selected-card">
                <div className="checkin-editor-selected-row">
                    <div className="checkin-editor-title-wrap">
                        <strong>{selectedMeta.label}计划 · {selectedPlan.kind === 'rest' ? '休息日' : '普通打卡日'}</strong>
                        <p>{selectedPlan.kind === 'rest' ? '当天不会生成打卡项目' : '当前示例不是休息日；未填写时会继承前一天内容'}</p>
                    </div>
                    <button
                        type="button"
                        className={`checkin-editor-rest-toggle ${selectedPlan.kind === 'rest' ? 'active' : ''}`}
                        role="switch"
                        aria-label="休息日"
                        aria-checked={selectedPlan.kind === 'rest'}
                        onClick={toggleRestDay}
                    >
                        <span>休息日：{selectedPlan.kind === 'rest' ? '开' : '关'}</span>
                        <i />
                    </button>
                </div>
                <div className="checkin-editor-note">
                    <span className="lucide-text-icon">☷</span>
                    <p>普通日会显示当天打卡项目；需要跳过当天时再打开休息日开关。</p>
                </div>
            </section>

            <section className="checkin-editor-section checkin-editor-items-section">
                {selectedPlan.kind === 'rest' ? (
                    <div className="checkin-editor-rest-state">
                        <span>当天休息</span>
                        <p>今天不计入本周目标，打卡列表会隐藏。</p>
                    </div>
                ) : (
                    <>
                        <div className="checkin-editor-section-head checkin-editor-content-head">
                            <div className="checkin-editor-title-wrap">
                                <strong>{selectedMeta.label}内容</strong>
                                <p>{selectedPlan.kind === 'inherit' ? '无单独内容时继承前一天' : '非休息日可编辑当天打卡项目；无单独内容时继承前一天'}</p>
                            </div>
                            <span className="checkin-editor-plan-badge">✎ 计划日</span>
                        </div>

                        <div className="checkin-editor-section-head">
                            <div className="checkin-editor-title-wrap">
                                <strong>打卡项目</strong>
                                <p>新增时先选择番茄钟或通用；通用标题可编辑</p>
                            </div>
                            <button
                                type="button"
                                className="checkin-editor-primary"
                                aria-label="新增栏目"
                                onClick={() => setIsChoosingNewType(true)}
                            >
                                + 新增栏目
                            </button>
                        </div>

                        <div className="checkin-editor-items">
                            {isChoosingNewType ? (
                                <div className="checkin-editor-type-card">
                                    <div className="checkin-editor-type-card-head">
                                        <div className="checkin-editor-title-wrap">
                                            <strong>选择新栏目类型</strong>
                                            <p>先选择类型，再填写每次数量与每日目标</p>
                                        </div>
                                        <span>✣</span>
                                    </div>
                                    <div className="checkin-editor-type-options">
                                        <button
                                            type="button"
                                            className="checkin-editor-type-option pomodoro"
                                            disabled={hasPomodoroItem}
                                            onClick={() => addItem('pomodoroFocus')}
                                        >
                                            <span>↺</span>
                                            <strong>番茄钟</strong>
                                            <small>使用专注时长</small>
                                        </button>
                                        <button
                                            type="button"
                                            className="checkin-editor-type-option"
                                            onClick={() => addItem('manual')}
                                        >
                                            <span>✎</span>
                                            <strong>通用</strong>
                                            <small>自定义名称与单位</small>
                                        </button>
                                    </div>
                                </div>
                            ) : null}

                            {selectedItems.length === 0 ? (
                                <div className="checkin-editor-empty">还没有当天专属项目</div>
                            ) : selectedItems.map((item) => {
                                const icon = resolveCheckinItemIcon(item);
                                const color = itemColor(item);
                                return (
                                    <div
                                        key={item.id}
                                        className="checkin-editor-item-row"
                                        style={{ '--checkin-item-color': color } as CSSProperties}
                                    >
                                        <div className="checkin-editor-item-main">
                                            <button
                                                type="button"
                                                className="checkin-item-icon-button"
                                                aria-label={`更换 ${item.title} 图标`}
                                                onClick={() => setOpenIconPickerFor((current) => (
                                                    current === item.id ? null : item.id
                                                ))}
                                            >
                                                <CheckinItemIconGlyph icon={icon} />
                                            </button>
                                            <div className="checkin-editor-item-copy">
                                                <input
                                                    aria-label={item.title === '新栏目' ? '新栏目名称' : `${item.title} 标题`}
                                                    value={item.title}
                                                    onChange={(event) => updateItem(item.id, { title: event.target.value })}
                                                />
                                                <p>每次 {item.perUseAmount ?? (item.type === 'pomodoroFocus' ? 25 : 1)} {item.perUseUnit ?? (item.type === 'pomodoroFocus' ? '分钟' : '次')}，目标 {item.targetCount} 次</p>
                                            </div>
                                            {openIconPickerFor === item.id ? (
                                                <div className="checkin-icon-picker" role="menu" aria-label={`${item.title} 图标选择`}>
                                                    {CHECKIN_ITEM_ICON_OPTIONS.map((option) => (
                                                        <button
                                                            key={option.id}
                                                            type="button"
                                                            role="menuitem"
                                                            aria-label={option.label}
                                                            onClick={() => {
                                                                updateItem(item.id, { icon: option.id });
                                                                setOpenIconPickerFor(null);
                                                            }}
                                                        >
                                                            <CheckinItemIconGlyph icon={option.id} />
                                                        </button>
                                                    ))}
                                                </div>
                                            ) : null}
                                        </div>

                                        <label className="checkin-item-metric">
                                            <span>每次</span>
                                            <span className="checkin-item-metric-line">
                                                <input
                                                    aria-label={`${item.title} 每次数量`}
                                                    type="number"
                                                    min={0}
                                                    value={item.perUseAmount ?? (item.type === 'pomodoroFocus' ? 25 : 1)}
                                                    onChange={(event) => updateItem(item.id, {
                                                        perUseAmount: Math.max(0, Number(event.target.value) || 0),
                                                    })}
                                                />
                                                <input
                                                    aria-label={`${item.title} 每次单位`}
                                                    value={item.perUseUnit ?? (item.type === 'pomodoroFocus' ? '分钟' : '次')}
                                                    onChange={(event) => updateItem(item.id, { perUseUnit: event.target.value })}
                                                />
                                            </span>
                                        </label>

                                        <label className="checkin-item-metric">
                                            <span>目标</span>
                                            <span className="checkin-item-metric-line">
                                                <input
                                                    aria-label={`${item.title} 每日目标`}
                                                    type="number"
                                                    min={1}
                                                    value={item.targetCount}
                                                    onChange={(event) => updateItem(item.id, {
                                                        targetCount: Math.max(1, Number(event.target.value) || 1),
                                                    })}
                                                />
                                                <em>次</em>
                                            </span>
                                        </label>

                                        <button
                                            type="button"
                                            className="checkin-editor-row-action"
                                            aria-label={`删除 ${item.title}`}
                                            onClick={() => removeItem(item.id)}
                                        >
                                            ⋮⋮
                                        </button>
                                    </div>
                                );
                            })}
                        </div>

                        <div className="checkin-editor-rest-hint">
                            <CheckinItemIconGlyph icon="moon" />
                            <p>开启休息日后，本列表会被“当天休息”状态替换。</p>
                        </div>
                    </>
                )}
            </section>

            <button
                type="button"
                className={`checkin-editor-carry ${draft.carryToNextWeek ? 'active' : ''}`}
                aria-label="下周沿用当前计划"
                aria-pressed={draft.carryToNextWeek}
                onClick={toggleCarryToNextWeek}
            >
                <span>
                    <strong>下周沿用当前计划</strong>
                    <small>保存后作为当前激活计划的下周默认配置</small>
                </span>
                <i />
            </button>

            <footer className="checkin-editor-actions">
                <button type="button" onClick={closeWindow}>取消</button>
                <button type="button" className="checkin-editor-primary" onClick={savePlan}>保存计划</button>
            </footer>
        </div>
    );
}
