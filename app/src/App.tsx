import { useEffect, useState, type CSSProperties } from 'react';
import { PomodoroPanel } from './ui/PomodoroPanel';
import { PomodoroEndActionLayer } from './ui/PomodoroEndActionLayer';
import { AppUpdateReadyNotice } from './ui/AppUpdateReadyNotice';
import { useStateSync } from './domain/stateSync';
import { useActiveAppListener } from './domain/activeApp';
import { useBindingKeyListener } from './domain/bindingKey';
import { useBridgeHost } from './domain/bridge/host';
import { useCheckinWindowController } from './domain/checkinWindow';
import { useInputCounterWindowController } from './domain/inputCounterWindow';
import { useRemotePlayerWindowController } from './domain/remotePlayerWindows';
import { MAIN_WINDOW_BASE_SIZE, useScaledWindowSize } from './domain/scaledWindow';
import { useAppUpdateStore } from './domain/appUpdate';
import { MAX_SCALE, MIN_SCALE, useSettingsStore } from './domain/settings';
import { loadPersistedSettings, savePersistedSettings } from './domain/settingsPersistence';
import { readAutostartEnabled } from './domain/autostart';
import { useCheckinStore } from './domain/checkin';
import { loadPersistedCheckin, savePersistedCheckin } from './domain/checkinPersistence';
import { usePomodoroStore } from './domain/pomodoro';
import { useNetworkStore } from './domain/network';

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
        showActiveAppWindowTitle,
        autoPinOnFocusEnd,
    } = useSettingsStore.getState();
    const scaleChanged = uiScale !== initialSettings.uiScale
        || committedUiScale !== initialSettings.committedUiScale;
    const titleVisibilityChanged = showActiveAppWindowTitle !== initialSettings.showActiveAppWindowTitle;
    const autoPinChanged = autoPinOnFocusEnd !== initialSettings.autoPinOnFocusEnd;
    const persistedScale = clampStartupScale(settings?.uiScale ?? committedUiScale);

    const snapshot = {
        uiScale: scaleChanged
            ? committedUiScale
            : persistedScale,
        showActiveAppWindowTitle: titleVisibilityChanged
            ? showActiveAppWindowTitle
            : settings?.showActiveAppWindowTitle ?? showActiveAppWindowTitle,
        autostartEnabled: confirmedAutostartEnabled,
        autoPinOnFocusEnd: autoPinChanged
            ? autoPinOnFocusEnd
            : settings?.autoPinOnFocusEnd ?? autoPinOnFocusEnd,
    };

    return { snapshot, shouldApplyScale: !scaleChanged };
}

function getStartupSettingsState() {
    const {
        uiScale,
        committedUiScale,
        showActiveAppWindowTitle,
        autostartEnabled,
        autoPinOnFocusEnd,
    } = useSettingsStore.getState();
    return {
        uiScale,
        committedUiScale,
        showActiveAppWindowTitle,
        autostartEnabled,
        autoPinOnFocusEnd,
    };
}

