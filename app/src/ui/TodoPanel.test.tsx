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

    it('completes, edits, sets current, and deletes a todo row', () => {
        useTodoStore.getState().hydrateTodo({
            items: [{
                id: 'todo-1',
                title: '整理今日待办',
                completed: false,
                filter: 'today',
                startTime: '09:30',
                endTime: '10:00',
                createdAt: 1,
                updatedAt: 1,
                completedAt: null,
            }],
        });
        render(<TodoPanel />);

        fireEvent.click(screen.getByRole('button', { name: '标记完成' }));
        expect(useTodoStore.getState().items[0].completed).toBe(true);
        expect(screen.getByText('已完成 · 09:30 - 10:00')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: '编辑待办' }));
        fireEvent.change(screen.getByLabelText('待办标题'), {
            target: { value: '检查在线房间状态' },
        });
        fireEvent.change(screen.getByLabelText('开始时间'), {
            target: { value: '10:30' },
        });
        fireEvent.change(screen.getByLabelText('结束时间'), {
            target: { value: '11:00' },
        });
        fireEvent.click(screen.getByRole('button', { name: '设为当前执行' }));
        expect(useTodoStore.getState().currentTaskTitle).toBe('检查在线房间状态');

        fireEvent.click(screen.getByRole('button', { name: '保存待办' }));
        expect(screen.getByText('检查在线房间状态')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: '删除待办' }));
        expect(useTodoStore.getState().items).toEqual([]);
        expect(screen.getByText('暂无待办')).toBeInTheDocument();
    });

    it('switches filters and renders the collapsed state', () => {
        useTodoStore.getState().hydrateTodo({
            activeFilter: 'today',
            items: [
                item('today', '今日事项', 'today'),
                item('week', '本周事项', 'week'),
            ],
        });
        render(<TodoPanel />);

        expect(screen.getByText('今日事项')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('tab', { name: '本周任务' }));
        expect(screen.getByText('本周事项')).toBeInTheDocument();
        expect(screen.queryByText('今日事项')).toBeNull();

        fireEvent.click(screen.getByRole('button', { name: '收纳待办' }));
        expect(screen.getByTestId('todo-panel')).toHaveClass('is-collapsed');
        expect(screen.queryByText('本周事项')).toBeNull();
        expect(screen.getByRole('button', { name: '展开待办' })).toBeInTheDocument();
    });
});

function item(id: string, title: string, filter: 'today' | 'week' | 'other') {
    return {
        id,
        title,
        filter,
        completed: false,
        startTime: '',
        endTime: '',
        createdAt: 1,
        updatedAt: 1,
        completedAt: null,
    };
}
