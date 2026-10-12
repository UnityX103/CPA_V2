import { useEffect, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { loadKegelPreferences, saveKegelSettings, type KegelPreferences } from '../../feature-packs/kegel/src/api';
import { KegelSettingsForm, KegelStatistics } from '../../feature-packs/kegel/src/SettingsForm';
import type { KegelSettings } from '../../feature-packs/kegel/src/domain/kegel';
import './Kegel.css';

/** Trusted settings adapter; installation and enablement live in the manager. */
export function KegelSettingsTab() {
    const [preferences, setPreferences] = useState<KegelPreferences | null>(null);
    const [error, setError] = useState('');
    useEffect(() => {
        let disposed = false;
        let cleanup: (() => void) | null = null;
        const refresh = () => {
            void loadKegelPreferences().then((value) => { if (!disposed) { setPreferences(value); setError(''); } })
                .catch((reason) => { if (!disposed) setError(String(reason)); });
        };
        refresh();
        void listen('kegel-module-data-changed', refresh).then((unlisten) => {
            if (disposed) unlisten(); else cleanup = unlisten;
        });
        return () => { disposed = true; cleanup?.(); };
    }, []);
    const apply = async (settings: KegelSettings) => {
        await saveKegelSettings(settings);
        setPreferences(await loadKegelPreferences());
    };
    return <div className="settings-content-scroll"><div className="tab-pane kegel-settings-tab">
        <h3>凯格尔运动</h3>
        <p className="kegel-form-note">休息时点击泡泡开始，再次点击暂停。模块开关在“扩展包”中管理。</p>
        {error && <p role="alert">{error}</p>}
        {preferences && <><KegelStatistics history={preferences.history} />
            <KegelSettingsForm settings={preferences.settings} apply={apply} /></>}
    </div></div>;
}
