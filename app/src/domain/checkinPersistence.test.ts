import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    loadPersistedCheckin,
    savePersistedCheckin,
    STORAGE_KEY,
    type PersistedCheckinSnapshot,
} from './checkinPersistence';

function installLocalStorage(overrides: Partial<Storage> = {}) {
    const values = new Map<string, string>();
    Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        value: {
            get length() {
                return values.size;
            },
            clear: () => values.clear(),
            getItem: (key: string) => values.get(key) ?? null,
            key: (index: number) => Array.from(values.keys())[index] ?? null,
            removeItem: (key: string) => values.delete(key),
            setItem: (key: string, value: string) => values.set(key, value),
            ...overrides,
        } satisfies Storage,
    });
}

describe('checkinPersistence', () => {
    beforeEach(() => {
        installLocalStorage();
        localStorage.clear();
    });

    it('round-trips a schemaVersion 2 snapshot containing planTemplate and dailyRecords', async () => {
        const snapshot: PersistedCheckinSnapshot = {
            schemaVersion: 2,
            planTemplate: {
                schemaVersion: 2,
                carryToNextWeek: true,
                items: [
                    {
                        id: 'read',
                        title: '阅读',
                        type: 'manual',
                        targetCount: 2,
                        icon: 'bookOpen',
                        repeatDays: ['mon', 'wed'],
                        editMode: 'count',
                        perUseAmount: 30,
                        perUseUnit: '分钟',
                        countInputValue: 7,
                        countUnitSize: 2,
                        countUnitLabel: '页',
                        countLoopCount: 3,
                    },
                    {
                        id: 'focus',
                        title: '专注番茄',
                        type: 'pomodoroFocus',
                        targetCount: 4,
                        repeatDays: ['tue'],
                        editMode: 'cycle',
                    },
                ],
            },
            dailyRecords: {
                '2026-05-18': {
                    date: '2026-05-18',
                    countsByItemId: { read: 1, focus: 2 },
                    processedPomodoroEndEventIds: [1001, 1002],
                },
            },
        };

        await savePersistedCheckin(snapshot);

        expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')).toEqual(snapshot);
        await expect(loadPersistedCheckin()).resolves.toEqual(snapshot);
    });

    it('loads legacy schemaVersion 1 weeklyPlan snapshots as planTemplate', async () => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
            schemaVersion: 1,
            weeklyPlan: {
                weekStartDate: '2026-05-18',
                carryToNextWeek: true,
                days: {
                    mon: {
                        kind: 'items',
                        items: [
                            { id: 'read', title: '阅读', type: 'manual', targetCount: 2 },
                            { id: 'focus', title: '专注番茄', type: 'pomodoroFocus', targetCount: 4 },
                        ],
                    },
                    tue: { kind: 'inherit' },
                    wed: { kind: 'rest' },
                    thu: { kind: 'inherit' },
                    fri: { kind: 'inherit' },
                    sat: { kind: 'inherit' },
                    sun: { kind: 'rest' },
                },
            },
            dailyRecords: {},
        }));

        const snapshot = await loadPersistedCheckin();

        expect(snapshot?.schemaVersion).toBe(2);
        expect(snapshot?.planTemplate.items.find((item) => item.id === 'read')).toMatchObject({
            repeatDays: ['mon', 'tue', 'thu', 'fri', 'sat'],
            editMode: 'cycle',
        });
    });

    it('normalizes v2 item icon, per-use metric, repeat days, and count metadata', async () => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
            schemaVersion: 2,
            planTemplate: {
                schemaVersion: 2,
                carryToNextWeek: true,
                items: [{
                    id: 'bad',
                    title: '',
                    type: 'manual',
                    targetCount: -2,
                    icon: 'unknownIcon',
                    repeatDays: ['mon', 'nope', 'mon'],
                    editMode: 'count',
                    perUseAmount: -5,
                    perUseUnit: '',
                    countInputValue: -1,
                    countUnitSize: 0,
                    countUnitLabel: '',
                    countLoopCount: 3.5,
                }],
            },
            dailyRecords: {},
        }));

        const snapshot = await loadPersistedCheckin();

        expect(snapshot?.planTemplate.items[0]).toEqual({
            id: 'bad',
            title: '新项目',
            type: 'manual',
            targetCount: 1,
            repeatDays: ['mon'],
            editMode: 'count',
            perUseAmount: 0,
            perUseUnit: '次',
            countInputValue: 0,
            countUnitSize: 1,
            countUnitLabel: '次',
            countLoopCount: 1,
        });
    });

    it('returns null for malformed persisted data', async () => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ schemaVersion: 99 }));

        await expect(loadPersistedCheckin()).resolves.toBeNull();
    });

    it('returns null when storage getItem throws', async () => {
        installLocalStorage({
            getItem: vi.fn(() => {
                throw new Error('storage blocked');
            }),
        });

        await expect(loadPersistedCheckin()).resolves.toBeNull();
    });

    it('rejects when storage setItem throws so callers can surface lastError', async () => {
        installLocalStorage({
            setItem: vi.fn(() => {
                throw new Error('storage blocked');
            }),
        });

        await expect(savePersistedCheckin({
            schemaVersion: 2,
            planTemplate: { schemaVersion: 2, carryToNextWeek: true, items: [] },
            dailyRecords: {},
        })).rejects.toThrow('storage blocked');
    });
});
