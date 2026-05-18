import { useBridgeClient } from './domain/bridge/client';
import { InputCounterPanel } from './ui/InputCounterPanel';

export default function InputCounterApp() {
    useBridgeClient();

    return (
        <div className="input-counter-window-root">
            <InputCounterPanel />
        </div>
    );
}
