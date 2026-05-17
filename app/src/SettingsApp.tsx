import type { CSSProperties } from 'react';
import { SettingsPanel } from './ui/SettingsPanel';
import { DangerousChangeDialog } from './ui/DangerousChangeDialog';
import { useBridgeClient } from './domain/bridge/client';
import { useSettingsStore } from './domain/settings';
import './styles/global.css';

export default function SettingsApp() {
    useBridgeClient();
    const uiScale = useSettingsStore((s) => s.uiScale);

    return (
        <div className="settings-window-root" style={{ '--app-ui-scale': String(uiScale) } as CSSProperties}>
            <div className="settings-scale-content">
                <SettingsPanel />
            </div>
            <DangerousChangeDialog />
        </div>
    );
}
