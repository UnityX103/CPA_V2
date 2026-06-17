import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTodoStore, visibleTodoItems } from './todo';

describe('todo store', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-06-17T09:30:00Z'));
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('adds the current task to the active filter and clears the input', () => {
        const store = createTodoStore();
        store.getState().setCurrentTaskTitle('  整理今日待办  ');
        store.getState().setActiveFilter('week');

        const item = store.getState().addCurrentTaskToTodo();

        expect(item).toEqual(expect.objectContaining({
            title: '整理今日待办',
            filter: 'week',
            completed: false,
            completedAt: null,
        }));
        expect(store.getState().currentTaskTitle).toBe('');
        expect(store.getState().items[0]).toEqual(item);
    });

    it('ignores blank current tasks', () => {
        const store = createTodoStore();
        store.getState().setCurrentTaskTitle('   ');

        expect(store.getState().addCurrentTaskToTodo()).toBeNull();
        expect(store.getState().items).toEqual([]);
    });

    it('completes, edits, deletes, and promotes history items', () => {
        const store = createTodoStore();
        store.getState().setCurrentTaskTitle('整理今日待办');
        const item = store.getState().addCurrentTaskToTodo()!;

        store.getState().toggleCompleted(item.id);
        expect(store.getState().items[0].completed).toBe(true);
        expect(store.getState().items[0].completedAt).toBeTypeOf('number');

        store.getState().beginEdit(item.id);
        expect(store.getState().editingItemId).toBe(item.id);
        store.getState().updateItem(item.id, { title: '检查在线房间状态', startTime: '10:30', endTime: '11:00' });
        store.getState().finishEdit(item.id);
        expect(store.getState().editingItemId).toBe(null);
        expect(store.getState().items[0]).toEqual(expect.objectContaining({
            title: '检查在线房间状态',
            startTime: '10:30',
            endTime: '11:00',
        }));

        store.getState().setItemAsCurrent(item.id);
        expect(store.getState().currentTaskTitle).toBe('检查在线房间状态');

        store.getState().deleteItem(item.id);
        expect(store.getState().items).toEqual([]);
    });

    it('filters visible items by active filter', () => {
        const store = createTodoStore();
        store.getState().hydrateTodo({
            activeFilter: 'other',
            items: [
                item('a', 'today'),
                item('b', 'week'),
                item('c', 'other'),
            ],
        });

        expect(visibleTodoItems(store.getState()).map((todo) => todo.id)).toEqual(['c']);
    });
});

function item(id: string, filter: 'today' | 'week' | 'other') {
    return {
        id,
        filter,
        title: id,
        completed: false,
        startTime: '',
        endTime: '',
        createdAt: 1,
        updatedAt: 1,
        completedAt: null,
    };
}
