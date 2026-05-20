import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    createCheckinStore,
    defaultWeeklyPlan,
    effectivePlanForDate,
    effectiveItemsForDate,
    dailySummary,
    streakSummary,
    weeklySummary,
    type WeeklyCheckinPlan,
} from './checkin';

const weekStartDate = '2026-05-18';

function plan(overrides: Partial<WeeklyCheckinPlan['days']>): WeeklyCheckinPlan {
    return {
        weekStartDate,
        carryToNextWeek: true,
        days: {
            mon: { kind: 'items', items: [{ id: 'read', title: '阅读', type: 'manual', targetCount: 2 }] },
            tue: { kind: 'inherit' },
            wed: { kind: 'rest' },
            thu: { kind: 'items', items: [{ id: 'pomo', title: '专注番茄', type: 'pomodoroFocus', targetCount: 3 }] },
            fri: { kind: 'inherit' },
            sat: { kind: 'inherit' },
            sun: { kind: 'rest' },
            ...overrides,
        },
    };
}

describe('checkin domain', () => {
    beforeEach(() => {
        vi.setSystemTime(new Date('2026-05-19T10:00:00+08:00'));
    });

    it('resolves inherit days from the previous ordinary day without copying records', () => {
        const store = createCheckinStore({ isMirrorWindow: false });
        store.setState({ weeklyPlan: plan({}) });

        expect(effectiveItemsForDate(store.getState(), '2026-05-19')).toEqual([
            { id: 'read', title: '阅读', type: 'manual', targetCount: 2 },
        ]);

        store.getState().incrementItem('2026-05-19', 'read');

        expect(store.getState().dailyRecords['2026-05-19'].countsByItemId.read).toBe(1);
        expect(store.getState().dailyRecords['2026-05-18']).toBeUndefined();
    });

    it('excludes rest days from summaries', () => {
        const store = createCheckinStore({ isMirrorWindow: false });
        store.setState({ weeklyPlan: plan({}) });

        expect(dailySummary(store.getState(), '2026-05-20')).toMatchObject({
            date: '2026-05-20',
            isRestDay: true,
            totalTarget: 0,
            completedCount: 0,
            completionRate: 1,
        });

        const summary = weeklySummary(store.getState(), weekStartDate);
        expect(summary.restDays).toEqual(['2026-05-20', '2026-05-24']);
        expect(summary.totalTarget).toBe(13);
    });

    it('chains inherit days through previous effective items until a rest day stops inheritance', () => {
        const store = createCheckinStore({ isMirrorWindow: false });
        store.setState({ weeklyPlan: plan({}) });

        expect(effectivePlanForDate(store.getState(), '2026-05-23')).toEqual({
            kind: 'items',
            items: [{ id: 'pomo', title: '专注番茄', type: 'pomodoroFocus', targetCount: 3 }],
        });
        expect(effectiveItemsForDate(store.getState(), '2026-05-23')).toEqual([
            { id: 'pomo', title: '专注番茄', type: 'pomodoroFocus', targetCount: 3 },
        ]);

        store.setState({
            weeklyPlan: plan({
                fri: { kind: 'rest' },
            }),
        });

        expect(effectiveItemsForDate(store.getState(), '2026-05-23')).toEqual([]);
    });

    it('skips rest days when calculating the current streak', () => {
        const store = createCheckinStore({ isMirrorWindow: false });
        store.setState({ weeklyPlan: plan({}) });

        store.getState().incrementItem('2026-05-18', 'read');
        store.getState().incrementItem('2026-05-18', 'read');
        store.getState().incrementItem('2026-05-19', 'read');
        store.getState().incrementItem('2026-05-19', 'read');
        store.getState().applyPomodoroFocusCompletion('2026-05-21', 1);
        store.getState().applyPomodoroFocusCompletion('2026-05-21', 2);
        store.getState().applyPomodoroFocusCompletion('2026-05-21', 3);

        expect(streakSummary(store.getState(), '2026-05-21')).toEqual({
            currentStreak: 3,
            checkedThroughDate: '2026-05-21',
        });
    });

    it('stops the current streak at an incomplete ordinary day', () => {
        const store = createCheckinStore({ isMirrorWindow: false });
        store.setState({ weeklyPlan: plan({}) });

        store.getState().incrementItem('2026-05-18', 'read');
        store.getState().incrementItem('2026-05-18', 'read');
        store.getState().incrementItem('2026-05-19', 'read');
        store.getState().applyPomodoroFocusCompletion('2026-05-21', 1);
        store.getState().applyPomodoroFocusCompletion('2026-05-21', 2);
        store.getState().applyPomodoroFocusCompletion('2026-05-21', 3);

        expect(streakSummary(store.getState(), '2026-05-21')).toEqual({
            currentStreak: 1,
            checkedThroughDate: '2026-05-21',
        });
    });

    it('counts completed ordinary-day streaks across more than seven calendar days while skipping rest days', () => {
        const store = createCheckinStore({ isMirrorWindow: false });
        store.setState({ weeklyPlan: plan({}) });

        for (const date of ['2026-05-18', '2026-05-19', '2026-05-25', '2026-05-26']) {
            store.getState().incrementItem(date, 'read');
            store.getState().incrementItem(date, 'read');
        }
        for (const [date, eventIds] of [
            ['2026-05-21', [1, 2, 3]],
            ['2026-05-22', [4, 5, 6]],
            ['2026-05-23', [7, 8, 9]],
            ['2026-05-28', [16, 17, 18]],
        ] as const) {
            for (const eventId of eventIds) {
                store.getState().applyPomodoroFocusCompletion(date, eventId);
            }
        }

        expect(streakSummary(store.getState(), '2026-05-28')).toEqual({
            currentStreak: 8,
            checkedThroughDate: '2026-05-28',
        });
    });

    it('increments every pomodoroFocus item once per Pomodoro end event id', () => {
        const store = createCheckinStore({ isMirrorWindow: false });
        store.setState({
            weeklyPlan: plan({
                tue: {
                    kind: 'items',
                    items: [
                        { id: 'p1', title: '早间番茄', type: 'pomodoroFocus', targetCount: 1 },
                        { id: 'p2', title: '晚间番茄', type: 'pomodoroFocus', targetCount: 1 },
                        { id: 'm1', title: '喝水', type: 'manual', targetCount: 1 },
                    ],
                },
            }),
        });

        store.getState().applyPomodoroFocusCompletion('2026-05-19', 42);
        store.getState().applyPomodoroFocusCompletion('2026-05-19', 42);

        expect(store.getState().dailyRecords['2026-05-19'].countsByItemId).toEqual({
            p1: 1,
            p2: 1,
        });
        expect(store.getState().dailyRecords['2026-05-19'].processedPomodoroEndEventIds).toEqual([42]);
    });

    it('creates a default current-week plan', () => {
        expect(defaultWeeklyPlan('2026-05-18')).toMatchObject({
            weekStartDate: '2026-05-18',
            carryToNextWeek: true,
        });
    });

    it('rolls the current plan forward when carryToNextWeek is enabled', () => {
        const store = createCheckinStore({ isMirrorWindow: false });
        store.setState({ weeklyPlan: plan({}) });

        store.getState().rollForwardToDate('2026-05-25');

        expect(store.getState().weeklyPlan.weekStartDate).toBe('2026-05-25');
        expect(store.getState().weeklyPlan.days.mon).toEqual({
            kind: 'items',
            items: [{ id: 'read', title: '阅读', type: 'manual', targetCount: 2 }],
        });
    });
});
