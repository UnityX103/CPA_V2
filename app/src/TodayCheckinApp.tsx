import type { CSSProperties } from 'react';
import { useBridgeClient } from './domain/bridge/client';
import { useTodayCheckinWindowSize } from './domain/checkinWindow';
import { useSettingsStore } from './domain/settings';
import { TodayCheckinPanel } from './ui/TodayCheckinPanel';

export default function TodayCheckinApp() {
    const bridgeReady = useBridgeClient();
    const checkinEnabled = useSettingsStore((s) => s.checkinEnabled);
    const planPanelEnabled = useSettingsStore((s) => s.planPanelEnabled);
    const uiScale = useSettingsStore((s) => s.uiScale);
    const shouldRenderPanel = bridgeReady && checkinEnabled && planPanelEnabled;
    useTodayCheckinWindowSize(shouldRenderPanel);

    return (
        <div className="today-checkin-window-root" style={{ '--app-ui-scale': String(uiScale) } as CSSProperties}>
            {shouldRenderPanel ? <TodayCheckinPanel /> : null}
        </div>
    );
}
