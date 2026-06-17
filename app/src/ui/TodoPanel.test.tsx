import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useTodoStore } from '../domain/todo';
import { TodoPanel } from './TodoPanel';

beforeEach(() => {
    useTodoStore.getState().hydrateTodo({
        currentTaskTitle: '',
        activeFilter: 'today',
        expanded: true,
        items: [],
    });
});

afterEach(() => {
    cleanup();
});

describe('TodoPanel', () => {
    it('renders the expanded panel and adds the current task as a row', () => {
        render(<TodoPanel />);

        expect(screen.getByTestId('todo-panel')).toHaveClass('is-expanded');
        fireEvent.change(screen.getByLabelText('当前执行'), {
            target: { value: '整理今日待办' },
        });
        fireEvent.click(screen.getByRole('button', { name: '添加到待办' }));

        expect(screen.getByText('整理今日待办')).toBeInTheDocument();
        expect(useTodoStore.getState().currentTaskTitle).toBe('');
        expect(useTodoStore.getState().items[0].title).toBe('整理今日待办');
    });

    it('completes, edits, promotes, and deletes a todo row', () => {
        useTodoStore.getState().hydrateTodo({
            items: [item('todo-1', '整理今日待办')],
        });
        render(<TodoPanel />);

        fireEvent.click(screen.getByRole('button', { name: '标记完成：整理今日待办' }));
        expect(useTodoStore.getState().items[0].completed).toBe(true);
        expect(screen.getByRole('button', { name: '标记未完成：整理今日待办' })).toBeInTheDocument();

        fireEvent.keyDown(screen.getByRole('button', { name: '标记未完成：整理今日待办' }), { key: 'F2' });
        fireEvent.change(screen.getByLabelText('待办标题'), {
            target: { value: '检查在线房间状态' },
        });
        fireEvent.keyDown(screen.getByLabelText('待办标题'), { key: 'Enter' });
        expect(screen.getByText('检查在线房间状态')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: '设为当前执行' }));
        expect(useTodoStore.getState().currentTaskTitle).toBe('检查在线房间状态');
        expect(screen.getByRole('button', { name: '已设为当前执行' })).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: '删除待办' }));
        expect(useTodoStore.getState().items).toEqual([]);
        expect(screen.getByText('暂无待办')).toBeInTheDocument();
    });

    it('asks before replacing an existing current task and can archive the old current task', () => {
        useTodoStore.getState().hydrateTodo({
            currentTaskTitle: '正在写测试',
            items: [item('todo-1', '整理今日待办')],
        });
        render(<TodoPanel />);

        fireEvent.click(screen.getByRole('button', { name: '设为当前执行' }));
        expect(screen.getByRole('dialog', { name: '替换当前执行？' })).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: '是，转为待办' }));

        const state = useTodoStore.getState();
        expect(state.currentTaskTitle).toBe('整理今日待办');
        expect(state.items.map((todo) => todo.title)).toEqual(['正在写测试', '整理今日待办']);
    });

    it('can directly overwrite the existing current task from the replacement dialog', () => {
        useTodoStore.getState().hydrateTodo({
            currentTaskTitle: '正在写测试',
            items: [item('todo-1', '整理今日待办')],
        });
        render(<TodoPanel />);

        fireEvent.click(screen.getByRole('button', { name: '设为当前执行' }));
        fireEvent.click(screen.getByRole('button', { name: '否，直接覆盖' }));

        const state = useTodoStore.getState();
        expect(state.currentTaskTitle).toBe('整理今日待办');
        expect(state.items.map((todo) => todo.title)).toEqual(['整理今日待办']);
    });

    it('renders the collapsed state without the todo list', () => {
        useTodoStore.getState().hydrateTodo({
            items: [item('today', '今日事项')],
        });
        render(<TodoPanel />);

        expect(screen.getByText('今日事项')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: '收纳待办' }));
        expect(screen.getByTestId('todo-panel')).toHaveClass('is-collapsed');
        expect(screen.queryByText('今日事项')).toBeNull();
        expect(screen.getByRole('button', { name: '展开待办' })).toBeInTheDocument();
    });
});

function item(id: string, title: string) {
    return {
        id,
        title,
        filter: 'today' as const,
        completed: false,
        startTime: '',
        endTime: '',
        createdAt: 1,
        updatedAt: 1,
        completedAt: null,
    };
}