function todayLocalDate(): string {
    const now = new Date();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${now.getFullYear()}-${month}-${day}`;
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
    const [settingsHydrated, setSettingsHydrated] = useState(false);
    useScaledWindowSize({
        label: 'main',
        baseWidth: MAIN_WINDOW_BASE_SIZE.width,
        baseHeight: MAIN_WINDOW_BASE_SIZE.height,
        minWidth: MAIN_WINDOW_BASE_SIZE.width,
        minHeight: MAIN_WINDOW_BASE_SIZE.height,
        enabled: settingsHydrated,
    });

    useEffect(() => {
        void useNetworkStore.getState().restoreAccountSession();
    }, []);

    useEffect(() => {
        let cancelled = false;
        loadPersistedSettings()
            .then(async (settings) => {
                if (cancelled) return;
                const fallbackAutostartEnabled = settings?.autostartEnabled ?? false;
                const initialSettings = getStartupSettingsState();
                const confirmedAutostartEnabled = await readAutostartEnabled(fallbackAutostartEnabled);
                if (cancelled) return;
                if (useSettingsStore.getState().autostartEnabled !== initialSettings.autostartEnabled) {
                    setSettingsHydrated(true);
                    return;
                }

                const { snapshot, shouldApplyScale } = buildStartupSettingsSnapshot(
                    settings,
                    initialSettings,
                    confirmedAutostartEnabled,
                );

                useSettingsStore.setState({
                    ...(shouldApplyScale
                        ? { uiScale: snapshot.uiScale, committedUiScale: snapshot.uiScale }
                        : {}),
                    showActiveAppWindowTitle: snapshot.showActiveAppWindowTitle,
                    autostartEnabled: snapshot.autostartEnabled,
                    autoPinOnFocusEnd: snapshot.autoPinOnFocusEnd,
                });
                if (confirmedAutostartEnabled !== fallbackAutostartEnabled) {
                    void savePersistedSettings(snapshot);
                }
                setSettingsHydrated(true);
            })
            .catch((err) => {
                console.warn('[settings] hydration failed', err);
                if (!cancelled) {
                    setSettingsHydrated(true);
                }
            });
        return () => {
            cancelled = true;
        };
    }, []);

    useEffect(() => {
        let cancelled = false;
        let unsubscribe = () => {};

        async function hydrateAndSubscribe() {
            try {
                const persisted = await loadPersistedCheckin();
                if (cancelled) return;

                const checkin = useCheckinStore.getState();
                if (persisted) {
                    checkin.hydrateCheckin({
                        weeklyPlan: persisted.weeklyPlan,
                        dailyRecords: persisted.dailyRecords,
                    });
                }
                const beforeRollForward = useCheckinStore.getState().weeklyPlan;
                useCheckinStore.getState().rollForwardToDate(todayLocalDate());
                const afterRollForward = useCheckinStore.getState();
                if (afterRollForward.weeklyPlan !== beforeRollForward) {
                    await savePersistedCheckin({
                        schemaVersion: 1,
                        weeklyPlan: afterRollForward.weeklyPlan,
                        dailyRecords: afterRollForward.dailyRecords,
                    });
                }
            } catch (error) {
                if (!cancelled) {
                    useCheckinStore.getState().setLastError(String(error));
                }
            }

            if (cancelled) return;
            unsubscribe = useCheckinStore.subscribe((state, previousState) => {
                if (
                    state.weeklyPlan === previousState.weeklyPlan
                    && state.dailyRecords === previousState.dailyRecords
                ) {
                    return;
                }

                void savePersistedCheckin({
                    schemaVersion: 1,
                    weeklyPlan: state.weeklyPlan,
                    dailyRecords: state.dailyRecords,
                }).catch((error) => {
                    if (!cancelled) {
                        useCheckinStore.getState().setLastError(String(error));
                    }
                });
            });
        }

        void hydrateAndSubscribe();

        return () => {
            cancelled = true;
            unsubscribe();
        };
    }, []);

    useEffect(() => {
        let cancelled = false;
        let cleanup = () => {};

        useAppUpdateStore.getState().hydrate()
            .then(() => {
                if (cancelled) return;
                cleanup = useAppUpdateStore.getState().startAutomaticChecks();
            })
            .catch((err) => {
                console.warn('[appUpdate] hydration failed', err);
            });

        return () => {
            cancelled = true;
            cleanup();
        };
    }, []);

    useEffect(() => {
        return usePomodoroStore.subscribe((state, previous) => {
            const event = state.lastEndEvent;
            if (!event || event === previous.lastEndEvent) return;
            if (event.fromPhase !== 'focus') return;

            useCheckinStore.getState().applyPomodoroFocusCompletion(todayLocalDate(), event.id);

            if (
                event.toPhase === 'break'
                && event.triggeredBy === 'timer'
                && useSettingsStore.getState().autoPinOnFocusEnd
                && !state.isPinned
            ) {
                usePomodoroStore.getState().setPinned(true);
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
