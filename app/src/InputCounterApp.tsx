import type { CSSProperties } from 'react';
import { useBridgeClient } from './domain/bridge/client';
import { useSettingsStore } from './domain/settings';
import { InputCounterPanel } from './ui/InputCounterPanel';

export default function InputCounterApp() {
    useBridgeClient();
    const uiScale = useSettingsStore((s) => s.uiScale);

    return (
        <div className="input-counter-window-root" style={{ '--app-ui-scale': String(uiScale) } as CSSProperties}>
            <InputCounterPanel />
        </div>
    );
}
