import type { PointerEvent } from 'react';
import { useTodoStore, visibleTodoItems, type TodoFilter, type TodoItem } from '../domain/todo';
import { shouldStartWindowDrag } from './windowDrag';
import './TodoPanel.css';

const FILTERS: Array<{ id: TodoFilter; label: string }> = [
    { id: 'today', label: '今日待办' },
    { id: 'week', label: '本周任务' },
    { id: 'other', label: '其他' },
];

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
                    <TodoFilterTabs activeFilter={todo.activeFilter} />
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

function TodoFilterTabs({ activeFilter }: { activeFilter: TodoFilter }) {
    const setActiveFilter = useTodoStore((s) => s.setActiveFilter);
    return (
        <div className="todo-filter-tabs" role="tablist" aria-label="待办筛选">
            {FILTERS.map((filter) => (
                <button
                    key={filter.id}
                    className={`todo-filter-tab ${activeFilter === filter.id ? 'active' : ''}`}
                    role="tab"
                    aria-selected={activeFilter === filter.id}
                    type="button"
                    onClick={() => setActiveFilter(filter.id)}
                >
                    {filter.label}
                </button>
            ))}
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
    const isEditing = editingItemId === item.id;

    const onEdit = () => {
        if (isEditing) {
            finishEdit(item.id);
        } else {
            beginEdit(item.id);
        }
    };

    return (
        <article
            className={`todo-item-row ${item.completed ? 'is-complete' : ''} ${isEditing ? 'is-editing' : ''}`}
            data-testid="todo-item-row"
        >
            <div className="todo-item-main">
                <button
                    className="todo-complete-toggle"
                    type="button"
                    onClick={() => toggleCompleted(item.id)}
                    aria-label={item.completed ? '标记未完成' : '标记完成'}
                >
                    {item.completed && <CheckIcon />}
                </button>
                <div className="todo-item-text">
                    {isEditing ? (
                        <input
                            className="todo-title-input"
                            value={item.title}
                            onChange={(event) => updateItem(item.id, { title: event.target.value })}
                            aria-label="待办标题"
                            data-no-window-drag
                        />
                    ) : (
                        <div className="todo-item-title">{item.title}</div>
                    )}
                    {!isEditing && (
                        <div className="todo-item-time">
                            {item.completed ? <CircleCheckIcon /> : <ClockIcon />}
                            <span>{timeLabel(item)}</span>
                        </div>
                    )}
                </div>
                <div className="todo-row-actions">
                    <button
                        className="todo-icon-button edit"
                        type="button"
                        onClick={onEdit}
                        aria-label={isEditing ? '保存待办' : '编辑待办'}
                    >
                        <PencilIcon />
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
            {isEditing && (
                <div className="todo-item-editor">
                    <div className="todo-time-row">
                        <span className="todo-time-label">
                            <ClockIcon />
                            待办时间
                        </span>
                        <div className="todo-time-inputs">
                            <input
                                className="todo-time-input"
                                value={item.startTime}
                                onChange={(event) => updateItem(item.id, { startTime: event.target.value })}
                                placeholder="09:30"
                                aria-label="开始时间"
                                data-no-window-drag
                            />
                            <span className="todo-time-sep">-</span>
                            <input
                                className="todo-time-input"
                                value={item.endTime}
                                onChange={(event) => updateItem(item.id, { endTime: event.target.value })}
                                placeholder="10:00"
                                aria-label="结束时间"
                                data-no-window-drag
                            />
                        </div>
                    </div>
                    <div className="todo-set-current-row">
                        <button
                            className="todo-set-current-btn"
                            type="button"
                            onClick={() => setItemAsCurrent(item.id)}
                        >
                            设为当前执行
                        </button>
                    </div>
                </div>
            )}
        </article>
    );
}

function timeLabel(item: TodoItem): string {
    const range = item.startTime && item.endTime
        ? `${item.startTime} - ${item.endTime}`
        : item.startTime || item.endTime || '未设置时间';
    return item.completed ? `已完成 · ${range}` : range;
}

function PlusIcon() {
    return <svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg>;
}

function PencilIcon() {
    return <svg viewBox="0 0 24 24"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>;
}

function TrashIcon() {
    return <svg viewBox="0 0 24 24"><path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="M19 6l-1 14H6L5 6" /><path d="M10 11v6" /><path d="M14 11v6" /></svg>;
}

function ClockIcon() {
    return <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>;
}

function CheckIcon() {
    return <svg viewBox="0 0 24 24"><path d="m5 12 5 5L20 7" /></svg>;
}

function CircleCheckIcon() {
    return <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="m8 12 3 3 5-6" /></svg>;
}

function ChevronUpIcon() {
    return <svg viewBox="0 0 24 24"><path d="m18 15-6-6-6 6" /></svg>;
}

function ChevronDownIcon() {
    return <svg viewBox="0 0 24 24"><path d="m6 9 6 6 6-6" /></svg>;
}
