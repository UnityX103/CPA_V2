import { useEffect, useRef } from 'react';
import {
    buildCloudAccountData,
    cloudAccountDataKey,
    hydrateCloudAccountData,
} from './cloudAccountData';
import { useCheckinStore } from './checkin';
import { useNetworkStore } from './network';
import { usePomodoroStore } from './pomodoro';
import { useSettingsStore } from './settings';
import { useAppUpdateStore } from './appUpdate';
import { useBindingKeyStore } from './bindingKey';
import { savePersistedUserPreferences } from './userPreferencesPersistence';

const SAVE_DEBOUNCE_MS = 1000;

export function useCloudAccountSync(opts: { enabled?: boolean } = {}) {
    const enabled = opts.enabled ?? true;
    const hydratingRef = useRef(false);
    const lastAppliedCloudKeyRef = useRef('');
    const lastSavedLocalKeyRef = useRef('');
    const saveTimerRef = useRef<number | null>(null);

    useEffect(() => {
        if (!enabled) return () => {};

        const stores = {
            pomodoro: usePomodoroStore,
            settings: useSettingsStore,
            appUpdate: useAppUpdateStore,
            network: useNetworkStore,
            bindingKey: useBindingKeyStore,
            checkin: useCheckinStore,
        };

        const clearTimer = () => {
            if (saveTimerRef.current != null) {
                window.clearTimeout(saveTimerRef.current);
                saveTimerRef.current = null;
            }
        };

        const saveNow = () => {
            const net = useNetworkStore.getState();
            if (net.accountStatus !== 'loggedIn') return;
            const snapshot = buildCloudAccountData(stores);
            const key = cloudAccountDataKey(snapshot);
            if (key === lastSavedLocalKeyRef.current || key === lastAppliedCloudKeyRef.current) return;
            lastSavedLocalKeyRef.current = key;
            net.saveUserData(snapshot, net.cloudDataUpdatedAt);
        };

        const scheduleSave = () => {
            if (hydratingRef.current) return;
            if (useNetworkStore.getState().accountStatus !== 'loggedIn') return;
            clearTimer();
            saveTimerRef.current = window.setTimeout(saveNow, SAVE_DEBOUNCE_MS);
        };

        const unsubNetwork = useNetworkStore.subscribe((state, previous) => {
            if (state.autoConnect !== previous.autoConnect || state.playerName !== previous.playerName) {
                scheduleSave();
            }

            if (state.accountStatus !== 'loggedIn') {
                clearTimer();
                lastAppliedCloudKeyRef.current = '';
                lastSavedLocalKeyRef.current = '';
                return;
            }

            const becameLoggedIn = previous.accountStatus !== 'loggedIn';
            const cloudChanged = state.cloudData !== previous.cloudData;
            const completedEmptyPull = state.cloudSyncStatus === 'synced'
                && previous.cloudSyncStatus !== 'synced'
                && state.cloudData == null;

            if ((becameLoggedIn || completedEmptyPull) && !state.cloudData) {
                saveNow();
                return;
            }
            if (!cloudChanged || !state.cloudData) return;

            hydratingRef.current = true;
            hydrateCloudAccountData({ stores, data: state.cloudData });
            void savePersistedUserPreferences(buildCloudAccountData(stores));
            lastAppliedCloudKeyRef.current = cloudAccountDataKey(state.cloudData);
            lastSavedLocalKeyRef.current = lastAppliedCloudKeyRef.current;
            hydratingRef.current = false;
        });

        const unsubPomodoro = usePomodoroStore.subscribe((s, p) => {
            if (
                s.focusDurationSeconds !== p.focusDurationSeconds ||
                s.breakDurationSeconds !== p.breakDurationSeconds ||
                s.totalRounds !== p.totalRounds ||
                s.autoStartBreak !== p.autoStartBreak ||
                s.endActionMode !== p.endActionMode ||
                s.endActionVideo !== p.endActionVideo
            ) {
                scheduleSave();
            }
        });

        const unsubSettings = useSettingsStore.subscribe((s, p) => {
            if (
                s.committedUiScale !== p.committedUiScale ||
                s.autostartEnabled !== p.autostartEnabled
            ) {
                scheduleSave();
            }
        });

        const unsubAppUpdate = useAppUpdateStore.subscribe((s, p) => {
            if (s.autoUpdateEnabled !== p.autoUpdateEnabled) {
                scheduleSave();
            }
        });

        const unsubBindingKey = useBindingKeyStore.subscribe((s, p) => {
            if (
                s.panelEnabled !== p.panelEnabled ||
                s.entries !== p.entries ||
                s.syncedKeyId !== p.syncedKeyId
            ) {
                scheduleSave();
            }
        });

        const unsubCheckin = useCheckinStore.subscribe((s, p) => {
            if (s.weeklyPlan !== p.weeklyPlan || s.dailyRecords !== p.dailyRecords) {
                scheduleSave();
            }
        });

        return () => {
            clearTimer();
            unsubNetwork();
            unsubPomodoro();
            unsubSettings();
            unsubAppUpdate();
            unsubBindingKey();
            unsubCheckin();
        };
    }, [enabled]);
}
