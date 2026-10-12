export interface KegelRecord {
    id: string;
    targetReps: number;
    repsByDay: Record<string, number>;
    completedOn: string | null;
}
export function localDay(date = new Date()): string {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
function previousDay(day: string): string {
    const [y, m, d] = day.split('-').map(Number);
    return localDay(new Date(y, m - 1, d - 1, 12));
}
export function recordKegelReps(records: KegelRecord[], id: string, target: number, count: number, finished: boolean, day = localDay()): KegelRecord[] {
    if (count <= 0) return records;
    const previous = records.find((r) => r.id === id);
    const record: KegelRecord = {
        id, targetReps: target,
        repsByDay: { ...previous?.repsByDay, [day]: (previous?.repsByDay[day] ?? 0) + count },
        completedOn: finished ? day : previous?.completedOn ?? null,
    };
    return [...records.filter((r) => r.id !== id), record];
}
export function kegelStats(records: KegelRecord[], today = localDay()) {
    const completedDays = new Set(records.map((r) => r.completedOn).filter((d): d is string => !!d));
    // Keep yesterday's streak visible until today's opportunity has passed.
    let cursor = completedDays.has(today) ? today : previousDay(today);
    let streak = 0;
    while (completedDays.has(cursor)) { streak++; cursor = previousDay(cursor); }
    const todayRecords = records.filter((r) => r.repsByDay[today] || r.completedOn === today);
    return {
        streak, todayDone: completedDays.has(today),
        sets: records.filter((r) => r.completedOn === today).length,
        repetitions: todayRecords.reduce((sum, r) => sum + (r.repsByDay[today] || 0), 0),
        records: todayRecords,
    };
}
export function normalizeKegelHistory(value: unknown): KegelRecord[] {
    if (!Array.isArray(value)) return [];
    const dayPattern = /^\d{4}-\d{2}-\d{2}$/;
    return value.filter((r): r is KegelRecord => !!r && typeof r.id === 'string'
        && Number.isInteger(r.targetReps) && r.targetReps > 0 && r.targetReps <= 99
        && (r.completedOn === null || typeof r.completedOn === 'string' && dayPattern.test(r.completedOn))
        && r.repsByDay && typeof r.repsByDay === 'object' && !Array.isArray(r.repsByDay)
        && Object.entries(r.repsByDay).every(([day, count]) => dayPattern.test(day)
            && typeof count === 'number' && Number.isInteger(count) && count >= 0 && count <= r.targetReps))
        .map((r) => ({ ...r, repsByDay: { ...r.repsByDay } }));
}
