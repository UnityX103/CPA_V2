import type { CSSProperties } from 'react';
import { useBridgeClient } from './domain/bridge/client';
import { useCheckinEditorWindowSize } from './domain/checkinWindow';
import { useSettingsStore } from './domain/settings';
import { CheckinPlanEditorPanel } from './ui/CheckinPlanEditorPanel';

export default function CheckinEditorApp() {
    const bridgeReady = useBridgeClient();
    useCheckinEditorWindowSize(bridgeReady);
    const uiScale = useSettingsStore((s) => s.uiScale);

    return (
        <div className="checkin-editor-window-root" style={{ '--app-ui-scale': String(uiScale) } as CSSProperties}>
            {bridgeReady ? <CheckinPlanEditorPanel /> : null}
        </div>
    );
}
