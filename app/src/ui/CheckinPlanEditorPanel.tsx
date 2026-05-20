import { useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
    type CheckinDayPlan,
    type CheckinItem,
    type CheckinItemType,
    type WeekdayKey,
    type WeeklyCheckinPlan,
    useCheckinStore,
} from '../domain/checkin';
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

function createItem(): CheckinItem {
    return {
        id: `manual-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
        title: '新栏目',
        type: 'manual',
        targetCount: 1,
    };
}

function emptyItemsPlan(): CheckinDayPlan {
    return { kind: 'items', items: [] };
}

export function CheckinPlanEditorPanel() {
    const sourcePlan = useCheckinStore((state) => state.weeklyPlan);
    const setWeeklyPlan = useCheckinStore((state) => state.setWeeklyPlan);
    const [draft, setDraft] = useState(() => clonePlan(sourcePlan));
    const [isDirty, setIsDirty] = useState(false);
    const [selectedDay, setSelectedDay] = useState<WeekdayKey>('mon');
    const selectedMeta = useMemo(
        () => WEEKDAYS.find((day) => day.key === selectedDay) ?? WEEKDAYS[0],
        [selectedDay],
    );
    const selectedPlan = draft.days[selectedDay];
    const selectedItems = selectedPlan.kind === 'items' ? selectedPlan.items : [];

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

    const updateItem = (id: string, patch: Partial<Pick<CheckinItem, 'title' | 'targetCount' | 'type'>>) => {
        if (selectedPlan.kind !== 'items') return;

        setSelectedPlan({
            kind: 'items',
            items: selectedPlan.items.map((item) => item.id === id ? { ...item, ...patch } : item),
        });
    };

    const addItem = () => {
        const items = selectedPlan.kind === 'items' ? selectedPlan.items : [];
        setSelectedPlan({ kind: 'items', items: [...items, createItem()] });
    };

    const removeItem = (id: string) => {
        if (selectedPlan.kind !== 'items') return;
        setSelectedPlan({ kind: 'items', items: selectedPlan.items.filter((item) => item.id !== id) });
    };

    const toggleRestDay = () => {
        setSelectedPlan(selectedPlan.kind === 'rest' ? emptyItemsPlan() : { kind: 'rest' });
    };

    const toggleCarryToNextWeek = () => {
        setIsDirty(true);
        setDraft((current) => ({ ...current, carryToNextWeek: !current.carryToNextWeek }));
    };

    const closeWindow = () => {
        void invoke('close_checkin_editor_window');
    };

    const savePlan = () => {
        setIsDirty(false);
        setWeeklyPlan(clonePlan(draft));
        closeWindow();
    };

    return (
        <div className="checkin-editor-panel" data-testid="checkin-plan-editor-panel">
            <header className="checkin-editor-head">
                <div className="checkin-editor-title-wrap">
                    <h2>本周计划</h2>
                    <p>{draft.weekStartDate} 开始</p>
                </div>
                <span className="checkin-editor-status">按日编辑</span>
            </header>

            <section className="checkin-editor-section" aria-label="选择日期">
                <div className="checkin-editor-section-head">
                    <strong>选择日期</strong>
                    <span>继承日期会沿用前一个有效计划</span>
                </div>
                <div className="checkin-editor-week-grid">
                    {WEEKDAYS.map((day) => {
                        const plan = draft.days[day.key];
                        return (
                            <button
                                key={day.key}
                                type="button"
                                className={selectedDay === day.key ? 'active' : ''}
                                aria-label={day.label}
                                onClick={() => setSelectedDay(day.key)}
                            >
                                <span>{day.shortLabel}</span>
                                <small>{plan.kind === 'rest' ? '休' : plan.kind === 'items' ? '项' : '承'}</small>
                            </button>
                        );
                    })}
                </div>
            </section>

            <section className="checkin-editor-section">
                <div className="checkin-editor-selected-row">
                    <div className="checkin-editor-title-wrap">
                        <strong>{selectedMeta.label}计划</strong>
                        <p>{selectedPlan.kind === 'rest' ? '当天不会生成打卡项目' : '编辑当天手动打卡项目'}</p>
                    </div>
                    <button
                        type="button"
                        className={selectedPlan.kind === 'rest' ? 'active' : ''}
                        role="switch"
                        aria-label="休息日"
                        aria-checked={selectedPlan.kind === 'rest'}
                        onClick={toggleRestDay}
                    >
                        休息日
                    </button>
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
                        <div className="checkin-editor-section-head">
                            <div className="checkin-editor-title-wrap">
                                <strong>打卡项目</strong>
                                <p>{selectedPlan.kind === 'inherit' ? '当前为继承状态，新增后会改为当天计划' : '通用项目可手动 +1 完成'}</p>
                            </div>
                            <button type="button" className="checkin-editor-primary" onClick={addItem}>
                                新增栏目
                            </button>
                        </div>

                        <div className="checkin-editor-items">
                            {selectedItems.length === 0 ? (
                                <div className="checkin-editor-empty">还没有当天专属项目</div>
                            ) : selectedItems.map((item) => (
                                <div key={item.id} className="checkin-editor-item-row">
                                    <label>
                                        <span>类型</span>
                                        <select
                                            aria-label={`${item.title} 类型`}
                                            value={item.type}
                                            onChange={(event) => updateItem(item.id, {
                                                type: event.target.value as CheckinItemType,
                                            })}
                                        >
                                            <option value="manual">通用</option>
                                            <option value="pomodoroFocus">番茄钟</option>
                                        </select>
                                    </label>
                                    <label className="checkin-editor-title-field">
                                        <span>名称</span>
                                        <input
                                            aria-label={item.title === '新栏目' ? '新栏目名称' : `${item.title} 名称`}
                                            value={item.title}
                                            onChange={(event) => updateItem(item.id, { title: event.target.value })}
                                        />
                                    </label>
                                    <label>
                                        <span>目标</span>
                                        <input
                                            aria-label={`${item.title} 目标次数`}
                                            min={1}
                                            type="number"
                                            value={item.targetCount}
                                            onChange={(event) => updateItem(item.id, {
                                                targetCount: Math.max(1, Number(event.target.value) || 1),
                                            })}
                                        />
                                    </label>
                                    <button type="button" aria-label={`删除 ${item.title}`} onClick={() => removeItem(item.id)}>
                                        删除
                                    </button>
                                </div>
                            ))}
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
                <span>下周沿用当前计划</span>
                <strong>{draft.carryToNextWeek ? '开' : '关'}</strong>
            </button>

            <footer className="checkin-editor-actions">
                <button type="button" onClick={closeWindow}>取消</button>
                <button type="button" className="checkin-editor-primary" onClick={savePlan}>保存计划</button>
            </footer>
        </div>
    );
}
