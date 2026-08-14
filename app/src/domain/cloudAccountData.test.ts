import { beforeEach, describe, expect, it } from 'vitest';
import { useAppUpdateStore } from './appUpdate';
import { useBindingKeyStore } from './bindingKey';
import { buildCloudAccountData, hydrateCloudAccountData, mergeCloudAccountDataConflict } from './cloudAccountData';
import { useNetworkStore } from './network';
import { usePomodoroStore } from './pomodoro';
import { useSettingsStore } from './settings';

const stores = {
    pomodoro: usePomodoroStore,
    settings: useSettingsStore,
    appUpdate: useAppUpdateStore,
    network: useNetworkStore,
    bindingKey: useBindingKeyStore,
};

beforeEach(() => {
    usePomodoroStore.setState({ endActionMode: 'topWindow', autoPinAfterFocus: true });
    useSettingsStore.setState({ uiScale: 1, committedUiScale: 1, autostartEnabled: false });
    useNetworkStore.setState({ autoConnect: false, playerName: '我' });
});

describe('cloud account data', () => {
    it('builds the retained account snapshot', () => {
        const data = buildCloudAccountData(stores);

        expect(data.settings).toEqual({ uiScale: 1, autostartEnabled: false });
        expect(data.pomodoro.endActionMode).toBe('topWindow');
    });

    it('hydrates the retained account snapshot', () => {
        const snapshot = buildCloudAccountData(stores);
        snapshot.pomodoro.autoPinAfterFocus = false;

        hydrateCloudAccountData({ stores, data: snapshot });

        expect(usePomodoroStore.getState().endActionMode).toBe('topWindow');
        expect(usePomodoroStore.getState().autoPinAfterFocus).toBe(false);
    });

    it('uses the normalized server snapshot when resolving conflicts', () => {
        const local = buildCloudAccountData(stores);
        const server = { ...local, updatedAt: 42, settings: { ...local.settings, uiScale: 1.5 } };

        expect(mergeCloudAccountDataConflict({ server, local })).toEqual(expect.objectContaining({
            updatedAt: 42,
            settings: { uiScale: 1.5, autostartEnabled: false },
        }));
    });
});
