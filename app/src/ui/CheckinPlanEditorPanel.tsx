import type { CSSProperties, PointerEvent } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import {
    clonePlanTemplate,
    normalizePlanTemplate,
    type CheckinEditMode,
    type CheckinItemIcon,
    type CheckinItemType,
    type CheckinPlanItem,
    type CheckinPlanTemplate,
    type WeekdayKey,
    useCheckinStore,
    WEEKDAYS,
} from '../domain/checkin';
import {
    CHECKIN_ITEM_ICON_OPTIONS,
    resolveCheckinItemIcon,
} from './checkinItemIcons';
import { CheckinItemIconGlyph } from './CheckinItemIconGlyph';
import { shouldStartWindowDrag } from './windowDrag';
import './CheckinPlanEditorPanel.css';

const WEEKDAY_META: Array<{ key: WeekdayKey; label: string; shortLabel: string }> = [
    { key: 'mon', label: '周一', shortLabel: '一' },
    { key: 'tue', label: '周二', shortLabel: '二' },
    { key: 'wed', label: '周三', shortLabel: '三' },
    { key: 'thu', label: '周四', shortLabel: '四' },
    { key: 'fri', label: '周五', shortLabel: '五' },
    { key: 'sat', label: '周六', shortLabel: '六' },
    { key: 'sun', label: '周日', shortLabel: '日' },
];

