import type { KeyboardEvent, PointerEvent } from 'react';
import { useState } from 'react';
import { useTodoStore, visibleTodoItems, type TodoItem } from '../domain/todo';
import { shouldStartWindowDrag } from './windowDrag';
import './TodoPanel.css';

export function TodoPanel() {
    const todo = useTodoStore();
    const items = visibleTodoItems(todo);

    const onPanelPointerDown = (e: PointerEvent<HTMLDivElement>) => {
        if (!shouldStartWindowDrag(e.button, e.target)) return;
    };

    return (
        <section
            className={`todo-panel ${todo.expanded ? 'is-expanded' : 'is-collapsed'}`}
            aria-label="TODO面板"
            data-testid="todo-panel"
            onPointerDown={onPanelPointerDown}
        >
            <TodoCurrentTask />
            {todo.expanded && (
                <>
                    <div className="todo-section-divider" aria-hidden="true" />
                    <div className="todo-list" aria-label="待办列表">
                        {items.length > 0 ? (
                            items.map((item) => <TodoItemRow key={item.id} item={item} />)
                        ) : (
                            <div className="todo-empty">暂无待办</div>
                        )}
                    </div>
                </>
            )}
            <button
                className="todo-collapse-toggle"
                type="button"
                onClick={() => todo.setExpanded(!todo.expanded)}
                aria-label={todo.expanded ? '收纳待办' : '展开待办'}
            >
                {todo.expanded ? <ChevronUpIcon /> : <ChevronDownIcon />}
                <span>{todo.expanded ? '收纳待办' : '展开待办'}</span>
            </button>
        </section>
    );
}

export function TodoCurrentTask() {
    const title = useTodoStore((s) => s.currentTaskTitle);
    const setTitle = useTodoStore((s) => s.setCurrentTaskTitle);
    const add = useTodoStore((s) => s.addCurrentTaskToTodo);

    return (
        <div className="todo-current-card" data-testid="todo-current-task">
            <label className="todo-current-label" htmlFor="todo-current-input">当前执行</label>
            <div className="todo-current-row">
                <input
                    id="todo-current-input"
                    className="todo-current-input"
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    placeholder="输入正在处理的任务..."
                    data-no-window-drag
                />
                <button
                    className="todo-add-btn"
                    type="button"
                    onClick={() => add()}
                    disabled={!title.trim()}
                    aria-label="添加到待办"
                >
                    <PlusIcon />
                    <span>添加</span>
                </button>
            </div>
        </div>
    );
}

export function TodoItemRow({ item }: { item: TodoItem }) {
    const editingItemId = useTodoStore((s) => s.editingItemId);
    const beginEdit = useTodoStore((s) => s.beginEdit);
    const finishEdit = useTodoStore((s) => s.finishEdit);
    const updateItem = useTodoStore((s) => s.updateItem);
    const toggleCompleted = useTodoStore((s) => s.toggleCompleted);
    const deleteItem = useTodoStore((s) => s.deleteItem);
    const setItemAsCurrent = useTodoStore((s) => s.setItemAsCurrent);
    const addCurrentTaskToTodo = useTodoStore((s) => s.addCurrentTaskToTodo);
    const currentTaskTitle = useTodoStore((s) => s.currentTaskTitle);
    const [pendingCurrentItemId, setPendingCurrentItemId] = useState<string | null>(null);
    const isEditing = editingItemId === item.id;
    const isCurrent = currentTaskTitle.trim() !== '' && currentTaskTitle.trim() === item.title.trim();

    const promoteItem = () => {
        const currentTitle = currentTaskTitle.trim();
        if (currentTitle && currentTitle !== item.title.trim()) {
            setPendingCurrentItemId(item.id);
            return;
        }
        setItemAsCurrent(item.id);
    };

    const confirmReplaceCurrent = (moveExistingToTodo: boolean) => {
        if (!pendingCurrentItemId) return;
        if (moveExistingToTodo) {
            addCurrentTaskToTodo();
        }
        setItemAsCurrent(pendingCurrentItemId);
        setPendingCurrentItemId(null);
    };

    const onTitleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            toggleCompleted(item.id);
        }
        if (event.key === 'F2') {
            event.preventDefault();
            beginEdit(item.id);
        }
    };

    return (
        <>
            <article
                className={`todo-item-row ${item.completed ? 'is-complete' : ''} ${isCurrent ? 'is-current' : ''} ${isEditing ? 'is-editing' : ''}`}
                data-testid="todo-item-row"
            >
                <div className="todo-item-main">
                    {isEditing ? (
                        <input
                            className="todo-title-input"
                            value={item.title}
                            onChange={(event) => updateItem(item.id, { title: event.target.value })}
                            onBlur={() => finishEdit(item.id)}
                            onKeyDown={(event) => {
                                if (event.key === 'Enter' || event.key === 'Escape') {
                                    finishEdit(item.id);
                                }
                            }}
                            aria-label="待办标题"
                            data-no-window-drag
                        />
                    ) : (
                        <button
                            className="todo-item-title"
                            type="button"
                            onClick={() => toggleCompleted(item.id)}
                            onDoubleClick={() => beginEdit(item.id)}
                            onKeyDown={onTitleKeyDown}
                            aria-label={item.completed ? `标记未完成：${item.title}` : `标记完成：${item.title}`}
                        >
                            {item.title}
                        </button>
                    )}
                    <div className="todo-row-actions">
                        <button
                            className="todo-icon-button promote"
                            type="button"
                            onClick={promoteItem}
                            aria-label={isCurrent ? '已设为当前执行' : '设为当前执行'}
                        >
                            <ArrowUpToLineIcon />
                        </button>
                        <button
                            className="todo-icon-button delete"
                            type="button"
                            onClick={() => deleteItem(item.id)}
                            aria-label="删除待办"
                        >
                            <TrashIcon />
                        </button>
                    </div>
                </div>
            </article>
            {pendingCurrentItemId === item.id && (
                <ReplaceCurrentExecutionDialog
                    onCancel={() => confirmReplaceCurrent(false)}
                    onConfirm={() => confirmReplaceCurrent(true)}
                />
            )}
        </>
    );
}

function ReplaceCurrentExecutionDialog({
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
    return <svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg>;
}

function ArrowUpToLineIcon() {
    return (
        <svg viewBox="0 0 24 24">
            <path d="M12 19V5" />
            <path d="m5 12 7-7 7 7" />
            <path d="M5 19h14" />
        </svg>
    );
}

function TrashIcon() {
    return <svg viewBox="0 0 24 24"><path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="M19 6l-1 14H6L5 6" /><path d="M10 11v6" /><path d="M14 11v6" /></svg>;
}

function ChevronUpIcon() {
    return <svg viewBox="0 0 24 24"><path d="m18 15-6-6-6 6" /></svg>;
}

function ChevronDownIcon() {
    return <svg viewBox="0 0 24 24"><path d="m6 9 6 6 6-6" /></svg>;
}
