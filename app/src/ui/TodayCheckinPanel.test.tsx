import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCheckinStore } from '../domain/checkin';
import { openCheckinEditorWindow } from '../domain/checkinWindow';
import { TodayCheckinPanel } from './TodayCheckinPanel';

vi.mock('../domain/checkinWindow', () => ({
    openCheckinEditorWindow: vi.fn(() => Promise.resolve()),
}));

describe('TodayCheckinPanel', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-05-19T10:00:00+08:00'));
        vi.mocked(openCheckinEditorWindow).mockClear();
        useCheckinStore.setState({
            weeklyPlan: {
                weekStartDate: '2026-05-18',
                carryToNextWeek: true,
                days: {
                    mon: { kind: 'items', items: [{ id: 'read', title: '阅读', type: 'manual', targetCount: 2 }] },
                    tue: { kind: 'inherit' },
                    wed: { kind: 'rest' },
                    thu: { kind: 'inherit' },
                    fri: { kind: 'inherit' },
                    sat: { kind: 'inherit' },
                    sun: { kind: 'rest' },
                },
            },
            dailyRecords: {},
            lastError: null,
        });
    });

    afterEach(() => {
        cleanup();
        vi.useRealTimers();
    });

    it('renders incomplete progress and increments manual items', () => {
        render(<TodayCheckinPanel />);

        expect(screen.getByText('今日打卡')).toBeTruthy();
        expect(screen.getByText('0/1 项已完成')).toBeTruthy();
        expect(screen.getByText('阅读')).toBeTruthy();
        expect(screen.getByText('0%')).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: '阅读 +1' }));

        expect(useCheckinStore.getState().dailyRecords['2026-05-19'].countsByItemId.read).toBe(1);
    });

    it('renders complete state when every item reaches target', () => {
        useCheckinStore.setState({
            dailyRecords: {
                '2026-05-19': {
                    date: '2026-05-19',
                    countsByItemId: { read: 2 },
                    processedPomodoroEndEventIds: [],
                },
            },
        });

        render(<TodayCheckinPanel />);

        expect(screen.getByText('全部完成')).toBeTruthy();
        expect(screen.getByText('100%')).toBeTruthy();
        expect(screen.getByText('完成')).toBeTruthy();
    });

    it('renders rest state and opens the editor from the compact panel', () => {
        vi.setSystemTime(new Date('2026-05-20T01:00:00+08:00'));

        render(<TodayCheckinPanel />);

        expect(screen.getByText('当天休息')).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: '编辑打卡计划' }));

        expect(openCheckinEditorWindow).toHaveBeenCalledTimes(1);
    });
});
