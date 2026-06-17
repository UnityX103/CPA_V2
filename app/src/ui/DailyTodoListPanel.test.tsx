import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    DailyTodoListPanel,
    TodoItemRow,
    type TodoItem,
} from './DailyTodoListPanel';

const sampleItems: TodoItem[] = [
    { id: 'organize', title: '整理今日待办' },
    { id: 'room', title: '检查在线房间状态' },
    { id: 'review', title: '复盘昨日专注记录', done: true },
];

describe('TodoItemRow', () => {
    afterEach(() => cleanup());

    it('renders the editable J5leny row with title input and row actions', () => {
        const onMoveToTop = vi.fn();
        const onDelete = vi.fn();
        const onTitleChange = vi.fn();

        render(
            <TodoItemRow
                item={sampleItems[0]}
                mode="edit"
                onMoveToTop={onMoveToTop}
                onDelete={onDelete}
                onTitleChange={onTitleChange}
            />,
        );

        fireEvent.change(screen.getByLabelText('整理今日待办 标题'), { target: { value: '整理收件箱' } });
        fireEvent.click(screen.getByRole('button', { name: '移动 整理今日待办 到列表顶端' }));
        fireEvent.click(screen.getByRole('button', { name: '删除 整理今日待办' }));

        expect(onTitleChange).toHaveBeenCalledWith('整理收件箱');
        expect(onMoveToTop).toHaveBeenCalledTimes(1);
        expect(onDelete).toHaveBeenCalledTimes(1);
    });

    it('renders normal and done states without turning the title into an input', () => {
        const { rerender } = render(<TodoItemRow item={sampleItems[0]} />);

        expect(screen.getByText('整理今日待办')).toBeInTheDocument();
        expect(screen.queryByLabelText('整理今日待办 标题')).not.toBeInTheDocument();

        rerender(<TodoItemRow item={sampleItems[2]} />);

        expect(screen.getByTestId('todo-item-row-review')).toHaveClass('is-done');
        expect(screen.getByText('复盘昨日专注记录')).toBeInTheDocument();
    });

    it('uses move-to-top language instead of window pin language', () => {
        render(<TodoItemRow item={{ id: 'top', title: '整理今日待办', pinned: true }} />);

        expect(screen.getByRole('button', { name: '移动 整理今日待办 到列表顶端' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /置顶窗口|窗口置顶/ })).not.toBeInTheDocument();
    });
});

describe('DailyTodoListPanel', () => {
    afterEach(() => cleanup());

    it('renders EzVnr expanded state with current task input, divider, three row instances and collapse control', () => {
        render(<DailyTodoListPanel items={sampleItems} currentTask="处理 CPA_V2 UI" />);

        expect(screen.getByText('当前执行')).toBeInTheDocument();
        expect(screen.getByLabelText('当前执行任务')).toHaveValue('处理 CPA_V2 UI');
        expect(screen.getByRole('separator', { name: '待办列表分割线' })).toBeInTheDocument();
        expect(screen.getAllByTestId(/^todo-item-row-/)).toHaveLength(3);
        expect(screen.getByTestId('todo-item-row-review')).toHaveClass('is-done');
        expect(screen.getByRole('button', { name: '收纳待办' })).toBeInTheDocument();
    });

    it('renders EzVnr collapsed state with only the top input module and expand control', () => {
        render(<DailyTodoListPanel items={sampleItems} collapsed />);

        expect(screen.getByText('当前执行')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: '展开待办' })).toBeInTheDocument();
        expect(screen.queryByTestId('todo-item-row-organize')).not.toBeInTheDocument();
    });
});
