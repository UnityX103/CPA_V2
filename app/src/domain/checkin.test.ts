import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    createCheckinStore,
    dailySummary,
    defaultPlanTemplate,
    itemsForDate,
    migrateWeeklyPlanToTemplate,
    streakSummary,
    weeklySummary,
    type CheckinPlanTemplate,
    type WeeklyCheckinPlan,
} from './checkin';

const weekStartDate = '2026-05-18';

function template(items: CheckinPlanTemplate['items']): CheckinPlanTemplate {
    return { schemaVersion: 2, carryToNextWeek: true, items };
}

function legacyPlan(overrides: Partial<WeeklyCheckinPlan['days']>): WeeklyCheckinPlan {
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

    it('filters template items by repeat days for a date', () => {
        const store = createCheckinStore({ isMirrorWindow: false });
        store.setState({
            planTemplate: template([
                { id: 'read', title: '阅读', type: 'manual', targetCount: 2, repeatDays: ['mon', 'wed'], editMode: 'cycle' },
                { id: 'water', title: '喝水', type: 'manual', targetCount: 3, repeatDays: ['tue'], editMode: 'cycle' },
            ]),
            dailyRecords: {},
            lastError: null,
        });

        expect(itemsForDate(store.getState(), '2026-05-18').map((item) => item.id)).toEqual(['read']);
        expect(itemsForDate(store.getState(), '2026-05-19').map((item) => item.id)).toEqual(['water']);
        expect(itemsForDate(store.getState(), '2026-05-20').map((item) => item.id)).toEqual(['read']);
        expect(itemsForDate(store.getState(), '2026-05-21')).toEqual([]);
    });

    it('treats no-plan days as complete without rest-day semantics', () => {
        const store = createCheckinStore({ isMirrorWindow: false });
        store.setState({
            planTemplate: template([
                { id: 'read', title: '阅读', type: 'manual', targetCount: 2, repeatDays: ['mon'], editMode: 'cycle' },
            ]),
            dailyRecords: {},
            lastError: null,
        });

        expect(itemsForDate(store.getState(), '2026-05-19')).toEqual([]);
        expect(dailySummary(store.getState(), '2026-05-19')).toMatchObject({
            date: '2026-05-19',
            isNoPlanDay: true,
            completedCount: 0,
            totalTarget: 0,
            completionRate: 1,
        });

        const summary = weeklySummary(store.getState(), weekStartDate);
        expect(summary.noPlanDays).toEqual([
            '2026-05-19',
            '2026-05-20',
            '2026-05-21',
            '2026-05-22',
            '2026-05-23',
            '2026-05-24',
        ]);
        expect(summary.totalTarget).toBe(2);
    });

    it('keeps completed streaks through no-plan days', () => {
        const store = createCheckinStore({ isMirrorWindow: false });
        store.setState({
            planTemplate: template([
                { id: 'read', title: '阅读', type: 'manual', targetCount: 2, repeatDays: ['mon'], editMode: 'cycle' },
                { id: 'focus', title: '专注番茄', type: 'pomodoroFocus', targetCount: 2, repeatDays: ['thu'], editMode: 'cycle' },
            ]),
            dailyRecords: {},
            lastError: null,
        });

        store.getState().incrementItem('2026-05-18', 'read');
        store.getState().incrementItem('2026-05-18', 'read');
        store.getState().applyPomodoroFocusCompletion('2026-05-21', 1);
        store.getState().applyPomodoroFocusCompletion('2026-05-21', 2);

        expect(streakSummary(store.getState(), '2026-05-21')).toEqual({
            currentStreak: 4,
            checkedThroughDate: '2026-05-18',
        });
    });

    it('increments every effective pomodoroFocus item once per Pomodoro end event id', () => {
        const store = createCheckinStore({ isMirrorWindow: false });
        store.setState({
            planTemplate: template([
                { id: 'p1', title: '早间番茄', type: 'pomodoroFocus', targetCount: 1, repeatDays: ['tue'], editMode: 'cycle' },
                { id: 'p2', title: '晚间番茄', type: 'pomodoroFocus', targetCount: 1, repeatDays: ['tue'], editMode: 'cycle' },
                { id: 'm1', title: '喝水', type: 'manual', targetCount: 1, repeatDays: ['tue'], editMode: 'cycle' },
                { id: 'p3', title: '周三番茄', type: 'pomodoroFocus', targetCount: 1, repeatDays: ['wed'], editMode: 'cycle' },
            ]),
            dailyRecords: {},
            lastError: null,
        });

        store.getState().applyPomodoroFocusCompletion('2026-05-19', 42);
        store.getState().applyPomodoroFocusCompletion('2026-05-19', 42);

        expect(store.getState().dailyRecords['2026-05-19'].countsByItemId).toEqual({
            p1: 1,
            p2: 1,
        });
        expect(store.getState().dailyRecords['2026-05-19'].processedPomodoroEndEventIds).toEqual([42]);
    });

    it('creates a default item-repeat template', () => {
        expect(defaultPlanTemplate()).toMatchObject({
            schemaVersion: 2,
            carryToNextWeek: true,
            items: [
                expect.objectContaining({
                    id: 'pomodoro-focus',
                    repeatDays: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'],
                    editMode: 'cycle',
                }),
            ],
        });
    });

    it('migrates legacy weekly plans into repeated template items', () => {
        const migrated = migrateWeeklyPlanToTemplate(legacyPlan({}));

        expect(migrated).toMatchObject({ schemaVersion: 2, carryToNextWeek: true });
        expect(migrated.items).toEqual([
            expect.objectContaining({
                id: 'read',
                title: '阅读',
                type: 'manual',
                targetCount: 2,
                repeatDays: ['mon', 'tue'],
                editMode: 'cycle',
            }),
            expect.objectContaining({
                id: 'pomo',
                title: '专注番茄',
                type: 'pomodoroFocus',
                targetCount: 3,
                repeatDays: ['thu', 'fri', 'sat'],
                editMode: 'cycle',
            }),
        ]);
    });
});
