import { useEffect, type CSSProperties } from 'react';
import { PomodoroPanel } from './ui/PomodoroPanel';
import { PomodoroEndActionLayer } from './ui/PomodoroEndActionLayer';
import { useStateSync } from './domain/stateSync';
import { useActiveAppListener } from './domain/activeApp';
import { useBindingKeyListener } from './domain/bindingKey';
import { useBridgeHost } from './domain/bridge/host';
import { useSettingsStore } from './domain/settings';
import { loadPersistedSettings } from './domain/settingsPersistence';

export default function App() {
    useStateSync();
    useActiveAppListener();
    useBindingKeyListener();
    useBridgeHost();
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

    return (
        <div className="app-scale-root" style={{ '--app-ui-scale': String(uiScale) } as CSSProperties}>
            <div className="app-root">
                <PomodoroPanel />
                <PomodoroEndActionLayer />
            </div>
        </div>
    );
}
