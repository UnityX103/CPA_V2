import { PomodoroPanel } from './ui/PomodoroPanel';
import { RemoteRoster } from './ui/RemoteRoster';
import { useStateSync } from './domain/stateSync';
import { useActiveAppListener } from './domain/activeApp';
import { useBindingKeyListener } from './domain/bindingKey';
import { useBridgeHost } from './domain/bridge/host';

export default function App() {
    useStateSync();
    useActiveAppListener();
    useBindingKeyListener();
    useBridgeHost();
    return (
        <div className="app-root">
            <PomodoroPanel />
            <RemoteRoster />
        </div>
    );
}
