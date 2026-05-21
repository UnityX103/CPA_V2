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

    it('round-trips a schemaVersion 1 snapshot containing weeklyPlan and dailyRecords', async () => {
        const snapshot: PersistedCheckinSnapshot = {
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

    it('returns null for malformed persisted data', async () => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ schemaVersion: 99 }));

        await expect(loadPersistedCheckin()).resolves.toBeNull();
    });

    it('preserves valid item icon and per-use metric fields', async () => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
            schemaVersion: 1,
            weeklyPlan: {
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
            },
            dailyRecords: {},
        }));

        const snapshot = await loadPersistedCheckin();
        const monday = snapshot?.weeklyPlan.days.mon;
        expect(monday?.kind).toBe('items');
        if (monday?.kind === 'items') {
            expect(monday.items[0]).toMatchObject({
                icon: 'bookOpen',
                perUseAmount: 30,
                perUseUnit: '分钟',
            });
        }
    });

    it('drops unknown icon keys and clamps invalid metric values', async () => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
            schemaVersion: 1,
            weeklyPlan: {
                weekStartDate: '2026-05-18',
                carryToNextWeek: true,
                days: {
                    mon: { kind: 'inherit' },
                    tue: {
                        kind: 'items',
                        items: [
                            {
                                id: 'bad',
                                title: '坏数据',
                                type: 'manual',
                                targetCount: 1,
                                icon: 'unknownIcon',
                                perUseAmount: -5,
                                perUseUnit: '',
                            },
                        ],
                    },
                    wed: { kind: 'inherit' },
                    thu: { kind: 'inherit' },
                    fri: { kind: 'inherit' },
                    sat: { kind: 'inherit' },
                    sun: { kind: 'rest' },
                },
            },
            dailyRecords: {},
        }));

        const snapshot = await loadPersistedCheckin();
        const tuesday = snapshot?.weeklyPlan.days.tue;
        expect(tuesday?.kind).toBe('items');
        if (tuesday?.kind === 'items') {
            expect(tuesday.items[0]).toMatchObject({ perUseAmount: 0, perUseUnit: '次' });
            expect(tuesday.items[0]).not.toHaveProperty('icon');
        }
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
            schemaVersion: 1,
            weeklyPlan: {
                weekStartDate: '2026-05-18',
                carryToNextWeek: true,
                days: {
                    mon: { kind: 'items', items: [] },
                    tue: { kind: 'inherit' },
                    wed: { kind: 'inherit' },
                    thu: { kind: 'inherit' },
                    fri: { kind: 'inherit' },
                    sat: { kind: 'inherit' },
                    sun: { kind: 'rest' },
                },
            },
            dailyRecords: {},
        })).rejects.toThrow('storage blocked');
    });
});
