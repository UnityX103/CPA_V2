import { describe, it, expect, vi } from 'vitest';
import { createBindingKeyStore } from './bindingKey';
import * as dispatchMod from './bridge/dispatch';
import { BRIDGE_VERSION } from './bridge/protocol';

describe('createBindingKeyStore — settings-window mode', () => {
    it('addEntry dispatches and does not mutate local state', () => {
        const spy = vi.spyOn(dispatchMod, 'dispatch').mockResolvedValue();
        const store = createBindingKeyStore({ isSettingsWindow: true });
        const before = store.getState().entries.length;
        store.getState().addEntry();
        expect(store.getState().entries.length).toBe(before);
        expect(spy).toHaveBeenCalledWith(expect.objectContaining({
            v: BRIDGE_VERSION, store: 'bindingKey', action: 'addEntry', args: [],
        }));
        spy.mockRestore();
    });

    it('removeEntry, setSynced, beginCapture all dispatch', () => {
        const spy = vi.spyOn(dispatchMod, 'dispatch').mockResolvedValue();
        const store = createBindingKeyStore({ isSettingsWindow: true });
        store.getState().removeEntry('bk-1');
        store.getState().setSynced('bk-2');
        store.getState().beginCapture('bk-3');
        expect(spy).toHaveBeenCalledWith(expect.objectContaining({ v: BRIDGE_VERSION, store: 'bindingKey', action: 'removeEntry',  args: ['bk-1'] }));
        expect(spy).toHaveBeenCalledWith(expect.objectContaining({ v: BRIDGE_VERSION, store: 'bindingKey', action: 'setSynced',    args: ['bk-2'] }));
        expect(spy).toHaveBeenCalledWith(expect.objectContaining({ v: BRIDGE_VERSION, store: 'bindingKey', action: 'beginCapture', args: ['bk-3'] }));
        spy.mockRestore();
    });
});
