import type { PointerEvent } from 'react';
import './DailyTodoListPanel.css';

export interface DailyTodoItem {
    id: string;
    title: string;
    done?: boolean;
    pinned?: boolean;
}

interface TodoItemRowProps {
    item: DailyTodoItem;
    mode?: 'view' | 'edit';
    onTitleChange?: (title: string) => void;
    onFinishEdit?: () => void;
    onBeginEdit?: () => void;
    onToggleDone?: () => void;
    onMoveToTop?: () => void;
    onDelete?: () => void;
}

interface DailyTodoListPanelProps {
    items?: DailyTodoItem[];
    currentTask?: string;
    collapsed?: boolean;
    editingItemId?: string | null;
    onPanelPointerDown?: (event: PointerEvent<HTMLDivElement>) => void;
    onCurrentTaskChange?: (task: string) => void;
    onAddCurrentTask?: () => void;
    onToggleCollapsed?: () => void;
    onToggleItemDone?: (id: string) => void;
    onBeginItemEdit?: (id: string) => void;
    onFinishItemEdit?: (id: string) => void;
    onMoveItemToTop?: (id: string) => void;
    onDeleteItem?: (id: string) => void;
    onItemTitleChange?: (id: string, title: string) => void;
}

const DEFAULT_TODO_ITEMS: DailyTodoItem[] = [
    { id: 'organize', title: '整理今日待办' },
    { id: 'room', title: '检查在线房间状态' },
    { id: 'review', title: '复盘昨日专注记录', done: true },
];

export function TodoItemRow({
    item,
    mode = 'view',
    onTitleChange,
    onFinishEdit,
    onBeginEdit,
    onToggleDone,
    onMoveToTop,
    onDelete,
}: TodoItemRowProps) {
    const moveLabel = item.pinned ? '已设为当前执行' : '设为当前执行';
    const deleteLabel = `删除 ${item.title}`;
    const doneLabel = item.done ? `标记未完成：${item.title}` : `标记完成：${item.title}`;

    return (
        <article
            className={`todo-item-row ${item.done ? 'is-done' : ''} ${item.pinned ? 'is-pinned' : ''} ${mode === 'edit' ? 'is-editing' : ''}`}
            data-testid={`todo-item-row-${item.id}`}
        >
            <div className="todo-item-row-top">
                {mode === 'edit' ? (
                    <input
                        className="todo-item-title-input"
                        aria-label="待办标题"
                        value={item.title}
                        onChange={(event) => onTitleChange?.(event.target.value)}
                        onBlur={onFinishEdit}
                        onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === 'Escape') {
                                onFinishEdit?.();
                            }
                        }}
                    />
                ) : (
                    <button
                        type="button"
                        className="todo-item-title"
                        aria-label={doneLabel}
                        onClick={onToggleDone}
                        onDoubleClick={onBeginEdit}
                        onKeyDown={(event) => {
                            if (event.key === 'F2') {
                                event.preventDefault();
                                onBeginEdit?.();
                            }
                        }}
                    >
                        {item.title}
                    </button>
                )}

                <div className="todo-item-actions">
                    <button
                        type="button"
                        className="todo-item-icon-button todo-item-move-button"
                        aria-label={moveLabel}
                        onClick={onMoveToTop}
                    >
                        <ArrowUpToLineIcon />
                    </button>
                    <button
                        type="button"
                        className="todo-item-icon-button todo-item-delete-button"
                        aria-label={deleteLabel}
                        onClick={onDelete}
                    >
                        <TrashIcon />
                    </button>
                </div>
            </div>
        </article>
    );
}

