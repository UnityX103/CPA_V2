import { useEffect, type CSSProperties } from 'react';
import { PomodoroPanel } from './ui/PomodoroPanel';
import { PomodoroEndActionLayer } from './ui/PomodoroEndActionLayer';
import { AppUpdateReadyNotice } from './ui/AppUpdateReadyNotice';
import { useStateSync } from './domain/stateSync';
import { useActiveAppListener } from './domain/activeApp';
import { useBindingKeyListener } from './domain/bindingKey';
import { useBridgeHost } from './domain/bridge/host';
import { useInputCounterWindowController } from './domain/inputCounterWindow';
import { useAppUpdateStore } from './domain/appUpdate';
import { useSettingsStore } from './domain/settings';
import { loadPersistedSettings } from './domain/settingsPersistence';

export default function App() {
    useStateSync();
    useActiveAppListener();
    useBindingKeyListener();
    useBridgeHost();
    useInputCounterWindowController();
    const uiScale = useSettingsStore((s) => s.uiScale);

    useEffect(() => {
        let cancelled = false;
        loadPersistedSettings()
            .then((settings) => {
                if (cancelled || !settings) return;
                useSettingsStore.getState().hydrateSettings(settings);
            })
            .catch((err) => {
                console.warn('[settings] hydration failed', err);
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
