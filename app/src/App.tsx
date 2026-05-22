import { useEffect, useState, type CSSProperties } from 'react';
import { PomodoroPanel } from './ui/PomodoroPanel';
import { PomodoroEndActionLayer } from './ui/PomodoroEndActionLayer';
import { AppUpdateReadyNotice } from './ui/AppUpdateReadyNotice';
import { useStateSync } from './domain/stateSync';
import { useActiveAppListener } from './domain/activeApp';
import { useBindingKeyListener, useBindingKeyStore } from './domain/bindingKey';
import { useBridgeHost } from './domain/bridge/host';
import { openTodayCheckinWindow, useCheckinWindowController } from './domain/checkinWindow';
import { useInputCounterWindowController } from './domain/inputCounterWindow';
import { useRemotePlayerWindowController } from './domain/remotePlayerWindows';
import { MAIN_WINDOW_BASE_SIZE, useScaledWindowSize } from './domain/scaledWindow';
import { useAppUpdateStore } from './domain/appUpdate';
import { MAX_SCALE, MIN_SCALE, useSettingsStore } from './domain/settings';
import { loadPersistedSettings } from './domain/settingsPersistence';
import { readAutostartEnabled } from './domain/autostart';
import { useCheckinStore } from './domain/checkin';
import { loadPersistedCheckin } from './domain/checkinPersistence';
import { usePomodoroStore } from './domain/pomodoro';
import { useNetworkStore } from './domain/network';
import { useCloudAccountSync } from './domain/cloudAccountSync';
import {
    buildUserPreferencesSnapshot,
    hydrateUserPreferencesSnapshot,
    userPreferencesKey,
    type UserPreferencesStores,
} from './domain/userPreferences';
import {
    loadPersistedUserPreferences,
    savePersistedUserPreferences,
} from './domain/userPreferencesPersistence';
import type { CloudAccountData } from './domain/cloudAccountData';

const STARTUP_ACCOUNT_RESTORE_TIMEOUT_MS = 2500;

type StartupArchiveSource = 'local' | 'cloud';

function clampStartupScale(scale: number): number {
    if (!Number.isFinite(scale)) return 1.0;
    return Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale));
}

function buildStartupSettingsSnapshot(
    settings: Awaited<ReturnType<typeof loadPersistedSettings>>,
    initialSettings: ReturnType<typeof getStartupSettingsState>,
    confirmedAutostartEnabled: boolean,
) {
    const {
        uiScale,
        committedUiScale,
    } = useSettingsStore.getState();
    const scaleChanged = uiScale !== initialSettings.uiScale
        || committedUiScale !== initialSettings.committedUiScale;
    const persistedScale = clampStartupScale(settings?.uiScale ?? committedUiScale);

    const snapshot = {
        uiScale: scaleChanged
            ? committedUiScale
            : persistedScale,
        autostartEnabled: confirmedAutostartEnabled,
    };

    return { snapshot, shouldApplyScale: !scaleChanged };
}

function getStartupSettingsState() {
    const {
        uiScale,
        committedUiScale,
        autostartEnabled,
    } = useSettingsStore.getState();
    return {
        uiScale,
        committedUiScale,
        autostartEnabled,
    };
}

