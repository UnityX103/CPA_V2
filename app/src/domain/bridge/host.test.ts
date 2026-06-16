import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    applyDispatch,
    activeAppIdentitySig,
    activeAppSig,
    appUpdateSig,
    bindingKeySig,
    buildSnapshot,
    checkinSig,
    MIRROR_WINDOW_LABELS,
    networkSig,
    pomoSig,
    settingsSig,
} from './host';
import { useSettingsStore, type SettingsState } from '../settings';
import { usePomodoroStore, type PomodoroState } from '../pomodoro';
import { useNetworkStore, type NetworkStateShape } from '../network';
import { useBindingKeyStore } from '../bindingKey';
import { useActiveAppStore } from '../activeApp';
import { BRIDGE_VERSION } from './protocol';
import { useAppUpdateStore } from '../appUpdate';
import { REMOTE_PLAYER_WINDOW_LABELS } from '../remotePlayerWindowLabels';
import { defaultPlanTemplate, useCheckinStore } from '../checkin';

type BindingKeySigInput = Parameters<typeof bindingKeySig>[0];
type BindingKeyStateWithPermission = BindingKeySigInput & {
    permissionGranted: boolean;
    platform: 'macos' | 'windows' | 'other' | null;
};

const sampleEndActionVideo = {
    sourceKind: 'custom' as const,
    builtinVideoId: 'builtin-ocean',
    customVideoPath: '/Users/xpy/Videos/focus-complete.mp4',
};

const sampleRemoteState = {
    pomodoro: {
        phase: 1,
        remainingSeconds: 42,
        currentRound: 2,
        totalRounds: 4,
        isRunning: true,
    },
    activeApp: {
        name: 'Focus App',
        bundleId: 'com.example.focus',
        iconId: 'icon-focus',
    },
    bindingKey: {
        keyLabel: 'A',
        pressCount: 7,
    },
};

beforeEach(() => {
    useSettingsStore.setState({
        uiScale: 1.0,
        committedUiScale: 1.0,
        autostartEnabled: false,
        checkinEnabled: true,
        planPanelEnabled: true,
        dangerousChange: null,
        activeTab: 'pomodoro',
    });
    usePomodoroStore.setState({
        autoStartBreak: false,
        endActionMode: 'playVideo',
        endActionVideo: {
            sourceKind: 'builtin',
            builtinVideoId: 'default',
            customVideoPath: '',
        },
    });
    usePomodoroStore.getState().applyEndActionSettings('playVideo', {
        sourceKind: 'builtin',
        builtinVideoId: 'default',
        customVideoPath: '',
    });
    useNetworkStore.setState({
        autoConnect: false,
        playerName: '我',
        playerId: null,
        roomCode: '',
        status: 'idle',
        players: {},
        lastError: null,
    });
    useBindingKeyStore.setState({
        panelEnabled: true,
        entries: [],
        capturingId: null,
        syncedKeyId: null,
        permissionGranted: true,
        platform: null,
    });
    useActiveAppStore.setState({ current: null });
    useAppUpdateStore.setState({
        autoUpdateEnabled: true,
        status: 'idle',
        currentVersion: null,
        availableVersion: null,
        releaseNotes: null,
        lastCheckedAt: null,
        errorMessage: null,
    });
    useCheckinStore.setState({
        planTemplate: defaultPlanTemplate(),
        dailyRecords: {},
        lastError: null,
    });
});

