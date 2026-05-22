import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const DEFAULT_FILE_PATH = join(process.cwd(), 'data', 'user-data.json');
const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const CHECKIN_ITEM_ICONS = new Set([
    'activity',
    'dumbbell',
    'bookOpen',
    'droplet',
    'listChecks',
    'sparkle',
    'coffee',
    'moon',
    'sun',
    'leaf',
    'music',
    'pencil',
    'target',
    'flame',
    'heart',
    'apple',
    'clock',
    'meditation'
]);

export class UserDataStoreError extends Error
{
    constructor(code, message)
    {
        super(message);
        this.code = code;
    }
}

export class UserDataStore
{
    constructor(options = {})
    {
        this._filePath = options.filePath ?? DEFAULT_FILE_PATH;
        this._now = options.now ?? (() => Date.now());
        this._data = null;
        this._writeChain = Promise.resolve();
    }

    async getUserData(userId)
    {
        const normalizedUserId = normalizeUserId(userId);
        const data = await this._load();
        const snapshot = data.users[normalizedUserId];
        return snapshot ? cloneSnapshot(snapshot) : null;
    }

    async saveUserData({ userId, data, baseUpdatedAt })
    {
        const normalizedUserId = normalizeUserId(userId);
        const fileData = await this._load();
        const current = fileData.users[normalizedUserId] ?? null;
        if (
            current &&
            baseUpdatedAt !== null &&
            baseUpdatedAt !== undefined &&
            Number.isInteger(baseUpdatedAt) &&
            baseUpdatedAt < current.updatedAt
        )
        {
            throw new UserDataStoreError('USER_DATA_CONFLICT', '云端数据已更新');
        }

        const normalized = {
            ...normalizeSnapshot(data),
            updatedAt: this._now()
        };
        fileData.users[normalizedUserId] = normalized;
        await this._save(fileData);
        return cloneSnapshot(normalized);
    }

    async _load()
    {
        if (this._data) return this._data;
        try
        {
            const parsed = JSON.parse(await readFile(this._filePath, 'utf8'));
            this._data = normalizeDataFile(parsed);
        }
        catch
        {
            this._data = { users: {} };
        }
        return this._data;
    }

