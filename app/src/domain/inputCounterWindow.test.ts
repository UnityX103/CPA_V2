import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useBindingKeyStore } from './bindingKey';
import { useInputCounterWindowController } from './inputCounterWindow';

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));

beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValue(undefined);
    useBindingKeyStore.setState({
        panelEnabled: true,
        entries: [],
        syncedKeyId: null,
        capturingId: null,
        permissionGranted: true,
        platform: null,
    });
});

describe('useInputCounterWindowController', () => {
    it('keeps the independent panel hidden when enabled but no key is bound', async () => {
        renderHook(() => useInputCounterWindowController());

        await waitFor(() => {
            expect(invokeMock).toHaveBeenCalledWith('hide_input_counter_window');
        });
        expect(invokeMock).not.toHaveBeenCalledWith('show_input_counter_window');
    });

    it('shows the independent panel after an enabled key becomes bound', async () => {
        renderHook(() => useInputCounterWindowController());
        await waitFor(() => {
            expect(invokeMock).toHaveBeenCalledWith('hide_input_counter_window');
        });
        invokeMock.mockClear();

        act(() => {
            useBindingKeyStore.setState({
                entries: [
                    { id: 'space', label: 'Space', keyCode: 49, pressCount: 0, enabled: true },
                ],
            });
        });

        await waitFor(() => {
            expect(invokeMock).toHaveBeenCalledWith('show_input_counter_window');
        });
    });

    it('hides the independent panel when the global setting turns off', async () => {
        useBindingKeyStore.setState({
            entries: [
                { id: 'space', label: 'Space', keyCode: 49, pressCount: 0, enabled: true },
            ],
        });
        renderHook(() => useInputCounterWindowController());
        await waitFor(() => {
            expect(invokeMock).toHaveBeenCalledWith('show_input_counter_window');
        });
        invokeMock.mockClear();

        act(() => {
            useBindingKeyStore.getState().setPanelEnabled(false);
        });

        await waitFor(() => {
            expect(invokeMock).toHaveBeenCalledWith('hide_input_counter_window');
        });
    });

    it('hides the independent panel when the only bound entry is disabled', async () => {
        useBindingKeyStore.setState({
            entries: [
                { id: 'space', label: 'Space', keyCode: 49, pressCount: 0, enabled: true },
            ],
        });
        renderHook(() => useInputCounterWindowController());
        await waitFor(() => {
            expect(invokeMock).toHaveBeenCalledWith('show_input_counter_window');
        });
        invokeMock.mockClear();

        act(() => {
            useBindingKeyStore.getState().setEnabled('space', false);
        });

        await waitFor(() => {
            expect(invokeMock).toHaveBeenCalledWith('hide_input_counter_window');
        });
    });

    it('hides the independent panel when the only bound entry is removed', async () => {
        useBindingKeyStore.setState({
            entries: [
                { id: 'space', label: 'Space', keyCode: 49, pressCount: 0, enabled: true },
            ],
        });
        renderHook(() => useInputCounterWindowController());
        await waitFor(() => {
            expect(invokeMock).toHaveBeenCalledWith('show_input_counter_window');
        });
        invokeMock.mockClear();

        act(() => {
            useBindingKeyStore.getState().removeEntry('space');
        });

        await waitFor(() => {
            expect(invokeMock).toHaveBeenCalledWith('hide_input_counter_window');
        });
    });
});
