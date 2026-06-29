import type { CSSProperties, DragEvent, PointerEvent } from 'react';
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

function countPerUseAmount(item: CheckinPlanItem): number {
    return item.perUseAmount ?? item.countInputValue ?? 1;
}

function countPerUseUnit(item: CheckinPlanItem): string {
    return item.perUseUnit ?? item.countUnitLabel ?? '次';
}

function countLoopCount(item: CheckinPlanItem): number {
    return item.countLoopCount ?? 1;
}

function normalizeDraft(draft: CheckinPlanTemplate): CheckinPlanTemplate {
    return normalizePlanTemplate({
        ...draft,
        items: draft.items.map((item) => ({
            ...item,
            title: item.title.trim() || (item.type === 'pomodoroFocus' ? '专注番茄' : '新项目'),
            targetCount: Math.max(1, Number(item.targetCount) || 1),
            perUseAmount: Math.max(0, Number(countPerUseAmount(item)) || 0),
            perUseUnit: countPerUseUnit(item).trim() || '次',
            countInputValue: Math.max(0, Number(item.countInputValue) || 0),
            countUnitSize: Math.max(1, Number(item.countUnitSize) || 1),
            countUnitLabel: item.countUnitLabel?.trim() || '次',
            countLoopCount: Math.max(1, Number(countLoopCount(item)) || 1),
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
    const [draggedItemId, setDraggedItemId] = useState<string | null>(null);
    const [dropTargetItemId, setDropTargetItemId] = useState<string | null>(null);

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

    const reorderItems = (dragId: string, targetId: string) => {
        if (dragId === targetId) return;
        setIsDirty(true);
        setOpenIconPickerFor(null);
        setDraft((current) => {
            const fromIndex = current.items.findIndex((item) => item.id === dragId);
            const toIndex = current.items.findIndex((item) => item.id === targetId);
            if (fromIndex < 0 || toIndex < 0) return current;
            const items = [...current.items];
            const [dragged] = items.splice(fromIndex, 1);
            items.splice(toIndex, 0, dragged);
            return { ...current, items };
        });
    };

    const startItemDrag = (event: DragEvent<HTMLElement>, itemId: string) => {
        setDraggedItemId(itemId);
        setDropTargetItemId(null);
        if (event.dataTransfer) {
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData('text/plain', itemId);
        }
    };

    const dragOverItem = (event: DragEvent<HTMLElement>, itemId: string) => {
        if (!draggedItemId || draggedItemId === itemId) return;
        event.preventDefault();
        if (event.dataTransfer) {
            event.dataTransfer.dropEffect = 'move';
        }
        setDropTargetItemId(itemId);
    };

    const dropItem = (event: DragEvent<HTMLElement>, itemId: string) => {
        event.preventDefault();
        const dragId = event.dataTransfer?.getData('text/plain') || draggedItemId;
        if (dragId) reorderItems(dragId, itemId);
        setDraggedItemId(null);
        setDropTargetItemId(null);
    };

    const endItemDrag = () => {
        setDraggedItemId(null);
        setDropTargetItemId(null);
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

    const changeLoopCount = (item: CheckinPlanItem, delta: number) => {
        updateItem(item.id, { countLoopCount: Math.max(1, countLoopCount(item) + delta) });
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
                    <p>每个打卡事项都可以单独设置重复周期；保存后立即作为当前计划模板</p>
                </div>
            </header>

            <section className="checkin-editor-section checkin-editor-items-section" aria-label="打卡计划项目">
                <div className="checkin-editor-section-head checkin-editor-content-head">
                    <div className="checkin-editor-title-wrap">
                        <strong>打卡计划项目</strong>
                        <p>每个项目设置自己的重复周期，不再按某一天统一编辑</p>
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
                        const isCountMode = item.editMode === 'count';
                        const subtitle = item.type === 'pomodoroFocus'
                            ? '每天自动生成番茄钟打卡'
                            : `每次完成记录 ${item.perUseAmount ?? 1}${item.perUseUnit ?? '次'}`;
                        return (
                            <article
                                key={item.id}
                                className={[
                                    'checkin-editor-item-row repeat-plan-item-row',
                                    draggedItemId === item.id ? 'is-dragging' : '',
                                    dropTargetItemId === item.id ? 'is-drop-target' : '',
                                ].filter(Boolean).join(' ')}
                                data-testid={`checkin-item-row-${item.id}`}
                                data-no-window-drag
                                draggable
                                onDragStart={(event) => startItemDrag(event, item.id)}
                                onDragOver={(event) => dragOverItem(event, item.id)}
                                onDragLeave={() => {
                                    if (dropTargetItemId === item.id) setDropTargetItemId(null);
                                }}
                                onDrop={(event) => dropItem(event, item.id)}
                                onDragEnd={endItemDrag}
                                style={{
                                    '--item-color': itemColor(item),
                                    '--checkin-item-color': itemColor(item),
                                } as CSSProperties}
                            >
                                <div className="checkin-editor-item-top">
                                    <div className="checkin-editor-item-name">
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
                                        <div className="checkin-editor-item-copy">
                                            <input
                                                aria-label={`${item.title} 标题`}
                                                value={item.title}
                                                onChange={(event) => updateItem(item.id, { title: event.target.value })}
                                            />
                                            <p>
                                                <span>{subtitle}</span>
                                            </p>
                                        </div>
                                    </div>

                                    <div className="checkin-editor-item-actions">
                                        <div className="checkin-editor-mode-row" role="group" aria-label={`${item.title} 编辑模式`}>
                                            <button
                                                type="button"
                                                className={!isCountMode ? 'active' : ''}
                                                aria-label={`${item.title} 周期`}
                                                onClick={() => setEditMode(item, 'cycle')}
                                            >
                                                周期
                                            </button>
                                            <button
                                                type="button"
                                                className={isCountMode ? 'active' : ''}
                                                aria-label={`${item.title} 次数`}
                                                onClick={() => setEditMode(item, 'count')}
                                            >
                                                次数
                                            </button>
                                        </div>
                                        <button
                                            type="button"
                                            className="checkin-editor-row-action"
                                            aria-label={`删除 ${item.title}`}
                                            onClick={() => removeItem(item.id)}
                                        >
                                            <TrashIcon />
                                        </button>
                                    </div>
                                </div>

                                {isCountMode ? (
                                    <div className="checkin-editor-count-grid checkin-editor-item-controls">
                                        <label className="checkin-editor-field">
                                            <span>每次数量</span>
                                            <input
                                                aria-label={`${item.title} 每次数量`}
                                                type="number"
                                                min={0}
                                                value={countPerUseAmount(item)}
                                                onChange={(event) => updateItem(item.id, { perUseAmount: Number(event.target.value) })}
                                            />
                                        </label>
                                        <label className="checkin-editor-field checkin-editor-unit-field">
                                            <span>单位</span>
                                            <input
                                                aria-label={`${item.title} 单位设置`}
                                                value={countPerUseUnit(item)}
                                                onChange={(event) => updateItem(item.id, { perUseUnit: event.target.value })}
                                            />
                                        </label>
                                        <div className="checkin-editor-loop-stepper" role="group" aria-label={`${item.title} 循环次数`}>
                                            <button
                                                type="button"
                                                aria-label={`减少 ${item.title} 循环次数`}
                                                onClick={() => changeLoopCount(item, -1)}
                                            >
                                                -
                                            </button>
                                            <div className="checkin-editor-loop-value">
                                                <span>循环次数</span>
                                                <strong aria-label={`${item.title} 循环次数值`}>{countLoopCount(item)} 轮</strong>
                                            </div>
                                            <button
                                                type="button"
                                                className="is-plus"
                                                aria-label={`增加 ${item.title} 循环次数`}
                                                onClick={() => changeLoopCount(item, 1)}
                                            >
                                                +
                                            </button>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="checkin-editor-repeat-controls checkin-editor-item-controls">
                                        <div className="checkin-editor-cycle-select">
                                            <span aria-hidden="true">▦</span>
                                            <strong>每日重复</strong>
                                        </div>
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
                                    </div>
                                )}
                            </article>
                        );
                    })}
                </div>
            </section>

            <footer className="checkin-editor-actions">
                <button type="button" onClick={closeWindow}>取消</button>
                <button type="button" className="checkin-editor-primary" onClick={savePlan}>保存计划</button>
            </footer>
        </div>
    );
}

function TrashIcon() {
    return (
        <svg
            aria-hidden="true"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <path d="M3 6h18" />
            <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
            <path d="M10 11v6" />
            <path d="M14 11v6" />
        </svg>
    );
}