    async _save(data)
    {
        this._writeChain = this._writeChain.then(async () =>
        {
            await mkdir(dirname(this._filePath), { recursive: true });
            const tempPath = `${this._filePath}.${process.pid}.${Date.now()}.tmp`;
            await writeFile(tempPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
            await rename(tempPath, this._filePath);
        });
        await this._writeChain;
    }
}

function normalizeUserId(userId)
{
    if (typeof userId !== 'string' || !userId.trim())
    {
        throw new UserDataStoreError('AUTH_REQUIRED', '账号未登录');
    }
    return userId.trim();
}

function normalizeDataFile(value)
{
    if (!value || typeof value !== 'object' || !value.users || typeof value.users !== 'object')
    {
        return { users: {} };
    }
    const users = {};
    for (const [userId, snapshot] of Object.entries(value.users))
    {
        try
        {
            users[userId] = normalizeStoredSnapshot(snapshot);
        }
        catch
        {
            continue;
        }
    }
    return { users };
}

function normalizeStoredSnapshot(value)
{
    if (!value || typeof value !== 'object' || !Number.isInteger(value.updatedAt))
    {
        throw new UserDataStoreError('INVALID_USER_DATA', '云端数据格式不正确');
    }
    return { ...normalizeSnapshot(value), updatedAt: value.updatedAt };
}

function normalizeSnapshot(value)
{
    if (!value || typeof value !== 'object' || value.schemaVersion !== 1)
    {
        throw new UserDataStoreError('INVALID_USER_DATA', '云端数据格式不正确');
    }
    return {
        schemaVersion: 1,
        pomodoro: normalizePomodoro(value.pomodoro),
        settings: normalizeSettings(value.settings),
        appUpdate: normalizeAppUpdate(value.appUpdate),
        network: normalizeNetwork(value.network),
        bindingKey: normalizeBindingKey(value.bindingKey),
        checkin: normalizeCheckin(value.checkin)
    };
}

function normalizePomodoro(value)
{
    if (!value || typeof value !== 'object')
    {
        throw new UserDataStoreError('INVALID_USER_DATA', '番茄设置缺失');
    }
    const endActionMode = value.endActionMode === 'topWindow' || value.endActionMode === 'playVideo'
        ? value.endActionMode
        : null;
    if (!endActionMode || !value.endActionVideo || typeof value.endActionVideo !== 'object')
    {
        throw new UserDataStoreError('INVALID_USER_DATA', '番茄结束动作不正确');
    }
    const sourceKind = value.endActionVideo.sourceKind === 'custom' ? 'custom' : 'builtin';
    return {
        focusDurationSeconds: normalizePositiveInteger(value.focusDurationSeconds),
        breakDurationSeconds: normalizeNonNegativeInteger(value.breakDurationSeconds),
        totalRounds: normalizePositiveInteger(value.totalRounds),
        autoStartBreak: Boolean(value.autoStartBreak),
        endActionMode,
        endActionVideo: {
            sourceKind,
            builtinVideoId: clampString(value.endActionVideo.builtinVideoId, 128),
            customVideoPath: clampString(value.endActionVideo.customVideoPath, 1024)
        }
    };
}

function normalizeSettings(value)
{
    if (!value || typeof value !== 'object')
    {
        throw new UserDataStoreError('INVALID_USER_DATA', '设置缺失');
    }
    return {
        uiScale: clampNumber(value.uiScale, 0.5, 2),
        autostartEnabled: Boolean(value.autostartEnabled)
    };
}

function normalizeAppUpdate(value)
{
    if (!value || typeof value !== 'object')
    {
        return { autoUpdateEnabled: true };
    }
    return {
        autoUpdateEnabled: typeof value.autoUpdateEnabled === 'boolean'
            ? value.autoUpdateEnabled
            : true
    };
}

function normalizeNetwork(value)
{
    if (!value || typeof value !== 'object')
    {
        return { autoConnect: false, playerName: '我' };
    }
    const playerName = clampString(value.playerName, 64).trim();
    return {
        autoConnect: typeof value.autoConnect === 'boolean' ? value.autoConnect : false,
        playerName: playerName || '我'
    };
}

function normalizeBindingKey(value)
{
    if (!value || typeof value !== 'object')
    {
        return { panelEnabled: true, entries: [], syncedKeyId: null };
    }
    const entries = Array.isArray(value.entries)
        ? value.entries.map(normalizeBindingKeyEntry).filter(Boolean)
        : [];
    const syncedKeyId = typeof value.syncedKeyId === 'string'
        && entries.some((entry) => entry.id === value.syncedKeyId)
        ? value.syncedKeyId
        : null;
    return {
        panelEnabled: typeof value.panelEnabled === 'boolean' ? value.panelEnabled : true,
        entries,
        syncedKeyId
    };
}

function normalizeBindingKeyEntry(value)
{
    if (!value || typeof value !== 'object')
    {
        return null;
    }
    if (typeof value.id !== 'string' || !value.id || typeof value.label !== 'string')
    {
        return null;
    }
    if (!Number.isInteger(value.keyCode))
    {
        return null;
    }
    const input = normalizeBindingInput(value.input);
    if (value.input != null && !input)
    {
        return null;
    }
    return {
        id: clampString(value.id, 128),
        label: clampString(value.label, 128),
        keyCode: value.keyCode,
        input,
        enabled: typeof value.enabled === 'boolean' ? value.enabled : true
    };
}

function normalizeBindingInput(value)
{
    if (!value || typeof value !== 'object')
    {
        return null;
    }
    if (value.kind === 'keyboard' && Number.isInteger(value.code) && value.code >= 0)
    {
        return { kind: 'keyboard', code: value.code };
    }
    if (
        value.kind === 'mouse' &&
        (value.button === 'left' || value.button === 'middle' || value.button === 'right')
    )
    {
        return { kind: 'mouse', button: value.button };
    }
    return null;
}

function normalizeCheckin(value)
{
    if (!value || typeof value !== 'object')
    {
        throw new UserDataStoreError('INVALID_USER_DATA', '计划缺失');
    }
    return {
        weeklyPlan: normalizeWeeklyPlan(value.weeklyPlan),
        dailyRecords: normalizeDailyRecords(value.dailyRecords)
    };
}

function normalizeWeeklyPlan(value)
{
    if (!value || typeof value !== 'object' || !value.days || typeof value.days !== 'object')
    {
        throw new UserDataStoreError('INVALID_USER_DATA', '周计划格式不正确');
    }
    const days = {};
    for (const day of WEEKDAYS)
    {
        days[day] = normalizeDayPlan(value.days[day]);
    }
    return {
        weekStartDate: clampString(value.weekStartDate, 32),
        carryToNextWeek: Boolean(value.carryToNextWeek),
        days
    };
}

function normalizeDayPlan(value)
{
    if (!value || typeof value !== 'object')
    {
        throw new UserDataStoreError('INVALID_USER_DATA', '日计划格式不正确');
    }
    if (value.kind === 'inherit' || value.kind === 'rest') return { kind: value.kind };
    if (value.kind !== 'items' || !Array.isArray(value.items))
    {
        throw new UserDataStoreError('INVALID_USER_DATA', '日计划项目格式不正确');
    }
    return { kind: 'items', items: value.items.map(normalizeCheckinItem) };
}

function normalizeCheckinItem(value)
{
    if (!value || typeof value !== 'object')
    {
        throw new UserDataStoreError('INVALID_USER_DATA', '计划项格式不正确');
    }
    if (value.type !== 'manual' && value.type !== 'pomodoroFocus')
    {
        throw new UserDataStoreError('INVALID_USER_DATA', '计划项类型不正确');
    }
    const icon = typeof value.icon === 'string' && CHECKIN_ITEM_ICONS.has(value.icon)
        ? value.icon
        : undefined;
    return stripUndefinedFields({
        id: clampString(value.id, 128),
        title: clampString(value.title, 128),
        type: value.type,
        targetCount: normalizePositiveInteger(value.targetCount),
        icon,
        perUseAmount: value.perUseAmount === undefined ? undefined : Math.max(0, Number(value.perUseAmount) || 0),
        perUseUnit: value.perUseUnit === undefined ? undefined : clampString(value.perUseUnit, 32)
    });
}

function normalizeDailyRecords(value)
{
    if (!value || typeof value !== 'object' || Array.isArray(value))
    {
        throw new UserDataStoreError('INVALID_USER_DATA', '打卡记录格式不正确');
    }
    return Object.fromEntries(
        Object.entries(value).map(([date, record]) => [clampString(date, 32), normalizeDailyRecord(record)])
    );
}

function normalizeDailyRecord(value)
{
    if (!value || typeof value !== 'object' || !value.countsByItemId || typeof value.countsByItemId !== 'object')
    {
        throw new UserDataStoreError('INVALID_USER_DATA', '打卡记录格式不正确');
    }
    return {
        date: clampString(value.date, 32),
        countsByItemId: Object.fromEntries(
            Object.entries(value.countsByItemId).map(([id, count]) => [
                clampString(id, 128),
                Math.max(0, Number.isFinite(count) ? Number(count) : 0)
            ])
        ),
        processedPomodoroEndEventIds: Array.isArray(value.processedPomodoroEndEventIds)
            ? value.processedPomodoroEndEventIds.filter(Number.isInteger)
            : []
    };
}

function normalizePositiveInteger(value)
{
    if (!Number.isInteger(value) || value < 1)
    {
        throw new UserDataStoreError('INVALID_USER_DATA', '数值必须为正整数');
    }
    return value;
}

function normalizeNonNegativeInteger(value)
{
    if (!Number.isInteger(value) || value < 0)
    {
        throw new UserDataStoreError('INVALID_USER_DATA', '数值必须为非负整数');
    }
    return value;
}

function clampNumber(value, min, max)
{
    if (typeof value !== 'number' || !Number.isFinite(value))
    {
        throw new UserDataStoreError('INVALID_USER_DATA', '数值格式不正确');
    }
    return Math.max(min, Math.min(max, value));
}

function clampString(value, maxLength)
{
    return typeof value === 'string' ? value.slice(0, maxLength) : '';
}

function stripUndefinedFields(value)
{
    return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}

function cloneSnapshot(snapshot)
{
    return JSON.parse(JSON.stringify(snapshot));
}
