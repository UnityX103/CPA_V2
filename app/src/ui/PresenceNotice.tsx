import { useEffect } from 'react';
import { usePresenceStore } from '../domain/presence';
import './PresenceNotice.css';

export function PresenceNotice() {
    const current = usePresenceStore((state) => state.notice);

    useEffect(() => {
        if (!current) return undefined;
        const timeout = window.setTimeout(() => {
            if (usePresenceStore.getState().notice?.id === current.id) {
                usePresenceStore.setState({ notice: null });
            }
        }, 4000);
        return () => window.clearTimeout(timeout);
    }, [current]);

    if (!current) return null;
    return (
        <div className="presence-notice" role="status">
            {current.message}
        </div>
    );
}
