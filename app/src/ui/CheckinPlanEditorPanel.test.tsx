import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCheckinStore, type WeeklyCheckinPlan } from '../domain/checkin';
import { CheckinPlanEditorPanel } from './CheckinPlanEditorPanel';

const { invokeMock, startDraggingMock } = vi.hoisted(() => ({
    invokeMock: vi.fn(),
    startDraggingMock: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));

vi.mock('@tauri-apps/api/window', () => ({
    getCurrentWindow: () => ({
        startDragging: () => {
            startDraggingMock();
            return Promise.resolve();
        },
    }),
}));

const basePlan: WeeklyCheckinPlan = {
    weekStartDate: '2026-05-18',
    carryToNextWeek: true,
    days: {
        mon: {
            kind: 'items',
            items: [
                {
                    id: 'read',
                    title: '阅读',
                    type: 'manual',
                    targetCount: 2,
                    icon: 'bookOpen',
                    perUseAmount: 30,
                    perUseUnit: '分钟',
                },
            ],
        },
        tue: { kind: 'inherit' },
        wed: { kind: 'inherit' },
        thu: { kind: 'inherit' },
        fri: { kind: 'inherit' },
        sat: { kind: 'inherit' },
        sun: { kind: 'rest' },
    },
};

function resetCheckinStore() {
    useCheckinStore.setState({
        weeklyPlan: structuredClone(basePlan),
        dailyRecords: {},
        lastError: null,
    });
}

function setMultiItemMonday() {
    useCheckinStore.setState({
        weeklyPlan: {
            ...structuredClone(basePlan),
            days: {
                ...structuredClone(basePlan.days),
                mon: {
                    kind: 'items',
                    items: [
                        {
                            id: 'read',
                            title: '阅读',
                            type: 'manual',
                            targetCount: 2,
                            icon: 'bookOpen',
                            perUseAmount: 30,
                            perUseUnit: '分钟',
                        },
                        {
                            id: 'water',
                            title: '喝水',
                            type: 'manual',
                            targetCount: 3,
                            icon: 'droplet',
                            perUseAmount: 1,
                            perUseUnit: '杯',
                        },
                    ],
                },
            },
        },
    });
}

describe('CheckinPlanEditorPanel', () => {
    beforeEach(() => {
        invokeMock.mockReset();
        startDraggingMock.mockReset();
        invokeMock.mockResolvedValue(undefined);
        resetCheckinStore();
    });

    afterEach(() => {
        cleanup();
    });

    it('keeps edits in a local draft until saving the plan', () => {
        render(<CheckinPlanEditorPanel />);

        fireEvent.click(screen.getByRole('button', { name: '新增栏目' }));
        fireEvent.click(screen.getByRole('button', { name: /通用/ }));
        fireEvent.change(screen.getByLabelText('新栏目名称'), { target: { value: '喝水' } });

        let monday = useCheckinStore.getState().weeklyPlan.days.mon;
        expect(monday.kind).toBe('items');
        if (monday.kind === 'items') {
            expect(monday.items.some((item) => item.title === '喝水')).toBe(false);
        }

        fireEvent.click(screen.getByRole('button', { name: '保存计划' }));

        monday = useCheckinStore.getState().weeklyPlan.days.mon;
        expect(monday.kind).toBe('items');
        if (monday.kind === 'items') {
            expect(monday.items.some((item) => item.title === '喝水')).toBe(true);
        }
        expect(invokeMock).toHaveBeenCalledWith('close_checkin_editor_window');
    });

    it('closes without saving draft changes when canceled', () => {
        render(<CheckinPlanEditorPanel />);

        fireEvent.click(screen.getByRole('button', { name: '新增栏目' }));
        fireEvent.click(screen.getByRole('button', { name: /通用/ }));
        fireEvent.change(screen.getByLabelText('新栏目名称'), { target: { value: '喝水' } });
        fireEvent.click(screen.getByRole('button', { name: '取消' }));

        const monday = useCheckinStore.getState().weeklyPlan.days.mon;
        expect(monday.kind).toBe('items');
        if (monday.kind === 'items') {
            expect(monday.items).toEqual([
                expect.objectContaining({ id: 'read', title: '阅读', type: 'manual', targetCount: 2 }),
            ]);
        }
        expect(invokeMock).toHaveBeenCalledWith('close_checkin_editor_window');
    });

    it('rest toggle replaces item editor with rest state until switched off', () => {
        render(<CheckinPlanEditorPanel />);

        fireEvent.click(screen.getByRole('button', { name: '周三' }));
        fireEvent.click(screen.getByRole('switch', { name: '休息日' }));

        expect(screen.getByText('当天休息')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: '新增栏目' })).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('switch', { name: '休息日' }));

        expect(screen.queryByText('当天休息')).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: '新增栏目' })).toBeInTheDocument();
    });

    it('shows the inherited state for an inherited selected day', () => {
        render(<CheckinPlanEditorPanel initialSelectedDay="tue" />);

        expect(screen.getByText('已继承前一天计划')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: '基于前一天计划' })).toBeInTheDocument();
        expect(screen.queryByLabelText('阅读 标题')).not.toBeInTheDocument();
    });

    it('turns an empty item day into an inherited day when using the previous-day plan button', () => {
        useCheckinStore.setState({
            weeklyPlan: {
                ...structuredClone(basePlan),
                days: {
                    ...structuredClone(basePlan.days),
                    wed: { kind: 'items', items: [] },
                },
            },
        });
        render(<CheckinPlanEditorPanel initialSelectedDay="wed" />);

        fireEvent.click(screen.getByRole('button', { name: '基于前一天计划' }));
        fireEvent.click(screen.getByRole('button', { name: '保存计划' }));

        expect(useCheckinStore.getState().weeklyPlan.days.wed).toEqual({ kind: 'inherit' });
    });

    it('adding a column from an inherited day creates an independent item day', () => {
        render(<CheckinPlanEditorPanel initialSelectedDay="tue" />);

        fireEvent.click(screen.getByRole('button', { name: '新增栏目' }));
        fireEvent.click(screen.getByRole('button', { name: /通用/ }));
        fireEvent.change(screen.getByLabelText('新栏目名称'), { target: { value: '拉伸' } });
        fireEvent.click(screen.getByRole('button', { name: '保存计划' }));

        const tuesday = useCheckinStore.getState().weeklyPlan.days.tue;
        expect(tuesday.kind).toBe('items');
        if (tuesday.kind === 'items') {
            expect(tuesday.items).toEqual([
                expect.objectContaining({ title: '拉伸', type: 'manual' }),
            ]);
        }
    });

    it('saves the carry-to-next-week toggle with the draft plan', () => {
        render(<CheckinPlanEditorPanel />);

        fireEvent.click(screen.getByRole('button', { name: '下周沿用当前计划' }));
        fireEvent.click(screen.getByRole('button', { name: '保存计划' }));

        expect(useCheckinStore.getState().weeklyPlan.carryToNextWeek).toBe(false);
    });

    it('prevents adding a second pomodoro item for the selected day', () => {
        useCheckinStore.setState({
            weeklyPlan: {
                ...structuredClone(basePlan),
                days: {
                    ...structuredClone(basePlan.days),
                    mon: {
                        kind: 'items',
                        items: [
                            {
                                id: 'focus',
                                title: '专注番茄',
                                type: 'pomodoroFocus',
                                targetCount: 4,
                                icon: 'clock',
                                perUseAmount: 25,
                                perUseUnit: '分钟',
                            },
                            {
                                id: 'read',
                                title: '阅读',
                                type: 'manual',
                                targetCount: 2,
                                icon: 'bookOpen',
                                perUseAmount: 30,
                                perUseUnit: '分钟',
                            },
                        ],
                    },
                },
            },
        });
        render(<CheckinPlanEditorPanel />);

        fireEvent.click(screen.getByRole('button', { name: '新增栏目' }));

        expect(screen.getByRole('button', { name: /番茄钟/ })).toBeDisabled();
    });

    it('edits an item icon through the row icon picker', () => {
        render(<CheckinPlanEditorPanel />);

        fireEvent.click(screen.getByRole('button', { name: '更换 阅读 图标' }));
        fireEvent.click(screen.getByRole('menuitem', { name: '咖啡' }));
        fireEvent.click(screen.getByRole('button', { name: '保存计划' }));

        const monday = useCheckinStore.getState().weeklyPlan.days.mon;
        expect(monday.kind).toBe('items');
        if (monday.kind === 'items') {
            expect(monday.items[0].icon).toBe('coffee');
        }
    });

    it('edits the per-use metric represented by Pencil node YVc3O', () => {
        render(<CheckinPlanEditorPanel />);

        fireEvent.change(screen.getByLabelText('阅读 每次数量'), { target: { value: '45' } });
        fireEvent.change(screen.getByLabelText('阅读 每次单位'), { target: { value: '页' } });
        fireEvent.click(screen.getByRole('button', { name: '保存计划' }));

        const monday = useCheckinStore.getState().weeklyPlan.days.mon;
        expect(monday.kind).toBe('items');
        if (monday.kind === 'items') {
            expect(monday.items[0]).toMatchObject({
                perUseAmount: 45,
                perUseUnit: '页',
            });
        }
    });

    it('keeps row edits in the draft until save and discards them on cancel', () => {
        render(<CheckinPlanEditorPanel />);

        fireEvent.change(screen.getByLabelText('阅读 标题'), { target: { value: '深度阅读' } });
        fireEvent.change(screen.getByLabelText('深度阅读 每日目标'), { target: { value: '5' } });

        const beforeCancel = useCheckinStore.getState().weeklyPlan.days.mon;
        expect(beforeCancel.kind).toBe('items');
        if (beforeCancel.kind === 'items') {
            expect(beforeCancel.items[0]).toMatchObject({ title: '阅读', targetCount: 2 });
        }

        fireEvent.click(screen.getByRole('button', { name: '取消' }));

        const afterCancel = useCheckinStore.getState().weeklyPlan.days.mon;
        expect(afterCancel.kind).toBe('items');
        if (afterCancel.kind === 'items') {
            expect(afterCancel.items[0]).toMatchObject({ title: '阅读', targetCount: 2 });
        }
    });

    it('syncs the draft when the bridge snapshot updates the source plan before editing', () => {
        render(<CheckinPlanEditorPanel />);

        act(() => {
            useCheckinStore.setState({
                weeklyPlan: {
                    ...structuredClone(basePlan),
                    days: {
                        ...structuredClone(basePlan.days),
                        mon: {
                            kind: 'items',
                            items: [{ id: 'water', title: '喝水', type: 'manual', targetCount: 3 }],
                        },
                    },
                },
            });
        });

        expect(screen.getByDisplayValue('喝水')).toBeInTheDocument();
        expect(screen.getByDisplayValue('3')).toBeInTheDocument();
    });

    it('deletes rows from the right-side grip menu', () => {
        setMultiItemMonday();
        render(<CheckinPlanEditorPanel />);

        fireEvent.click(screen.getByRole('button', { name: '打开 阅读 操作菜单' }));
        expect(screen.getByRole('menuitem', { name: '删除栏目' })).toBeInTheDocument();
        expect(screen.getByRole('menuitem', { name: '上移' })).toBeInTheDocument();
        expect(screen.getByRole('menuitem', { name: '下移' })).toBeInTheDocument();

        let monday = useCheckinStore.getState().weeklyPlan.days.mon;
        expect(monday.kind).toBe('items');
        if (monday.kind === 'items') {
            expect(monday.items.map((item) => item.id)).toEqual(['read', 'water']);
        }

        fireEvent.click(screen.getByRole('menuitem', { name: '删除栏目' }));
        fireEvent.click(screen.getByRole('button', { name: '保存计划' }));

        monday = useCheckinStore.getState().weeklyPlan.days.mon;
        expect(monday.kind).toBe('items');
        if (monday.kind === 'items') {
            expect(monday.items.map((item) => item.id)).toEqual(['water']);
        }
    });

    it('does not open row actions from the row context menu', () => {
        setMultiItemMonday();
        render(<CheckinPlanEditorPanel />);

        fireEvent.contextMenu(screen.getByTestId('checkin-item-row-read'));

        expect(screen.queryByRole('menuitem', { name: '删除栏目' })).not.toBeInTheDocument();
        expect(screen.queryByRole('menuitem', { name: '上移' })).not.toBeInTheDocument();
        expect(screen.queryByRole('menuitem', { name: '下移' })).not.toBeInTheDocument();
    });

    it('uses the right-side grip to reorder rows instead of deleting them', () => {
        setMultiItemMonday();
        render(<CheckinPlanEditorPanel />);

        fireEvent.click(screen.getByRole('button', { name: '打开 喝水 操作菜单' }));
        fireEvent.click(screen.getByRole('menuitem', { name: '上移' }));
        fireEvent.click(screen.getByRole('button', { name: '保存计划' }));

        const monday = useCheckinStore.getState().weeklyPlan.days.mon;
        expect(monday.kind).toBe('items');
        if (monday.kind === 'items') {
            expect(monday.items.map((item) => item.id)).toEqual(['water', 'read']);
        }
    });

    it('closes row menus when switching days', () => {
        setMultiItemMonday();
        render(<CheckinPlanEditorPanel />);

        fireEvent.click(screen.getByRole('button', { name: '打开 阅读 操作菜单' }));
        expect(screen.getByRole('menuitem', { name: '删除栏目' })).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: '周二' }));

        expect(screen.queryByRole('menuitem', { name: '删除栏目' })).not.toBeInTheDocument();
    });

    it('starts native drag from the editor background', () => {
        render(<CheckinPlanEditorPanel />);

        fireEvent.pointerDown(screen.getByTestId('checkin-plan-editor-panel'), { button: 0 });

        expect(startDraggingMock).toHaveBeenCalledTimes(1);
    });

    it('does not start native drag from non-primary pointer buttons', () => {
        render(<CheckinPlanEditorPanel />);

        fireEvent.pointerDown(screen.getByTestId('checkin-plan-editor-panel'), { button: 2 });

        expect(startDraggingMock).not.toHaveBeenCalled();
    });

    it('does not start native drag from editor buttons', () => {
        render(<CheckinPlanEditorPanel />);

        fireEvent.pointerDown(screen.getByRole('button', { name: '新增栏目' }), { button: 0 });

        expect(startDraggingMock).not.toHaveBeenCalled();
    });

    it('does not start native drag from editor inputs or selects', () => {
        render(<CheckinPlanEditorPanel />);

        fireEvent.pointerDown(screen.getByLabelText('阅读 标题'), { button: 0 });
        fireEvent.pointerDown(screen.getByLabelText('阅读 每日目标'), { button: 0 });

        expect(startDraggingMock).not.toHaveBeenCalled();
    });
});
