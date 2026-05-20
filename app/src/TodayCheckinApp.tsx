import type { CSSProperties } from 'react';
import { useBridgeClient } from './domain/bridge/client';
import { useSettingsStore } from './domain/settings';
import { TodayCheckinPanel } from './ui/TodayCheckinPanel';

export default function TodayCheckinApp() {
    useBridgeClient();
    const uiScale = useSettingsStore((s) => s.uiScale);

    return (
        <div className="today-checkin-window-root" style={{ '--app-ui-scale': String(uiScale) } as CSSProperties}>
            <TodayCheckinPanel />
        </div>
    );
}