export function DailyTodoListPanel({
    items = DEFAULT_TODO_ITEMS,
    currentTask = '',
    collapsed = false,
    editingItemId = null,
    onPanelPointerDown,
    onCurrentTaskChange,
    onAddCurrentTask,
    onToggleCollapsed,
    onToggleItemDone,
    onBeginItemEdit,
    onFinishItemEdit,
    onMoveItemToTop,
    onDeleteItem,
    onItemTitleChange,
}: DailyTodoListPanelProps) {
    return (
        <section
            className={`daily-todo-panel ${collapsed ? 'is-collapsed' : 'is-expanded'}`}
            aria-label="TODO面板"
            data-testid="todo-panel"
            onPointerDown={onPanelPointerDown}
        >
            <div className="daily-todo-current-module">
                <div className="daily-todo-module-head">
                    <span>当前执行</span>
                </div>
                <div className="daily-todo-input-row">
                    <input
                        aria-label="当前执行任务"
                        value={currentTask}
                        placeholder="输入正在处理的任务..."
                        onChange={(event) => onCurrentTaskChange?.(event.target.value)}
                    />
                    <button
                        type="button"
                        className="daily-todo-add-button"
                        onClick={onAddCurrentTask}
                        disabled={!currentTask.trim()}
                        aria-label="添加到待办"
                    >
                        <PlusIcon />
                        添加
                    </button>
                </div>
            </div>

            {collapsed ? (
                <button
                    type="button"
                    className="daily-todo-toggle"
                    aria-label="展开待办"
                    onClick={onToggleCollapsed}
                >
                    <ChevronDownIcon />
                    展开待办
                </button>
            ) : (
                <>
                    <div className="daily-todo-divider" role="separator" aria-label="待办列表分割线" />
                    <div className="daily-todo-list" aria-label="待办列表">
                        {items.length > 0 ? (
                            items.map((item) => (
                                <TodoItemRow
                                    key={item.id}
                                    item={item}
                                    mode={editingItemId === item.id ? 'edit' : 'view'}
                                    onToggleDone={() => onToggleItemDone?.(item.id)}
                                    onBeginEdit={() => onBeginItemEdit?.(item.id)}
                                    onFinishEdit={() => onFinishItemEdit?.(item.id)}
                                    onMoveToTop={() => onMoveItemToTop?.(item.id)}
                                    onDelete={() => onDeleteItem?.(item.id)}
                                    onTitleChange={(title) => onItemTitleChange?.(item.id, title)}
                                />
                            ))
                        ) : (
                            <div className="daily-todo-empty">暂无待办</div>
                        )}
                    </div>
                    <button
                        type="button"
                        className="daily-todo-toggle"
                        aria-label="收纳待办"
                        onClick={onToggleCollapsed}
                    >
                        <ChevronUpIcon />
                        收纳待办
                    </button>
                </>
            )}
        </section>
    );
}

export function ReplaceCurrentExecutionDialog({
    onCancel,
    onConfirm,
}: {
    onCancel: () => void;
    onConfirm: () => void;
}) {
    return (
        <div className="todo-dialog-backdrop" role="presentation">
            <section className="todo-replace-dialog" role="dialog" aria-modal="true" aria-labelledby="todo-replace-title">
                <div className="todo-dialog-title-wrap">
                    <h2 id="todo-replace-title">替换当前执行？</h2>
                    <p>已有当前执行内容</p>
                </div>
                <p className="todo-dialog-body">
                    是否将原有“当前执行”转为新的待办后，再将所选内容设置为当前执行？
                </p>
                <div className="todo-dialog-actions">
                    <button className="todo-dialog-button secondary" type="button" onClick={onCancel}>
                        否，直接覆盖
                    </button>
                    <button className="todo-dialog-button primary" type="button" onClick={onConfirm}>
                        是，转为待办
                    </button>
                </div>
            </section>
        </div>
    );
}

function PlusIcon() {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>;
}

function ArrowUpToLineIcon() {
    return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 19V5" />
            <path d="m5 12 7-7 7 7" />
            <path d="M5 19h14" />
        </svg>
    );
}

function TrashIcon() {
    return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M3 6h18" />
            <path d="M8 6V4h8v2" />
            <path d="M19 6l-1 14H6L5 6" />
            <path d="M10 11v6" />
            <path d="M14 11v6" />
        </svg>
    );
}

function ChevronUpIcon() {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m18 15-6-6-6 6" /></svg>;
}

function ChevronDownIcon() {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>;
}
