export interface PersistedSettings {
    uiScale: number;
}

export async function loadPersistedSettings(): Promise<PersistedSettings | null> {
    return null;
}

export async function savePersistedSettings(_settings: PersistedSettings): Promise<void> {
    return Promise.resolve();
}
