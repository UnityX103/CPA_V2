import { CockroachModulePanel } from './CockroachModulePanel';

export function PetSettingsTab() {
    return (
        <div className="settings-content-scroll">
            <div className="tab-pane pet-settings-pane">
                <CockroachModulePanel />
            </div>
        </div>
    );
}
