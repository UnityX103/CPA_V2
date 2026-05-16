import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, it, expect, beforeEach } from 'vitest';
import { applyDispatch, buildSnapshot } from './host';
import { useSettingsStore } from '../settings';
import { usePomodoroStore } from '../pomodoro';
import { useNetworkStore } from '../network';
import { useBindingKeyStore } from '../bindingKey';
import { BRIDGE_VERSION } from './protocol';

const sampleEndActionVideo = {
    sourceKind: 'custom' as const,
    builtinVideoId: 'builtin-ocean',
    customVideoPath: '/Users/xpy/Videos/focus-complete.mp4',
};

beforeEach(() => {
    useSettingsStore.setState({ uiScale: 1.0, activeTab: 'pomodoro' });
    usePomodoroStore.getState().applyEndActionSettings('playVideo', {
        sourceKind: 'builtin',
        builtinVideoId: 'default',
        customVideoPath: '',
    });
});

describe('buildSnapshot', () => {
    it('reads from every source store and stamps the version', () => {
        useSettingsStore.setState({ uiScale: 1.5 });
        const snap = buildSnapshot();
        expect(snap.v).toBe(BRIDGE_VERSION);
        expect(snap.settings.uiScale).toBe(1.5);
        expect('targetMonitorIndex' in snap.settings).toBe(false);
        expect(snap.pomodoro.focusDurationSeconds).toBe(usePomodoroStore.getState().focusDurationSeconds);
        expect(snap.pomodoro.endActionMode).toBe(usePomodoroStore.getState().endActionMode);
        expect(snap.pomodoro.endActionVideo).toEqual(usePomodoroStore.getState().endActionVideo);
        expect(snap.network.status).toBe(useNetworkStore.getState().status);
        expect(snap.bindingKey.entries).toBe(useBindingKeyStore.getState().entries);
    });

    it('does NOT include transient timer fields like remainingSeconds', () => {
        const snap = buildSnapshot();
        // @ts-expect-error remainingSeconds is intentionally absent from the snapshot type
        expect(snap.pomodoro.remainingSeconds).toBeUndefined();
    });
});

describe('applyDispatch', () => {
    it('routes settings/setUiScale to useSettingsStore.setUiScale', () => {
        applyDispatch({ v: BRIDGE_VERSION, store: 'settings', action: 'setUiScale', args: [1.75] });
        expect(useSettingsStore.getState().uiScale).toBe(1.75);
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

    it('includes end-action settings in the pomodoro subscription signature', () => {
        const here = path.dirname(fileURLToPath(import.meta.url));
        const host = readFileSync(path.join(here, 'host.ts'), 'utf8');
        const pomoSigBody = host.match(/function pomoSig[\s\S]*?\n}/)?.[0] ?? '';

        expect(pomoSigBody).toContain('endActionMode');
        expect(pomoSigBody).toContain('endActionVideo');
    });

    it('ignores payloads with a mismatched bridge version', () => {
        const before = useSettingsStore.getState().uiScale;
        applyDispatch({ v: 999 as 1, store: 'settings', action: 'setUiScale', args: [2.5] });
        expect(useSettingsStore.getState().uiScale).toBe(before);
    });
});
