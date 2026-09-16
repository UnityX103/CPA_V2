import { beforeEach, describe, expect, it } from 'vitest';
import { useAppUpdateStore } from './appUpdate';
import { useBindingKeyStore } from './bindingKey';
import { buildCloudAccountData, hydrateCloudAccountData, mergeCloudAccountDataConflict } from './cloudAccountData';
import { useNetworkStore } from './network';
import { createPomodoroStore, usePomodoroStore } from './pomodoro';
import { useSettingsStore } from './settings';

const stores = {
    pomodoro: usePomodoroStore,
    settings: useSettingsStore,
    appUpdate: useAppUpdateStore,
    network: useNetworkStore,
    bindingKey: useBindingKeyStore,
};

beforeEach(() => {
    usePomodoroStore.setState({ endActionMode: 'topWindow', autoPinAfterFocus: true, playVideoOnBreakEnd: false });
    useSettingsStore.setState({ uiScale: 1, committedUiScale: 1, autostartEnabled: false });
    useNetworkStore.setState({ autoConnect: false, playerName: '我' });
});

describe('cloud account data', () => {
    it.each([true, false])('preserves in-session progress on cloud hydration when running=%s', (isRunning) => {
        const pomodoro = createPomodoroStore({ isSettingsWindow: false });
        const sessionStores = { ...stores, pomodoro };
        pomodoro.getState().applySettings(30 * 60, 10 * 60, 4, true, false);
        pomodoro.getState().start();
        pomodoro.getState().tick(60);
        if (!isRunning) pomodoro.getState().pause();
        const snapshot = buildCloudAccountData(sessionStores);

        hydrateCloudAccountData({ stores: sessionStores, data: snapshot });

        expect(pomodoro.getState()).toMatchObject({
            remainingSeconds: 29 * 60,
            currentPhase: 'focus',
            currentRound: 1,
            isRunning,
        });
    });

    it('builds the retained account snapshot', () => {
        const data = buildCloudAccountData(stores);

        expect(data.settings).toEqual({ uiScale: 1, autostartEnabled: false, breakPetMode: 'off' });
        expect(data.pomodoro.endActionMode).toBe('topWindow');
    });

    it('hydrates the retained account snapshot', () => {
        const snapshot = buildCloudAccountData(stores);
        snapshot.pomodoro.autoPinAfterFocus = false;
        snapshot.pomodoro.playVideoOnBreakEnd = true;

        hydrateCloudAccountData({ stores, data: snapshot });

        expect(usePomodoroStore.getState().endActionMode).toBe('topWindow');
        expect(usePomodoroStore.getState().autoPinAfterFocus).toBe(false);
        expect(usePomodoroStore.getState().playVideoOnBreakEnd).toBe(true);
        expect(buildCloudAccountData(stores).pomodoro.playVideoOnBreakEnd).toBe(true);
    });

    it('uses the normalized server snapshot when resolving conflicts', () => {
        const local = buildCloudAccountData(stores);
        const server = { ...local, updatedAt: 42, settings: { ...local.settings, uiScale: 1.5 } };

        expect(mergeCloudAccountDataConflict({ server, local })).toEqual(expect.objectContaining({
            updatedAt: 42,
            settings: { uiScale: 1.5, autostartEnabled: false, breakPetMode: 'off' },
        }));
    });
});
