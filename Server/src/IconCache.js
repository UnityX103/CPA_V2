export class IconCacheError extends Error
{
    constructor(code, message)
    {
        super(`${code}: ${message}`);
        this.code = code;
        this.name = 'IconCacheError';
    }
}

export class IconCache
{
    constructor(options = {})
    {
        this._maxEntries = options.maxEntries ?? 100;
        this._maxBase64Bytes = options.maxBase64Bytes ?? 1_048_576;
        this._entries = new Map();  // insertion order = LRU; oldest first
    }

    has(bundleId)
    {
        return this._entries.has(bundleId);
    }

    get(bundleId)
    {
        if (!this._entries.has(bundleId)) return null;
        const value = this._entries.get(bundleId);
        this._entries.delete(bundleId);
        this._entries.set(bundleId, value);
        return value;
    }

    set(bundleId, iconBase64)
    {
        if (typeof iconBase64 !== 'string' || iconBase64.length === 0)
        {
            throw new IconCacheError('INVALID_ICON', 'iconBase64 必须为非空字符串');
        }
        if (iconBase64.length > this._maxBase64Bytes)
        {
            throw new IconCacheError('ICON_TOO_LARGE', `图标超过 ${this._maxBase64Bytes} 字节上限`);
        }

        if (this._entries.has(bundleId)) this._entries.delete(bundleId);
        this._entries.set(bundleId, iconBase64);

        while (this._entries.size > this._maxEntries)
        {
            const oldestKey = this._entries.keys().next().value;
            this._entries.delete(oldestKey);
        }
    }

    keys()
    {
        return [...this._entries.keys()];
    }
}
