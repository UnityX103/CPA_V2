import { useSettingsStore } from '../domain/settings';
import { CockroachModulePanel } from './CockroachModulePanel';

export function PetSettingsTab() {
    const mode = useSettingsStore((state) => state.breakPetMode);
    const setMode = useSettingsStore((state) => state.setBreakPetMode);
    return (
        <div className="settings-content-scroll">
            <div className="tab-pane pet-settings-pane">
                <section className="card pet-settings-selector">
                    <div>
                        <h3 className="card-title">休息宠物</h3>
                        <p>进入休息提醒条件后自动启动，休息结束时自动退出。</p>
                    </div>
                    <div className="pet-settings-options" role="group" aria-label="休息宠物选择">
                        <button
                            type="button"
                            className={`pet-settings-option ${mode === 'off' ? 'selected' : ''}`}
                            aria-label="关闭休息宠物"
                            aria-pressed={mode === 'off'}
                            onClick={() => setMode('off')}
                        >
                            关闭
                        </button>
                        <button
                            type="button"
                            className={`pet-settings-option ${mode === 'cockroachInvasion' ? 'selected' : ''}`}
                            aria-label="选择蟑螂入侵"
                            aria-pressed={mode === 'cockroachInvasion'}
                            onClick={() => setMode('cockroachInvasion')}
                        >
                            蟑螂入侵
                        </button>
                    </div>
                </section>
                {mode === 'cockroachInvasion' ? <CockroachModulePanel /> : null}
            </div>
        </div>
    );
}
