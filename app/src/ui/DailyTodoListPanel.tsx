import './DailyTodoListPanel.css';

export interface TodoItem {
    id: string;
    title: string;
    done?: boolean;
    pinned?: boolean;
}

interface TodoItemRowProps {
    item: TodoItem;
    mode?: 'view' | 'edit';
    onTitleChange?: (title: string) => void;
    onMoveToTop?: () => void;
    onDelete?: () => void;
}

interface DailyTodoListPanelProps {
    items?: TodoItem[];
    currentTask?: string;
    collapsed?: boolean;
    onCurrentTaskChange?: (task: string) => void;
    onAddCurrentTask?: () => void;
    onToggleCollapsed?: () => void;
    onMoveItemToTop?: (id: string) => void;
    onDeleteItem?: (id: string) => void;
    onItemTitleChange?: (id: string, title: string) => void;
}

const DEFAULT_TODO_ITEMS: TodoItem[] = [
    { id: 'organize', title: '整理今日待办' },
    { id: 'room', title: '检查在线房间状态' },
    { id: 'review', title: '复盘昨日专注记录', done: true },
];

export function TodoItemRow({
    item,
    mode = 'view',
    onTitleChange,
    onMoveToTop,
    onDelete,
}: TodoItemRowProps) {
    const titleLabel = `${item.title} 标题`;
    const moveLabel = `移动 ${item.title} 到列表顶端`;
    const deleteLabel = `删除 ${item.title}`;

    return (
        <article
            className={`todo-item-row ${item.done ? 'is-done' : ''} ${item.pinned ? 'is-pinned' : ''} ${mode === 'edit' ? 'is-editing' : ''}`}
            data-testid={`todo-item-row-${item.id}`}
        >
            <div className="todo-item-row-top">
                {mode === 'edit' ? (
                    <input
                        className="todo-item-title-input"
                        aria-label={titleLabel}
                        value={item.title}
                        onChange={(event) => onTitleChange?.(event.target.value)}
                    />
                ) : (
                    <span className="todo-item-title">{item.title}</span>
                )}

                <div className="todo-item-actions">
                    <button
                        type="button"
                        className="todo-item-icon-button todo-item-move-button"
                        aria-label={moveLabel}
                        onClick={onMoveToTop}
                    >
                        <span aria-hidden="true">↟</span>
                    </button>
                    <button
                        type="button"
                        className="todo-item-icon-button todo-item-delete-button"
                        aria-label={deleteLabel}
                        onClick={onDelete}
                    >
                        <span aria-hidden="true">⌫</span>
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
    onCurrentTaskChange,
    onAddCurrentTask,
    onToggleCollapsed,
    onMoveItemToTop,
    onDeleteItem,
    onItemTitleChange,
}: DailyTodoListPanelProps) {
    return (
        <section className={`daily-todo-panel ${collapsed ? 'is-collapsed' : 'is-expanded'}`} aria-label="每日待办列表">
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
                    <button type="button" className="daily-todo-add-button" onClick={onAddCurrentTask}>
                        <span aria-hidden="true">+</span>
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
                    <span aria-hidden="true">⌄</span>
                    展开待办
                </button>
            ) : (
                <>
                    <div className="daily-todo-divider" role="separator" aria-label="待办列表分割线" />
                    <div className="daily-todo-list">
                        {items.map((item) => (
                            <TodoItemRow
                                key={item.id}
                                item={item}
                                onMoveToTop={() => onMoveItemToTop?.(item.id)}
                                onDelete={() => onDeleteItem?.(item.id)}
                                onTitleChange={(title) => onItemTitleChange?.(item.id, title)}
                            />
                        ))}
                    </div>
                    <button
                        type="button"
                        className="daily-todo-toggle"
                        aria-label="收纳待办"
                        onClick={onToggleCollapsed}
                    >
                        <span aria-hidden="true">⌃</span>
                        收纳待办
                    </button>
                </>
            )}
        </section>
    );
}
