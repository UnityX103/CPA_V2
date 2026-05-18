import type { CSSProperties } from 'react';
import { SettingsPanel } from './ui/SettingsPanel';
import { DangerousChangeDialog } from './ui/DangerousChangeDialog';
import { useBridgeClient } from './domain/bridge/client';
import { SETTINGS_WINDOW_BASE_SIZE, SETTINGS_WINDOW_MIN_SIZE, useScaledWindowSize } from './domain/scaledWindow';
import { useSettingsStore } from './domain/settings';
import './styles/global.css';

export default function SettingsApp() {
    const bridgeReady = useBridgeClient();
    const uiScale = useSettingsStore((s) => s.uiScale);
    useScaledWindowSize({
        label: 'settings',
        baseWidth: SETTINGS_WINDOW_BASE_SIZE.width,
        baseHeight: SETTINGS_WINDOW_BASE_SIZE.height,
        minWidth: SETTINGS_WINDOW_MIN_SIZE.width,
        minHeight: SETTINGS_WINDOW_MIN_SIZE.height,
        center: true,
        enabled: bridgeReady,
    });

    return (
        <div className="settings-window-root" style={{ '--app-ui-scale': String(uiScale) } as CSSProperties}>
            <div className="settings-scale-content">
                <SettingsPanel />
            </div>
            <DangerousChangeDialog />
        </div>
    );
}
