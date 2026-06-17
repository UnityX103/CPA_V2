import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCheckinStore, type CheckinPlanTemplate } from '../domain/checkin';
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

const baseTemplate: CheckinPlanTemplate = {
    schemaVersion: 2,
    carryToNextWeek: true,
    items: [{
        id: 'read',
        title: '阅读',
        type: 'manual',
        targetCount: 2,
        icon: 'bookOpen',
        repeatDays: ['mon', 'wed'],
        editMode: 'cycle',
        perUseAmount: 30,
        perUseUnit: '分钟',
    }],
};

function resetCheckinStore() {
    useCheckinStore.setState({
        planTemplate: structuredClone(baseTemplate),
        dailyRecords: {},
        lastError: null,
    });
}

function editorCss(): string {
    return readFileSync('src/ui/CheckinPlanEditorPanel.css', 'utf8');
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

    it('edits repeat days in a draft and saves the template', () => {
        render(<CheckinPlanEditorPanel />);

        fireEvent.click(screen.getByRole('button', { name: '阅读 周二' }));
        expect(useCheckinStore.getState().planTemplate.items[0].repeatDays).toEqual(['mon', 'wed']);

        fireEvent.click(screen.getByRole('button', { name: '保存计划' }));

        expect(useCheckinStore.getState().planTemplate.items[0].repeatDays).toEqual(['mon', 'tue', 'wed']);
        expect(invokeMock).toHaveBeenCalledWith('close_checkin_editor_window');
    });

    it('edits count metadata without changing target count', () => {
        render(<CheckinPlanEditorPanel />);

        fireEvent.click(screen.getByRole('button', { name: '阅读 次数' }));
        fireEvent.change(screen.getByLabelText('阅读 输入值'), { target: { value: '7' } });
        fireEvent.change(screen.getByLabelText('阅读 每轮次数'), { target: { value: '4' } });
        fireEvent.change(screen.getByLabelText('阅读 循环次数'), { target: { value: '3' } });
        fireEvent.click(screen.getByRole('button', { name: '保存计划' }));

        expect(useCheckinStore.getState().planTemplate.items[0]).toMatchObject({
            targetCount: 2,
            editMode: 'count',
            countInputValue: 7,
            countUnitSize: 4,
            countLoopCount: 3,
        });
    });

    it('adds an item that repeats every day by default', () => {
        render(<CheckinPlanEditorPanel />);

        fireEvent.click(screen.getByRole('button', { name: '新增项目' }));
        fireEvent.change(screen.getByLabelText('新项目 标题'), { target: { value: '喝水' } });
        fireEvent.click(screen.getByRole('button', { name: '保存计划' }));

        expect(useCheckinStore.getState().planTemplate.items[1]).toMatchObject({
            title: '喝水',
            repeatDays: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'],
            editMode: 'cycle',
        });
    });

    it('closes without saving draft changes when canceled', () => {
        render(<CheckinPlanEditorPanel />);

        fireEvent.click(screen.getByRole('button', { name: '阅读 周二' }));
        fireEvent.click(screen.getByRole('button', { name: '取消' }));

        expect(useCheckinStore.getState().planTemplate.items[0].repeatDays).toEqual(['mon', 'wed']);
        expect(invokeMock).toHaveBeenCalledWith('close_checkin_editor_window');
    });

    it('syncs the draft when the bridge snapshot updates the source template before editing', () => {
        render(<CheckinPlanEditorPanel />);

        act(() => {
            useCheckinStore.setState({
                planTemplate: {
                    schemaVersion: 2,
                    carryToNextWeek: true,
                    items: [{
                        id: 'water',
                        title: '喝水',
                        type: 'manual',
                        targetCount: 3,
                        repeatDays: ['tue'],
                        editMode: 'cycle',
                    }],
                },
            });
        });

        expect(screen.getByDisplayValue('喝水')).toBeInTheDocument();
        expect(screen.getByDisplayValue('3')).toBeInTheDocument();
    });

    it('starts native drag from the editor background but not from controls', () => {
        render(<CheckinPlanEditorPanel />);

        fireEvent.pointerDown(screen.getByTestId('checkin-plan-editor-panel'), { button: 0 });
        fireEvent.pointerDown(screen.getByRole('button', { name: '新增项目' }), { button: 0 });
        fireEvent.pointerDown(screen.getByLabelText('阅读 标题'), { button: 0 });

        expect(startDraggingMock).toHaveBeenCalledTimes(1);
    });

    it('keeps DzDyI count and cycle controls on the same shared row geometry', () => {
        const css = editorCss();

        expect(css).toMatch(/\.checkin-editor-cycle-select\s*\{[^}]*width:\s*94px;[^}]*height:\s*31px;/s);
        expect(css).toMatch(/\.checkin-editor-repeat-controls\s*\{[^}]*gap:\s*8px;/s);
        expect(css).toMatch(/\.checkin-editor-repeat-days\s*\{[^}]*grid-template-columns:\s*repeat\(7,\s*minmax\(0,\s*1fr\)\);[^}]*gap:\s*5px;/s);

        expect(css).toMatch(/\.checkin-editor-count-grid\s*\{[^}]*display:\s*flex;[^}]*align-items:\s*center;[^}]*gap:\s*6px;/s);
        expect(css).toMatch(/\.checkin-editor-count-grid\s+\.checkin-editor-field:nth-child\(1\)\s*\{[^}]*width:\s*75px;/s);
        expect(css).toMatch(/\.checkin-editor-count-grid\s+\.checkin-editor-field:nth-child\(2\)\s*\{[^}]*width:\s*96px;/s);
        expect(css).toMatch(/\.checkin-editor-count-grid\s+\.checkin-editor-field:nth-child\(3\)\s*\{[^}]*width:\s*112px;/s);
        expect(css).toMatch(/\.checkin-editor-count-grid\s+\.checkin-editor-field\s*\{[^}]*height:\s*36px;[^}]*border-radius:\s*12px;/s);
        expect(css).toMatch(/\.checkin-editor-count-grid\s+\.checkin-editor-field:last-child\s*\{[^}]*border-color:\s*#efdccd;[^}]*background:\s*#fff7f0;/s);
    });
});
