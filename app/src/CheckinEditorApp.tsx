import type { CSSProperties } from 'react';
import { useBridgeClient } from './domain/bridge/client';
import { useCheckinEditorWindowSize } from './domain/checkinWindow';
import { useSettingsStore } from './domain/settings';
import { CheckinPlanEditorPanel } from './ui/CheckinPlanEditorPanel';

export default function CheckinEditorApp() {
    const bridgeReady = useBridgeClient();
    const checkinEnabled = useSettingsStore((s) => s.checkinEnabled);
    const uiScale = useSettingsStore((s) => s.uiScale);
    const shouldRenderPanel = bridgeReady && checkinEnabled;
    useCheckinEditorWindowSize(shouldRenderPanel);

    return (
        <div className="checkin-editor-window-root" style={{ '--app-ui-scale': String(uiScale) } as CSSProperties}>
            {shouldRenderPanel ? <CheckinPlanEditorPanel /> : null}
        </div>
    );
}
