import type { PointerEvent } from 'react';
import { useState } from 'react';
import { useTodoStore, visibleTodoItems } from '../domain/todo';
import {
    DailyTodoListPanel,
    ReplaceCurrentExecutionDialog,
    type DailyTodoItem,
} from './DailyTodoListPanel';
import { shouldStartWindowDrag } from './windowDrag';

export function TodoPanel() {
    const todo = useTodoStore();
    const items = visibleTodoItems(todo);
    const [pendingCurrentItemId, setPendingCurrentItemId] = useState<string | null>(null);

    const dailyItems: DailyTodoItem[] = items.map((item) => ({
        id: item.id,
        title: item.title,
        done: item.completed,
        pinned: todo.currentTaskTitle.trim() !== '' && todo.currentTaskTitle.trim() === item.title.trim(),
    }));

    const onPanelPointerDown = (e: PointerEvent<HTMLDivElement>) => {
        if (!shouldStartWindowDrag(e.button, e.target)) return;
    };

    const setItemAsCurrent = (id: string) => {
        const item = todo.items.find((candidate) => candidate.id === id);
        if (!item) return;
        const currentTitle = todo.currentTaskTitle.trim();
        if (currentTitle && currentTitle !== item.title.trim()) {
            setPendingCurrentItemId(id);
            return;
        }
        todo.setItemAsCurrent(id);
    };

    const confirmReplaceCurrent = (moveExistingToTodo: boolean) => {
        if (!pendingCurrentItemId) return;
        if (moveExistingToTodo) {
            todo.addCurrentTaskToTodo();
        }
        todo.setItemAsCurrent(pendingCurrentItemId);
        setPendingCurrentItemId(null);
    };

    return (
        <>
            <DailyTodoListPanel
                items={dailyItems}
                currentTask={todo.currentTaskTitle}
                collapsed={!todo.expanded}
                editingItemId={todo.editingItemId}
                onPanelPointerDown={onPanelPointerDown}
                onCurrentTaskChange={todo.setCurrentTaskTitle}
                onAddCurrentTask={todo.addCurrentTaskToTodo}
                onToggleCollapsed={() => todo.setExpanded(!todo.expanded)}
                onToggleItemDone={todo.toggleCompleted}
                onBeginItemEdit={todo.beginEdit}
                onFinishItemEdit={todo.finishEdit}
                onMoveItemToTop={setItemAsCurrent}
                onDeleteItem={todo.deleteItem}
                onItemTitleChange={(id, title) => todo.updateItem(id, { title })}
            />
            {pendingCurrentItemId && (
                <ReplaceCurrentExecutionDialog
                    onCancel={() => confirmReplaceCurrent(false)}
                    onConfirm={() => confirmReplaceCurrent(true)}
                />
            )}
        </>
    );
}
