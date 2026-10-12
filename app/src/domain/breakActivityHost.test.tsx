import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useBreakActivityHost } from './breakActivityHost';
import { useSettingsStore } from './settings';
import { useExtensionPackStore } from './extensionPacks';
import { BREAK_ACTIVITY_STATE_EVENT } from './breakActivity';
const emitTo = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('@tauri-apps/api/event', () => ({ emitTo, listen: vi.fn(async () => () => {}) }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => {}), isTauri: () => true }));
afterEach(cleanup);
function Host() { useBreakActivityHost({ enabled: true }); return null; }
it('publishes the current output device and pushes changes to an already loaded activity window', async () => {
    useExtensionPackStore.setState((state) => ({ statuses: { ...state.statuses,
        'wellness.kegel': { ...state.statuses['wellness.kegel'], installed: true, enabled: true },
    } }));
    useSettingsStore.setState({ audioOutputDeviceId: 'wasapi:headphones' });
    render(<Host />);
    await act(async () => {});
    // A settings change must reach an idle loaded window as well, before the
    // next break or first bell is started.
    act(() => useSettingsStore.setState({ audioOutputDeviceId: 'coreaudio:external-dac' }));
    await waitFor(() => expect(emitTo).toHaveBeenCalledWith('kegel', BREAK_ACTIVITY_STATE_EVENT,
        expect.objectContaining({ audioOutputDeviceId: 'coreaudio:external-dac' })));
    act(() => useSettingsStore.setState({ audioOutputDeviceId: null }));
    await waitFor(() => expect(emitTo).toHaveBeenCalledWith('kegel', BREAK_ACTIVITY_STATE_EVENT,
        expect.objectContaining({ audioOutputDeviceId: null })));
});
