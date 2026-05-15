import { PomodoroPanel } from './ui/PomodoroPanel';
import { SettingsPanel } from './ui/SettingsPanel';
import { RemoteRoster } from './ui/RemoteRoster';
import { useStateSync } from './domain/stateSync';
import { useActiveAppListener } from './domain/activeApp';
import { useBindingKeyListener } from './domain/bindingKey';

export default function App() {
    useStateSync();
    useActiveAppListener();
    useBindingKeyListener();
    return (
        <div className="app-root">
            <PomodoroPanel />
            <RemoteRoster />
            <SettingsPanel />
        </div>
    );
}
