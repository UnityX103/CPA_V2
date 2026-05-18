import { useAppUpdateStore } from '../domain/appUpdate';
import './AppUpdateReadyNotice.css';

function titleText(version: string | null): string {
    return version ? `新版本 ${version} 已准备好` : '新版本已准备好';
}

export function AppUpdateReadyNotice() {
    const status = useAppUpdateStore((s) => s.status);
    const availableVersion = useAppUpdateStore((s) => s.availableVersion);
    const restartForUpdate = useAppUpdateStore((s) => s.restartForUpdate);

    if (status !== 'readyToRestart') return null;

    return (
        <div className="app-update-ready-notice" role="status">
            <div className="app-update-ready-notice__copy">
                <div className="app-update-ready-notice__title">{titleText(availableVersion)}</div>
                <div className="app-update-ready-notice__body">重启应用后生效</div>
            </div>
            <button
                className="app-update-ready-notice__button"
                type="button"
                onClick={() => { void restartForUpdate(); }}
            >
                重启更新
            </button>
        </div>
    );
}