describe('buildSnapshot', () => {
    it('reads from every source store and stamps the version', () => {
        useSettingsStore.setState({ uiScale: 1.5, committedUiScale: 1.5 });
        useSettingsStore.setState({ autostartEnabled: true });
        useSettingsStore.setState({ checkinEnabled: false });
        useSettingsStore.setState({ planPanelEnabled: false });
        usePomodoroStore.setState({ autoStartBreak: true });
        const snap = buildSnapshot();
        expect(snap.v).toBe(BRIDGE_VERSION);
        expect(snap.settings.uiScale).toBe(1.5);
        expect(snap.settings.autostartEnabled).toBe(true);
        expect(snap.settings.checkinEnabled).toBe(false);
        expect(snap.settings.planPanelEnabled).toBe(false);
        expect(('showActiveApp' + 'WindowTitle') in snap.settings).toBe(false);
        expect(('autoPinOn' + 'FocusEnd') in snap.settings).toBe(false);
        expect('targetMonitorIndex' in snap.settings).toBe(false);
        expect(snap.pomodoro.focusDurationSeconds).toBe(usePomodoroStore.getState().focusDurationSeconds);
        expect(snap.pomodoro.autoStartBreak).toBe(true);
        expect(snap.pomodoro.endActionMode).toBe(usePomodoroStore.getState().endActionMode);
        expect(snap.pomodoro.endActionVideo).toEqual(usePomodoroStore.getState().endActionVideo);
        expect(snap.network.status).toBe(useNetworkStore.getState().status);
        expect(snap.bindingKey.entries).toEqual(useBindingKeyStore.getState().entries);
        expect(snap.bindingKey.entries).not.toBe(useBindingKeyStore.getState().entries);
        expect(snap.appUpdate).toEqual({
            autoUpdateEnabled: true,
            status: 'idle',
            currentVersion: null,
            availableVersion: null,
            releaseNotes: null,
            lastCheckedAt: null,
            errorMessage: null,
        });
        expect(snap.checkin).toEqual({
            planTemplate: defaultPlanTemplate(),
            dailyRecords: {},
            lastError: null,
        });
    });

    it('detaches nested snapshot values from source store references', () => {
        useSettingsStore.getState().previewDangerousUiScale(1.5);
        usePomodoroStore.getState().applyEndActionSettings('playVideo', sampleEndActionVideo);
        useNetworkStore.setState({
            players: {
                'p-1': {
                    playerId: 'p-1',
                    playerName: 'Player One',
                    state: sampleRemoteState,
                },
            },
        });
        useBindingKeyStore.setState({
            entries: [{
                id: 'bk-1',
                label: 'A',
                keyCode: 0,
                input: { kind: 'keyboard', code: 0 },
                pressCount: 2,
                enabled: true,
            }],
        });
        useCheckinStore.setState({
            planTemplate: {
                ...defaultPlanTemplate(),
                items: [{
                    id: 'manual-1',
                    title: 'Read',
                    type: 'manual',
                    targetCount: 2,
                    repeatDays: ['mon'],
                    editMode: 'cycle',
                }],
            },
            dailyRecords: {
                '2026-05-18': {
                    date: '2026-05-18',
                    countsByItemId: { 'manual-1': 1 },
                    processedPomodoroEndEventIds: [42],
                },
            },
        });

        const snap = buildSnapshot();

        expect(snap.settings.dangerousChange).toEqual(useSettingsStore.getState().dangerousChange);
        expect(snap.settings.dangerousChange).not.toBe(useSettingsStore.getState().dangerousChange);
        expect(snap.pomodoro.endActionVideo).toEqual(usePomodoroStore.getState().endActionVideo);
        expect(snap.pomodoro.endActionVideo).not.toBe(usePomodoroStore.getState().endActionVideo);
        expect(snap.network.players).toEqual(useNetworkStore.getState().players);
        expect(snap.network.players).not.toBe(useNetworkStore.getState().players);
        expect(snap.network.players['p-1']).not.toBe(useNetworkStore.getState().players['p-1']);
        expect(snap.network.players['p-1'].state).not.toBe(useNetworkStore.getState().players['p-1'].state);
        expect(snap.network.players['p-1'].state?.pomodoro).not.toBe(useNetworkStore.getState().players['p-1'].state?.pomodoro);
        expect(snap.network.players['p-1'].state?.activeApp).not.toBe(useNetworkStore.getState().players['p-1'].state?.activeApp);
        expect(snap.network.players['p-1'].state?.bindingKey).not.toBe(useNetworkStore.getState().players['p-1'].state?.bindingKey);
        expect(snap.bindingKey.entries).toEqual(useBindingKeyStore.getState().entries);
        expect(snap.bindingKey.entries).not.toBe(useBindingKeyStore.getState().entries);
        expect(snap.bindingKey.entries[0]).not.toBe(useBindingKeyStore.getState().entries[0]);
        expect(snap.checkin.planTemplate).toEqual(useCheckinStore.getState().planTemplate);
        expect(snap.checkin.planTemplate).not.toBe(useCheckinStore.getState().planTemplate);
        expect(snap.checkin.planTemplate.items).not.toBe(useCheckinStore.getState().planTemplate.items);
        expect(snap.checkin.planTemplate.items[0]).not.toBe(useCheckinStore.getState().planTemplate.items[0]);
        expect(snap.checkin.dailyRecords).toEqual(useCheckinStore.getState().dailyRecords);
        expect(snap.checkin.dailyRecords).not.toBe(useCheckinStore.getState().dailyRecords);
        expect(snap.checkin.dailyRecords['2026-05-18']).not.toBe(useCheckinStore.getState().dailyRecords['2026-05-18']);

        snap.settings.dangerousChange!.nextValue = 2.0;
        snap.pomodoro.endActionVideo.customVideoPath = '/mutated.mp4';
        snap.network.players['p-1'].playerName = 'Mutated';
        snap.network.players['p-1'].state!.pomodoro.remainingSeconds = 1;
        snap.network.players['p-1'].state!.activeApp!.name = 'Mutated App';
        snap.network.players['p-1'].state!.bindingKey!.pressCount = 99;
        snap.bindingKey.entries[0].label = 'Mutated';
        snap.bindingKey.entries[0].input = { kind: 'mouse', button: 'right' };
        snap.checkin.dailyRecords['2026-05-18'].countsByItemId['manual-1'] = 99;
        snap.checkin.planTemplate.items[0].title = 'Mutated';

        expect(useSettingsStore.getState().dangerousChange?.nextValue).toBe(1.5);
        expect(usePomodoroStore.getState().endActionVideo.customVideoPath).toBe('/Users/xpy/Videos/focus-complete.mp4');
        expect(useNetworkStore.getState().players['p-1'].playerName).toBe('Player One');
        expect(useNetworkStore.getState().players['p-1'].state?.pomodoro.remainingSeconds).toBe(42);
        expect(useNetworkStore.getState().players['p-1'].state?.activeApp?.name).toBe('Focus App');
        expect(useNetworkStore.getState().players['p-1'].state?.bindingKey?.pressCount).toBe(7);
        expect(useBindingKeyStore.getState().entries[0].label).toBe('A');
        expect(useBindingKeyStore.getState().entries[0].input).toEqual({ kind: 'keyboard', code: 0 });
        expect(useCheckinStore.getState().dailyRecords['2026-05-18'].countsByItemId['manual-1']).toBe(1);
        expect(useCheckinStore.getState().planTemplate.items[0].title).toBe('Read');
    });

    it('includes committed scale and dangerous change state', () => {
        useSettingsStore.getState().previewDangerousUiScale(1.5);
        const snap = buildSnapshot();

        expect(snap.settings.uiScale).toBe(1.5);
        expect(snap.settings.committedUiScale).toBe(1.0);
        expect(snap.settings.dangerousChange).toEqual(expect.objectContaining({
            kind: 'uiScale',
            previousValue: 1.0,
            nextValue: 1.5,
        }));
    });

    it('omits active app icon data by default for lightweight store-change snapshots', () => {
        useActiveAppStore.setState({
            current: {
                name: 'Rider',
                bundle_id: 'com.jetbrains.rider',
                window_title: 'CPA_V2',
                icon_data_url: 'data:image/png;base64,heavy-icon',
            },
        });

        const snap = buildSnapshot();

        expect(snap.activeApp).toEqual({
            name: 'Rider',
            bundle_id: 'com.jetbrains.rider',
            window_title: 'CPA_V2',
        });
        expect(snap.activeApp).not.toHaveProperty('icon_data_url');
    });

    it('can include active app icon data for explicit requests and active-app-change sends', () => {
        useActiveAppStore.setState({
            current: {
                name: 'Rider',
                bundle_id: 'com.jetbrains.rider',
                window_title: 'CPA_V2',
                icon_data_url: 'data:image/png;base64,heavy-icon',
            },
        });

        const snap = buildSnapshot({ includeActiveAppIcon: true });

        expect(snap.activeApp?.icon_data_url).toBe('data:image/png;base64,heavy-icon');
    });

    it('does NOT include transient timer fields like remainingSeconds', () => {
        const snap = buildSnapshot();
        // @ts-expect-error remainingSeconds is intentionally absent from the snapshot type
        expect(snap.pomodoro.remainingSeconds).toBeUndefined();
    });
});