function todayLocalDate(): string {
    const now = new Date();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${now.getFullYear()}-${month}-${day}`;
}

function userPreferenceStores(): UserPreferencesStores {
    return {
        pomodoro: usePomodoroStore,
        settings: useSettingsStore,
        appUpdate: useAppUpdateStore,
        network: useNetworkStore,
        bindingKey: useBindingKeyStore,
        checkin: useCheckinStore,
    };
}

function waitForNetworkStartupResult(
    timeoutMs = STARTUP_ACCOUNT_RESTORE_TIMEOUT_MS,
): Promise<StartupArchiveSource> {
    const current = useNetworkStore.getState();
    if (current.accountStatus === 'loggedIn' && current.cloudSyncStatus === 'synced') {
        return Promise.resolve(current.cloudData ? 'cloud' : 'local');
    }
    if (current.accountStatus !== 'checking' && current.accountStatus !== 'loggingIn') {
        return Promise.resolve('local');
    }

    return new Promise((resolve) => {
        let settled = false;
        const finish = (source: StartupArchiveSource) => {
            if (settled) return;
            settled = true;
            window.clearTimeout(timer);
            unsubscribe();
            resolve(source);
        };
        const timer = window.setTimeout(() => finish('local'), timeoutMs);
        const unsubscribe = useNetworkStore.subscribe((state) => {
            if (state.accountStatus === 'loggedIn' && state.cloudSyncStatus === 'synced') {
                finish(state.cloudData ? 'cloud' : 'local');
                return;
            }
            if (
                state.accountStatus === 'guest'
                || state.accountStatus === 'error'
                || state.cloudSyncStatus === 'offline'
            ) {
                finish('local');
            }
        });
    });
}

export default function App() {
    useStateSync();
    useActiveAppListener();
    useBindingKeyListener();
    useBridgeHost();
    useCheckinWindowController();
    useInputCounterWindowController();
    useRemotePlayerWindowController();
    const uiScale = useSettingsStore((s) => s.uiScale);
    const [localHydrated, setLocalHydrated] = useState(false);
    useCloudAccountSync({ enabled: localHydrated });
    useScaledWindowSize({
        label: 'main',
        baseWidth: MAIN_WINDOW_BASE_SIZE.width,
        baseHeight: MAIN_WINDOW_BASE_SIZE.height,
        minWidth: MAIN_WINDOW_BASE_SIZE.width,
        minHeight: MAIN_WINDOW_BASE_SIZE.height,
        enabled: localHydrated,
    });

    useEffect(() => {
        let cancelled = false;
        let appUpdateCleanup = () => {};
        const subscriptions: Array<() => void> = [];
        let saveTimer: number | null = null;

        const clearSaveTimer = () => {
            if (saveTimer != null) {
                window.clearTimeout(saveTimer);
                saveTimer = null;
            }
        };

        async function saveLocalSnapshot(stores: UserPreferencesStores) {
            const snapshot = buildUserPreferencesSnapshot(stores);
            await savePersistedUserPreferences(snapshot);
            return snapshot;
        }

        function subscribeLocalPreferences(stores: UserPreferencesStores) {
            let previousKey = userPreferencesKey(buildUserPreferencesSnapshot(stores));
            const scheduleSave = () => {
                const snapshot = buildUserPreferencesSnapshot(stores);
                const key = userPreferencesKey(snapshot);
                if (key === previousKey) return;
                previousKey = key;
                clearSaveTimer();
                saveTimer = window.setTimeout(() => {
                    void savePersistedUserPreferences(snapshot);
                }, 100);
            };

            subscriptions.push(
                stores.pomodoro.subscribe(scheduleSave),
                stores.settings.subscribe(scheduleSave),
                stores.appUpdate.subscribe(scheduleSave),
                stores.network.subscribe(scheduleSave),
                stores.bindingKey.subscribe(scheduleSave),
                stores.checkin.subscribe(scheduleSave),
            );
        }

        async function hydrateAndSubscribe() {
            const stores = userPreferenceStores();
            try {
                const [preferences, legacySettings, legacyCheckin] = await Promise.all([
                    loadPersistedUserPreferences(),
                    loadPersistedSettings(),
                    loadPersistedCheckin(),
                    useAppUpdateStore.getState().hydrate(),
                ]);
                if (cancelled) return;

                const initialSettings = getStartupSettingsState();
                const fallbackAutostartEnabled = preferences?.settings.autostartEnabled
                    ?? legacySettings?.autostartEnabled
                    ?? false;
                const confirmedAutostartEnabled = await readAutostartEnabled(fallbackAutostartEnabled);
                if (cancelled) return;
                const autostartChangedDuringNativeRead =
                    useSettingsStore.getState().autostartEnabled !== initialSettings.autostartEnabled;
                const startupAutostartEnabled = autostartChangedDuringNativeRead
                    ? useSettingsStore.getState().autostartEnabled
                    : confirmedAutostartEnabled;

                let cloudArchive: CloudAccountData | null = null;
                try {
                    await useNetworkStore.getState().restoreAccountSession();
                    if (!cancelled) {
                        const source = await waitForNetworkStartupResult();
                        if (!cancelled && source === 'cloud') {
                            cloudArchive = useNetworkStore.getState().cloudData;
                        }
                    }
                } catch (error) {
                    console.warn('[startup] account restore failed; falling back to local archive', error);
                }
                if (cancelled) return;

                if (cloudArchive) {
                    hydrateUserPreferencesSnapshot({
                        stores,
                        snapshot: {
                            ...cloudArchive,
                            settings: {
                                ...cloudArchive.settings,
                                autostartEnabled: startupAutostartEnabled,
                            },
                        },
                    });
                } else if (preferences) {
                    hydrateUserPreferencesSnapshot({
                        stores,
                        snapshot: {
                            ...preferences,
                            settings: {
                                ...preferences.settings,
                                autostartEnabled: startupAutostartEnabled,
                            },
                        },
                    });
                } else {
                    const { snapshot, shouldApplyScale } = buildStartupSettingsSnapshot(
                        legacySettings,
                        initialSettings,
                        startupAutostartEnabled,
                    );
                    useSettingsStore.setState({
                        ...(shouldApplyScale
                            ? { uiScale: snapshot.uiScale, committedUiScale: snapshot.uiScale }
                            : {}),
                        autostartEnabled: snapshot.autostartEnabled,
                    });
                    if (legacyCheckin) {
                        useCheckinStore.getState().hydrateCheckin({
                            weeklyPlan: legacyCheckin.weeklyPlan,
                            dailyRecords: legacyCheckin.dailyRecords,
                        });
                    }
                }

                const beforeRollForward = useCheckinStore.getState().weeklyPlan;
                useCheckinStore.getState().rollForwardToDate(todayLocalDate());
                const afterRollForward = useCheckinStore.getState();
                if (afterRollForward.weeklyPlan !== beforeRollForward) {
                    await saveLocalSnapshot(stores);
                }
                const savedSnapshot = await saveLocalSnapshot(stores);
                const network = useNetworkStore.getState();
                if (network.accountStatus === 'loggedIn' && !network.cloudData) {
                    network.saveUserData(savedSnapshot, network.cloudDataUpdatedAt);
                }
                subscribeLocalPreferences(stores);
                appUpdateCleanup = useAppUpdateStore.getState().startAutomaticChecks();
                setLocalHydrated(true);
            } catch (error) {
                if (!cancelled) {
                    useCheckinStore.getState().setLastError(String(error));
                    setLocalHydrated(true);
                }
            }
        }

        void hydrateAndSubscribe();

        return () => {
            cancelled = true;
            clearSaveTimer();
            appUpdateCleanup();
            subscriptions.forEach((unsubscribe) => unsubscribe());
        };
    }, []);

    useEffect(() => {
        return usePomodoroStore.subscribe((state, previous) => {
            const event = state.lastEndEvent;
            if (!event || event === previous.lastEndEvent) return;
            if (event.fromPhase !== 'focus') return;

            useCheckinStore.getState().applyPomodoroFocusCompletion(todayLocalDate(), event.id);
            if (event.toPhase === 'break' && event.triggeredBy === 'timer') {
                void openTodayCheckinWindow().catch((error) => {
                    console.warn('[checkin] open panel on focus end failed', error);
                });
            }
        });
    }, []);

    return (
        <div className="app-scale-root" style={{ '--app-ui-scale': String(uiScale) } as CSSProperties}>
            <div className="app-root">
                <PomodoroPanel />
                <PomodoroEndActionLayer />
                <AppUpdateReadyNotice />
            </div>
        </div>
    );
}