const ITEM_COLORS: Record<CheckinItemIcon, string> = {
    activity: '#D15F3D',
    dumbbell: '#2D8F4E',
    bookOpen: '#E08C10',
    droplet: '#2D8F4E',
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

interface CheckinPlanEditorPanelProps {
    initialTemplate?: CheckinPlanTemplate;
}

function createItem(type: CheckinItemType = 'manual'): CheckinPlanItem {
    const id = `${type === 'pomodoroFocus' ? 'pomodoro' : 'manual'}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    if (type === 'pomodoroFocus') {
        return {
            id,
            title: '专注番茄',
            type,
            targetCount: 4,
            icon: 'clock',
            repeatDays: [...WEEKDAYS],
            editMode: 'cycle',
            perUseAmount: 25,
            perUseUnit: '分钟',
            countInputValue: 4,
            countUnitSize: 4,
            countUnitLabel: '次',
            countLoopCount: 1,
        };
    }

    return {
        id,
        title: '新项目',
        type,
        targetCount: 1,
        icon: 'sparkle',
        repeatDays: [...WEEKDAYS],
        editMode: 'cycle',
        perUseAmount: 1,
        perUseUnit: '次',
        countInputValue: 1,
        countUnitSize: 1,
        countUnitLabel: '次',
        countLoopCount: 1,
    };
}

function itemColor(item: CheckinPlanItem): string {
    return ITEM_COLORS[resolveCheckinItemIcon(item)];
}

function normalizeDraft(draft: CheckinPlanTemplate): CheckinPlanTemplate {
    return normalizePlanTemplate({
        ...draft,
        items: draft.items.map((item) => ({
            ...item,
            title: item.title.trim() || (item.type === 'pomodoroFocus' ? '专注番茄' : '新项目'),
            targetCount: Math.max(1, Number(item.targetCount) || 1),
            perUseAmount: Math.max(0, Number(item.perUseAmount) || 0),
            perUseUnit: item.perUseUnit?.trim() || '次',
            countInputValue: Math.max(0, Number(item.countInputValue) || 0),
            countUnitSize: Math.max(1, Number(item.countUnitSize) || 1),
            countUnitLabel: item.countUnitLabel?.trim() || '次',
            countLoopCount: Math.max(1, Number(item.countLoopCount) || 1),
        })),
    }) ?? clonePlanTemplate(draft);
}

export function CheckinPlanEditorPanel({ initialTemplate }: CheckinPlanEditorPanelProps = {}) {
    const storeTemplate = useCheckinStore((state) => state.planTemplate);
    const setPlanTemplate = useCheckinStore((state) => state.setPlanTemplate);
    const sourceTemplate = useMemo(
        () => initialTemplate ?? storeTemplate,
        [initialTemplate, storeTemplate],
    );
    const [draft, setDraft] = useState(() => clonePlanTemplate(sourceTemplate));
    const [isDirty, setIsDirty] = useState(false);
    const [openIconPickerFor, setOpenIconPickerFor] = useState<string | null>(null);

    useEffect(() => {
        if (isDirty) return;
        setDraft(clonePlanTemplate(sourceTemplate));
    }, [isDirty, sourceTemplate]);

    const updateItem = (id: string, patch: Partial<CheckinPlanItem>) => {
        setIsDirty(true);
        setDraft((current) => ({
            ...current,
            items: current.items.map((item) => item.id === id ? { ...item, ...patch } : item),
        }));
    };

    const addItem = () => {
        setIsDirty(true);
        setOpenIconPickerFor(null);
        setDraft((current) => ({
            ...current,
            items: [...current.items, createItem('manual')],
        }));
    };

    const removeItem = (id: string) => {
        setIsDirty(true);
        setOpenIconPickerFor(null);
        setDraft((current) => ({
            ...current,
            items: current.items.filter((item) => item.id !== id),
        }));
    };

    const toggleRepeatDay = (item: CheckinPlanItem, day: WeekdayKey) => {
        const hasDay = item.repeatDays.includes(day);
        const repeatDays = hasDay
            ? item.repeatDays.filter((current) => current !== day)
            : WEEKDAYS.filter((current) => current === day || item.repeatDays.includes(current));
        updateItem(item.id, { repeatDays });
    };

    const setEditMode = (item: CheckinPlanItem, editMode: CheckinEditMode) => {
        updateItem(item.id, { editMode });
    };

    const toggleCarryToNextWeek = () => {
        setIsDirty(true);
        setDraft((current) => ({ ...current, carryToNextWeek: !current.carryToNextWeek }));
    };

    const closeWindow = () => {
        setOpenIconPickerFor(null);
        setDraft(clonePlanTemplate(sourceTemplate));
        setIsDirty(false);
        void invoke('close_checkin_editor_window');
    };

    const savePlan = () => {
        setOpenIconPickerFor(null);
        setIsDirty(false);
        setPlanTemplate(normalizeDraft(draft));
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
                    <h2>计划编辑</h2>
                    <p>每个事项单独设置重复日期和次数信息</p>
                </div>
                <span className="checkin-editor-status"><i />按事项编辑</span>
            </header>

            <section className="checkin-editor-section checkin-editor-items-section" aria-label="打卡计划项目">
                <div className="checkin-editor-section-head checkin-editor-content-head">
                    <div className="checkin-editor-title-wrap">
                        <strong>打卡计划项目</strong>
                        <p>{draft.items.length} 个事项</p>
                    </div>
                    <button
                        type="button"
                        className="checkin-editor-primary"
                        aria-label="新增项目"
                        onClick={addItem}
                    >
                        + 新增项目
                    </button>
                </div>

                <div className="checkin-editor-items">
                    {draft.items.map((item) => {
                        const icon = resolveCheckinItemIcon(item);
                        const modeLabel = item.editMode === 'count' ? '次数' : '周期';
                        return (
                            <article
                                key={item.id}
                                className="checkin-editor-item-row repeat-plan-item-row"
                                data-testid={`checkin-item-row-${item.id}`}
                                style={{
                                    '--item-color': itemColor(item),
                                    '--checkin-item-color': itemColor(item),
                                } as CSSProperties}
                            >
                                <div className="checkin-editor-item-main">
                                    <div className="checkin-editor-icon-wrap">
                                        <button
                                            type="button"
                                            className="checkin-item-icon-button"
                                            aria-label={`更换 ${item.title} 图标`}
                                            onClick={() => setOpenIconPickerFor(openIconPickerFor === item.id ? null : item.id)}
                                        >
                                            <CheckinItemIconGlyph icon={icon} />
                                        </button>
                                        {openIconPickerFor === item.id ? (
                                            <div className="checkin-icon-picker" role="menu">
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

                                    <label className="checkin-editor-field title">
                                        <span>事项</span>
                                        <input
                                            aria-label={`${item.title} 标题`}
                                            value={item.title}
                                            onChange={(event) => updateItem(item.id, { title: event.target.value })}
                                        />
                                    </label>

                                    <label className="checkin-editor-field small">
                                        <span>目标</span>
                                        <input
                                            aria-label={`${item.title} 目标次数`}
                                            type="number"
                                            min={1}
                                            value={item.targetCount}
                                            onChange={(event) => updateItem(item.id, { targetCount: Number(event.target.value) })}
                                        />
                                    </label>

                                    <button
                                        type="button"
                                        className="checkin-editor-row-action"
                                        aria-label={`删除 ${item.title}`}
                                        onClick={() => removeItem(item.id)}
                                    >
                                        ×
                                    </button>
                                </div>

                                <div className="checkin-editor-mode-row" role="group" aria-label={`${item.title} 编辑模式`}>
                                    <button
                                        type="button"
                                        className={item.editMode === 'cycle' ? 'active' : ''}
                                        aria-label={`${item.title} 周期`}
                                        onClick={() => setEditMode(item, 'cycle')}
                                    >
                                        周期
                                    </button>
                                    <button
                                        type="button"
                                        className={item.editMode === 'count' ? 'active' : ''}
                                        aria-label={`${item.title} 次数`}
                                        onClick={() => setEditMode(item, 'count')}
                                    >
                                        次数
                                    </button>
                                    <span>{modeLabel}</span>
                                </div>

                                {item.editMode === 'count' ? (
                                    <div className="checkin-editor-count-grid">
                                        <label className="checkin-editor-field">
                                            <span>输入值</span>
                                            <input
                                                aria-label={`${item.title} 输入值`}
                                                type="number"
                                                min={0}
                                                value={item.countInputValue ?? item.targetCount}
                                                onChange={(event) => updateItem(item.id, { countInputValue: Number(event.target.value) })}
                                            />
                                        </label>
                                        <label className="checkin-editor-field">
                                            <span>每轮次数</span>
                                            <input
                                                aria-label={`${item.title} 每轮次数`}
                                                type="number"
                                                min={1}
                                                value={item.countUnitSize ?? item.targetCount}
                                                onChange={(event) => updateItem(item.id, { countUnitSize: Number(event.target.value) })}
                                            />
                                        </label>
                                        <label className="checkin-editor-field">
                                            <span>循环次数</span>
                                            <input
                                                aria-label={`${item.title} 循环次数`}
                                                type="number"
                                                min={1}
                                                value={item.countLoopCount ?? 1}
                                                onChange={(event) => updateItem(item.id, { countLoopCount: Number(event.target.value) })}
                                            />
                                        </label>
                                    </div>
                                ) : (
                                    <div className="checkin-editor-repeat-days">
                                        {WEEKDAY_META.map((day) => (
                                            <button
                                                key={day.key}
                                                type="button"
                                                className={item.repeatDays.includes(day.key) ? 'active' : ''}
                                                aria-label={`${item.title} ${day.label}`}
                                                aria-pressed={item.repeatDays.includes(day.key)}
                                                onClick={() => toggleRepeatDay(item, day.key)}
                                            >
                                                {day.shortLabel}
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </article>
                        );
                    })}
                </div>
            </section>

            <button
                type="button"
                className={`checkin-editor-carry ${draft.carryToNextWeek ? 'active' : ''}`}
                aria-label="下周沿用当前计划"
                aria-pressed={draft.carryToNextWeek}
                onClick={toggleCarryToNextWeek}
            >
                <span>下周沿用当前计划</span>
                <i />
            </button>

            <footer className="checkin-editor-actions">
                <button type="button" onClick={closeWindow}>取消</button>
                <button type="button" className="checkin-editor-primary" onClick={savePlan}>保存计划</button>
            </footer>
        </div>
    );
}