describe('bridge host mirror targets', () => {
    it('emits snapshots to settings, check-in windows, input-counter, and all fixed remote player windows', () => {
        expect(MIRROR_WINDOW_LABELS).toEqual([
            'settings',
            'today-checkin',
            'checkin-editor',
            'input-counter',
            ...REMOTE_PLAYER_WINDOW_LABELS,
        ]);
    });
});

describe('applyDispatch', () => {
    it('routes settings dangerous preview/apply/revert actions', () => {
        applyDispatch({ v: BRIDGE_VERSION, store: 'settings', action: 'previewDangerousUiScale', args: [1.75] });
        const id = useSettingsStore.getState().dangerousChange!.id;
        expect(useSettingsStore.getState().uiScale).toBe(1.75);

        applyDispatch({ v: BRIDGE_VERSION, store: 'settings', action: 'revertDangerousChange', args: [id] });
        expect(useSettingsStore.getState().uiScale).toBe(1.0);

        applyDispatch({ v: BRIDGE_VERSION, store: 'settings', action: 'previewDangerousUiScale', args: [2.0] });
        const applyId = useSettingsStore.getState().dangerousChange!.id;
        applyDispatch({ v: BRIDGE_VERSION, store: 'settings', action: 'applyDangerousChange', args: [applyId] });
        expect(useSettingsStore.getState().committedUiScale).toBe(2.0);
    });

    it('routes autostart setting to the authoritative settings store', () => {
        const original = useSettingsStore.getState().setAutostartEnabled;
        const setAutostartEnabled = vi.fn();
        useSettingsStore.setState({ setAutostartEnabled });

        try {
            applyDispatch({
                v: BRIDGE_VERSION,
                store: 'settings',
                action: 'setAutostartEnabled',
                args: [true],
            });

            expect(setAutostartEnabled).toHaveBeenCalledWith(true);
        } finally {
            useSettingsStore.setState({ setAutostartEnabled: original });
        }
    });

    it('routes checkin enabled setting to the authoritative settings store', () => {
        useSettingsStore.setState({ checkinEnabled: true });

        applyDispatch({
            v: BRIDGE_VERSION,
            store: 'settings',
            action: 'setCheckinEnabled',
            args: [false],
        });

        expect(useSettingsStore.getState().checkinEnabled).toBe(false);
    });

    it('routes plan panel enabled setting to the authoritative settings store', () => {
        useSettingsStore.setState({ planPanelEnabled: true });

        applyDispatch({
            v: BRIDGE_VERSION,
            store: 'settings',
            action: 'setPlanPanelEnabled',
            args: [false],
        });

        expect(useSettingsStore.getState().planPanelEnabled).toBe(false);
    });

    it('routes pomodoro/applySettings to usePomodoroStore.applySettings', () => {
        applyDispatch({ v: BRIDGE_VERSION, store: 'pomodoro', action: 'applySettings', args: [900, 180, 5, true, true] });

        const state = usePomodoroStore.getState();
        expect(state.focusDurationSeconds).toBe(900);
        expect(state.breakDurationSeconds).toBe(180);
        expect(state.totalRounds).toBe(5);
        expect(state.autoStartBreak).toBe(true);
    });

    it('routes pomodoro/applyEndActionSettings to the main pomodoro store', () => {
        applyDispatch({
            v: BRIDGE_VERSION,
            store: 'pomodoro',
            action: 'applyEndActionSettings',
            args: ['topWindow', sampleEndActionVideo],
        });

        expect(usePomodoroStore.getState().endActionMode).toBe('topWindow');
        expect(usePomodoroStore.getState().endActionVideo).toEqual(sampleEndActionVideo);
    });

    it('ignores payloads with a mismatched bridge version', () => {
        const before = useSettingsStore.getState().uiScale;
        applyDispatch({ v: 999 as 1, store: 'settings', action: 'setUiScale', args: [2.5] });
        expect(useSettingsStore.getState().uiScale).toBe(before);
    });

    it('routes binding-key add/capture/panel actions to the authoritative main store', () => {
        applyDispatch({ v: BRIDGE_VERSION, store: 'bindingKey', action: 'setPanelEnabled', args: [false] });
        expect(useBindingKeyStore.getState().panelEnabled).toBe(false);

        applyDispatch({ v: BRIDGE_VERSION, store: 'bindingKey', action: 'addEntry', args: [] });
        const entry = useBindingKeyStore.getState().entries[0];
        expect(entry).toEqual(expect.objectContaining({
            label: '未绑定',
            keyCode: -1,
            pressCount: 0,
            enabled: true,
        }));
        expect(useBindingKeyStore.getState().capturingId).toBe(entry.id);

        useBindingKeyStore.getState().cancelCapture();
        applyDispatch({ v: BRIDGE_VERSION, store: 'bindingKey', action: 'beginCapture', args: [entry.id] });
        expect(useBindingKeyStore.getState().capturingId).toBe(entry.id);

        applyDispatch({
            v: BRIDGE_VERSION,
            store: 'bindingKey',
            action: 'completeCapture',
            args: [{ kind: 'mouse', button: 'left' }, '鼠标左键'],
        });
        expect(useBindingKeyStore.getState().capturingId).toBe(null);
        expect(useBindingKeyStore.getState().entries[0]).toEqual(expect.objectContaining({
            keyCode: -1,
            input: { kind: 'mouse', button: 'left' },
            label: '鼠标左键',
            pressCount: 0,
        }));
    });

    it('routes app-update actions to the authoritative main store', () => {
        const original = {
            setAutoUpdateEnabled: useAppUpdateStore.getState().setAutoUpdateEnabled,
            checkNow: useAppUpdateStore.getState().checkNow,
            restartForUpdate: useAppUpdateStore.getState().restartForUpdate,
        };
        const setAutoUpdateEnabled = vi.fn(async () => {});
        const checkNow = vi.fn(async () => {});
        const restartForUpdate = vi.fn(async () => {});
        useAppUpdateStore.setState({
            setAutoUpdateEnabled,
            checkNow,
            restartForUpdate,
        });

        applyDispatch({
            v: BRIDGE_VERSION,
            store: 'appUpdate',
            action: 'setAutoUpdateEnabled',
            args: [false],
        });
        applyDispatch({ v: BRIDGE_VERSION, store: 'appUpdate', action: 'checkNow', args: [] });
        applyDispatch({ v: BRIDGE_VERSION, store: 'appUpdate', action: 'restartForUpdate', args: [] });

        expect(setAutoUpdateEnabled).toHaveBeenCalledWith(false);
        expect(checkNow).toHaveBeenCalledTimes(1);
        expect(restartForUpdate).toHaveBeenCalledTimes(1);
        useAppUpdateStore.setState(original);
    });

    it('routes checkin plan and item increment actions to the authoritative main store', () => {
        const nextTemplate = {
            ...defaultPlanTemplate(),
            items: [{ ...defaultPlanTemplate().items[0], repeatDays: ['mon' as const] }],
        };

        applyDispatch({
            v: BRIDGE_VERSION,
            store: 'checkin',
            action: 'setPlanTemplate',
            args: [nextTemplate],
        });
        applyDispatch({
            v: BRIDGE_VERSION,
            store: 'checkin',
            action: 'incrementItem',
            args: ['2026-05-25', 'pomodoro-focus'],
        });

        expect(useCheckinStore.getState().planTemplate).toEqual(nextTemplate);
        expect(useCheckinStore.getState().dailyRecords['2026-05-25'].countsByItemId['pomodoro-focus']).toBe(1);
    });
});

