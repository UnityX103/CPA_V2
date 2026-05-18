import { useEffect, useState, type CSSProperties } from 'react';
import { PomodoroPanel } from './ui/PomodoroPanel';
import { PomodoroEndActionLayer } from './ui/PomodoroEndActionLayer';
import { useStateSync } from './domain/stateSync';
import { useActiveAppListener } from './domain/activeApp';
import { useBindingKeyListener } from './domain/bindingKey';
import { useBridgeHost } from './domain/bridge/host';
import { useInputCounterWindowController } from './domain/inputCounterWindow';
import { MAIN_WINDOW_BASE_SIZE, useScaledWindowSize } from './domain/scaledWindow';
import { useSettingsStore } from './domain/settings';
import { loadPersistedSettings } from './domain/settingsPersistence';

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
            .then((settings) => {
                if (cancelled) return;
                if (settings) {
                    useSettingsStore.getState().hydrateSettings(settings);
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

    return (
        <div className="app-scale-root" style={{ '--app-ui-scale': String(uiScale) } as CSSProperties}>
            <div className="app-root">
                <PomodoroPanel />
                <PomodoroEndActionLayer />
            </div>
        </div>
    );
}
