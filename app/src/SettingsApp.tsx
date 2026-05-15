import { SettingsPanel } from './ui/SettingsPanel';
import { useBridgeClient } from './domain/bridge/client';
import './styles/global.css';

export default function SettingsApp() {
    useBridgeClient();
    return <SettingsPanel />;
}
