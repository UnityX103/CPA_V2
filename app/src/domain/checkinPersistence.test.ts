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
