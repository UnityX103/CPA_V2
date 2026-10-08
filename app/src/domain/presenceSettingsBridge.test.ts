import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BRIDGE_VERSION } from './bridge/protocol';

const dispatch = vi.hoisted(() => vi.fn(async () => {}));
const dispatchConfirmed = vi.hoisted(() => vi.fn(async () => {}));

vi.mock('./bridge/dispatch', () => ({ dispatch, dispatchConfirmed }));

import { createPresenceStore } from './presence';

beforeEach(() => {
    dispatch.mockClear();
    dispatchConfirmed.mockClear();
});

describe('settings-window input activity settings', () => {
    it('dispatches input opt-in to the main window and waits for its acknowledgement', async () => {
        const store = createPresenceStore({ isSettingsWindow: true });
        await store.getState().applySettings({ inputActivityEnabled: true,
            restDeskReminderEnabled: false, restDeskReminderMode: 'cockroachInvasion' });
        expect(dispatchConfirmed).toHaveBeenCalledWith({ v: BRIDGE_VERSION, store: 'presence',
            action: 'applySettings', args: [{ inputActivityEnabled: true, restDeskReminderEnabled: false,
                restDeskReminderMode: 'cockroachInvasion' }] }, { replyTo: 'settings' });
        expect(store.getState().inputActivityEnabled).toBe(false);
        expect(dispatch).not.toHaveBeenCalled();
    });
});
