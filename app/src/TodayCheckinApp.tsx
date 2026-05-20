import type { CSSProperties } from 'react';
import { useBridgeClient } from './domain/bridge/client';
import { useTodayCheckinWindowSize } from './domain/checkinWindow';
import { useSettingsStore } from './domain/settings';
import { TodayCheckinPanel } from './ui/TodayCheckinPanel';

export default function TodayCheckinApp() {
    const bridgeReady = useBridgeClient();
    useTodayCheckinWindowSize(bridgeReady);
    const uiScale = useSettingsStore((s) => s.uiScale);

    return (
        <div className="today-checkin-window-root" style={{ '--app-ui-scale': String(uiScale) } as CSSProperties}>
            {bridgeReady ? <TodayCheckinPanel /> : null}
        </div>
    );
}
