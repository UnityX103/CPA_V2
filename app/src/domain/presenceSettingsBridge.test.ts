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

describe('settings-window presence actions', () => {
    it('does not request camera access until the explicit action runs', async () => {
        const store = createPresenceStore({ isSettingsWindow: true });

        expect(dispatch).not.toHaveBeenCalled();
        await store.getState().requestAccess();

        expect(dispatch).toHaveBeenCalledWith({
            v: BRIDGE_VERSION,
            store: 'presence',
            action: 'requestAccess',
            args: [],
        });
    });

    it.each([
        ['retry', 'retry'],
        ['openPrivacySettings', 'openPrivacySettings'],
    ] as const)('dispatches %s to the authoritative main-window store', async (method, action) => {
        const store = createPresenceStore({ isSettingsWindow: true });

        await store.getState()[method]();

        expect(dispatch).toHaveBeenCalledWith({
            v: BRIDGE_VERSION,
            store: 'presence',
            action,
            args: [],
        });
    });
});