describe('bridge host subscription signatures', () => {
    it('settingsSig ignores settings-window-local fields and includes mirrored fields', () => {
        const pomodoroTabSettings: SettingsState = {
            uiScale: 1.25,
            committedUiScale: 1.25,
            autostartEnabled: false,
            checkinEnabled: true,
            planPanelEnabled: true,
            dangerousChange: null,
            activeTab: 'pomodoro',
        };
        const globalTabSettings: SettingsState = {
            ...pomodoroTabSettings,
            activeTab: 'global',
        };
        const scaledSettings: SettingsState = {
            ...pomodoroTabSettings,
            uiScale: 1.5,
        };
        const autostartSettings: SettingsState = {
            ...pomodoroTabSettings,
            autostartEnabled: true,
        };
        const disabledCheckinSettings: SettingsState = {
            ...pomodoroTabSettings,
            checkinEnabled: false,
        };
        const disabledPlanPanelSettings: SettingsState = {
            ...pomodoroTabSettings,
            planPanelEnabled: false,
        };

        expect(settingsSig(pomodoroTabSettings)).toBe(settingsSig(globalTabSettings));
        expect(settingsSig(pomodoroTabSettings)).not.toBe(settingsSig(scaledSettings));
        expect(settingsSig(pomodoroTabSettings)).not.toBe(settingsSig(autostartSettings));
        expect(settingsSig(pomodoroTabSettings)).not.toBe(settingsSig(disabledCheckinSettings));
        expect(settingsSig(pomodoroTabSettings)).not.toBe(settingsSig(disabledPlanPanelSettings));
    });

    it('pomoSig includes end-action settings and ignores transient timer fields', () => {
        const base: PomodoroState = {
            ...usePomodoroStore.getState(),
            endActionMode: 'playVideo' as const,
            endActionVideo: sampleEndActionVideo,
        };
        const oneSecondRemaining: PomodoroState = { ...base, remainingSeconds: 1 };
        const ninetyNineSecondsRemaining: PomodoroState = { ...base, remainingSeconds: 99 };
        const topWindowEndAction: PomodoroState = { ...base, endActionMode: 'topWindow' };
        const otherVideo: PomodoroState = {
            ...base,
            endActionVideo: { ...sampleEndActionVideo, customVideoPath: '/other.mp4' },
        };

        expect(pomoSig(oneSecondRemaining)).toBe(pomoSig(ninetyNineSecondsRemaining));
        expect(pomoSig(base)).not.toBe(pomoSig(topWindowEndAction));
        expect(pomoSig(base)).not.toBe(pomoSig(otherVideo));
    });

    it('pomoSig avoids delimiter collisions in end-action video fields', () => {
        const base: PomodoroState = {
            ...usePomodoroStore.getState(),
            endActionMode: 'playVideo' as const,
        };

        expect(pomoSig({
            ...base,
            endActionVideo: {
                sourceKind: 'custom',
                builtinVideoId: 'id|path',
                customVideoPath: 'tail',
            },
        })).not.toBe(pomoSig({
            ...base,
            endActionVideo: {
                sourceKind: 'custom',
                builtinVideoId: 'id',
                customVideoPath: 'path|tail',
            },
        }));
    });

    it('networkSig ignores omitted network fields and includes mirrored fields', () => {
        const base: NetworkStateShape = {
            ...useNetworkStore.getState(),
            status: 'joined' as const,
            serverUrl: 'ws://one.example',
            players: {
                'p-1': {
                    playerId: 'p-1',
                    playerName: 'Player One',
                    state: null,
                },
            },
        };
        const otherServer: NetworkStateShape = { ...base, serverUrl: 'ws://two.example' };
        const renamedPlayer: NetworkStateShape = {
            ...base,
            players: {
                'p-1': {
                    playerId: 'p-1',
                    playerName: 'Renamed',
                    state: null,
                },
            },
        };

        expect(networkSig(base)).toBe(networkSig(otherServer));
        expect(networkSig(base)).not.toBe(networkSig(renamedPlayer));
    });

    it('bindingKeySig ignores omitted permission fields and includes mirrored fields', () => {
        const base: BindingKeyStateWithPermission = {
            ...useBindingKeyStore.getState(),
            permissionGranted: true,
            platform: 'macos' as const,
            entries: [{
                id: 'bk-1',
                label: 'A',
                keyCode: 0,
                pressCount: 1,
                enabled: true,
            }],
            syncedKeyId: 'bk-1',
        };
        const deniedPermission: BindingKeyStateWithPermission = {
            ...base,
            permissionGranted: false,
            platform: 'windows',
        };
        const incrementedEntry: BindingKeyStateWithPermission = {
            ...base,
            entries: [{ ...base.entries[0], pressCount: 2 }],
        };

        expect(bindingKeySig(base)).toBe(bindingKeySig(deniedPermission));
        expect(bindingKeySig(base)).not.toBe(bindingKeySig(incrementedEntry));
    });

    it('appUpdateSig includes mirrored update status fields', () => {
        const base = {
            autoUpdateEnabled: true,
            status: 'upToDate' as const,
            currentVersion: '0.1.0',
            availableVersion: null,
            releaseNotes: null,
            lastCheckedAt: 1700000000000,
            errorMessage: null,
        };
        const disabled = { ...base, autoUpdateEnabled: false };
        const checkedLater = { ...base, lastCheckedAt: 1700000100000 };

        expect(appUpdateSig(base)).not.toBe(appUpdateSig(disabled));
        expect(appUpdateSig(base)).not.toBe(appUpdateSig(checkedLater));
    });

    it('checkinSig includes mirrored plan, records, and error fields', () => {
        const base = {
            planTemplate: defaultPlanTemplate(),
            dailyRecords: {
                '2026-05-18': {
                    date: '2026-05-18',
                    countsByItemId: { 'pomodoro-focus': 1 },
                    processedPomodoroEndEventIds: [1],
                },
            },
            lastError: null,
        };
        const nextCount = {
            ...base,
            dailyRecords: {
                '2026-05-18': {
                    ...base.dailyRecords['2026-05-18'],
                    countsByItemId: { 'pomodoro-focus': 2 },
                },
            },
        };
        const nextError = { ...base, lastError: 'save failed' };

        expect(checkinSig(base)).not.toBe(checkinSig(nextCount));
        expect(checkinSig(base)).not.toBe(checkinSig(nextError));
    });

    it('activeAppSig ignores heavy icon data but includes title changes', () => {
        const base = {
            current: {
                name: 'Rider',
                bundle_id: 'com.jetbrains.rider',
                window_title: 'CPA_V2',
                icon_data_url: 'data:image/png;base64,first-heavy-icon',
            },
        };
        const sameMetadataNewIcon = {
            current: {
                ...base.current,
                icon_data_url: 'data:image/png;base64,second-heavy-icon',
            },
        };
        const renamedWindow = {
            current: {
                ...base.current,
                window_title: 'host.ts - CPA_V2',
            },
        };

        expect(activeAppSig(base)).toBe(activeAppSig(sameMetadataNewIcon));
        expect(activeAppSig(base)).not.toBe(activeAppSig(renamedWindow));
    });

    it('activeAppIdentitySig changes only when the foreground app identity changes', () => {
        const rider = {
            current: {
                name: 'Rider',
                bundle_id: 'com.jetbrains.rider',
                window_title: 'CPA_V2',
                icon_data_url: 'data:image/png;base64,rider-icon',
            },
        };
        const riderOtherTitle = {
            current: {
                ...rider.current,
                window_title: 'client.ts - CPA_V2',
            },
        };
        const safari = {
            current: {
                name: 'Safari',
                bundle_id: 'com.apple.Safari',
                window_title: 'Docs',
                icon_data_url: 'data:image/png;base64,safari-icon',
            },
        };

        expect(activeAppIdentitySig(rider)).toBe(activeAppIdentitySig(riderOtherTitle));
        expect(activeAppIdentitySig(rider)).not.toBe(activeAppIdentitySig(safari));
    });
});
