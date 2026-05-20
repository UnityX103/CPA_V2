import { useEffect, useState, type CSSProperties } from 'react';
import { PomodoroPanel } from './ui/PomodoroPanel';
import { PomodoroEndActionLayer } from './ui/PomodoroEndActionLayer';
import { AppUpdateReadyNotice } from './ui/AppUpdateReadyNotice';
import { useStateSync } from './domain/stateSync';
import { useActiveAppListener } from './domain/activeApp';
import { useBindingKeyListener } from './domain/bindingKey';
import { useBridgeHost } from './domain/bridge/host';
import { useInputCounterWindowController } from './domain/inputCounterWindow';
import { MAIN_WINDOW_BASE_SIZE, useScaledWindowSize } from './domain/scaledWindow';
import { useAppUpdateStore } from './domain/appUpdate';
import { useSettingsStore } from './domain/settings';
import { loadPersistedSettings, savePersistedSettings } from './domain/settingsPersistence';
import { readAutostartEnabled } from './domain/autostart';

export default function App() {
    useStateSync();
    useActiveAppListener();
    useBindingKeyListener();
    useBridgeHost();
    useInputCounterWindowController();
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
        let cancelled = false;
        loadPersistedSettings()
            .then(async (settings) => {
                if (cancelled) return;
                const fallbackAutostartEnabled = settings?.autostartEnabled ?? false;
                const confirmedAutostartEnabled = await readAutostartEnabled(fallbackAutostartEnabled);
                if (cancelled) return;

                const currentSettings = useSettingsStore.getState();
                const snapshot = {
                    uiScale: settings?.uiScale ?? currentSettings.committedUiScale,
                    showActiveAppWindowTitle: settings?.showActiveAppWindowTitle
                        ?? currentSettings.showActiveAppWindowTitle,
                    autostartEnabled: confirmedAutostartEnabled,
                };

                useSettingsStore.getState().hydrateSettings(snapshot);
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
