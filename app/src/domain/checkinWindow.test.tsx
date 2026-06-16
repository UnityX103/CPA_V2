import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSettingsStore } from './settings';
import { useCheckinStore } from './checkin';
import {
    openCheckinEditorWindow,
    openTodayCheckinWindow,
    useCheckinWindowController,
} from './checkinWindow';

const { invokeMock } = vi.hoisted(() => ({
    invokeMock: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));
vi.mock('./scaledWindow', () => ({ useScaledWindowSize: vi.fn() }));

function CheckinWindowControllerHost() {
    useCheckinWindowController();
    return null;
}

beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValue(undefined);
    useSettingsStore.setState({
        checkinEnabled: true,
        planPanelEnabled: true,
        uiScale: 1,
        committedUiScale: 1,
        autostartEnabled: false,
        dangerousChange: null,
    });
    useCheckinStore.setState({ lastError: null });
});

afterEach(() => {
    cleanup();
});

describe('useCheckinWindowController', () => {
    it('opens the today check-in window when check-in is enabled', async () => {
        render(<CheckinWindowControllerHost />);

        await waitFor(() => {
            expect(invokeMock).toHaveBeenCalledWith('open_today_checkin_window');
        });
    });

    it('does not open the today check-in window when check-in is disabled', async () => {
        useSettingsStore.setState({ checkinEnabled: false });

        render(<CheckinWindowControllerHost />);
        await Promise.resolve();

        expect(invokeMock).not.toHaveBeenCalledWith('open_today_checkin_window');
    });

    it('does not open the today check-in window when the plan panel is disabled', async () => {
        useSettingsStore.setState({ checkinEnabled: true, planPanelEnabled: false });

        render(<CheckinWindowControllerHost />);
        await Promise.resolve();

        expect(invokeMock).not.toHaveBeenCalledWith('open_today_checkin_window');
    });

    it('closes both check-in windows when check-in is disabled after being enabled', async () => {
        render(<CheckinWindowControllerHost />);
        await waitFor(() => {
            expect(invokeMock).toHaveBeenCalledWith('open_today_checkin_window');
        });
        invokeMock.mockClear();

        useSettingsStore.setState({ checkinEnabled: false });

        await waitFor(() => {
            expect(invokeMock).toHaveBeenCalledWith('close_today_checkin_window');
            expect(invokeMock).toHaveBeenCalledWith('close_checkin_editor_window');
        });
    });

    it('closes only the today check-in window when the plan panel is disabled after being enabled', async () => {
        render(<CheckinWindowControllerHost />);
        await waitFor(() => {
            expect(invokeMock).toHaveBeenCalledWith('open_today_checkin_window');
        });
        invokeMock.mockClear();

        useSettingsStore.setState({ planPanelEnabled: false });

        await waitFor(() => {
            expect(invokeMock).toHaveBeenCalledWith('close_today_checkin_window');
        });
        expect(invokeMock).not.toHaveBeenCalledWith('close_checkin_editor_window');
    });

    it('open helpers no-op when check-in is disabled', async () => {
        useSettingsStore.setState({ checkinEnabled: false });

        await openTodayCheckinWindow();
        await openCheckinEditorWindow();

        expect(invokeMock).not.toHaveBeenCalledWith('open_today_checkin_window');
        expect(invokeMock).not.toHaveBeenCalledWith('open_checkin_editor_window');
    });

    it('today open helper no-ops when the plan panel is disabled', async () => {
        useSettingsStore.setState({ checkinEnabled: true, planPanelEnabled: false });

        await openTodayCheckinWindow();
        await openCheckinEditorWindow();

        expect(invokeMock).not.toHaveBeenCalledWith('open_today_checkin_window');
        expect(invokeMock).toHaveBeenCalledWith('open_checkin_editor_window');
    });
});
