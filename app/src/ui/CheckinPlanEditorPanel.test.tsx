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
        mon: { kind: 'items', items: [{ id: 'read', title: '阅读', type: 'manual', targetCount: 2 }] },
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
        fireEvent.change(screen.getByLabelText('新栏目名称'), { target: { value: '喝水' } });
        fireEvent.click(screen.getByRole('button', { name: '取消' }));

        const monday = useCheckinStore.getState().weeklyPlan.days.mon;
        expect(monday.kind).toBe('items');
        if (monday.kind === 'items') {
            expect(monday.items).toEqual([{ id: 'read', title: '阅读', type: 'manual', targetCount: 2 }]);
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

    it('saves the carry-to-next-week toggle with the draft plan', () => {
        render(<CheckinPlanEditorPanel />);

        fireEvent.click(screen.getByRole('button', { name: '下周沿用当前计划' }));
        fireEvent.click(screen.getByRole('button', { name: '保存计划' }));

        expect(useCheckinStore.getState().weeklyPlan.carryToNextWeek).toBe(false);
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

        fireEvent.pointerDown(screen.getByLabelText('阅读 名称'), { button: 0 });
        fireEvent.pointerDown(screen.getByLabelText('阅读 类型'), { button: 0 });

        expect(startDraggingMock).not.toHaveBeenCalled();
    });
});
