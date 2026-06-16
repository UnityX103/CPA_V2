import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSettingsStore } from './domain/settings';

const { useBridgeClientMock, useTodayCheckinWindowSizeMock } = vi.hoisted(() => ({
    useBridgeClientMock: vi.fn(),
    useTodayCheckinWindowSizeMock: vi.fn(),
}));

vi.mock('./domain/bridge/client', () => ({ useBridgeClient: useBridgeClientMock }));
vi.mock('./domain/checkinWindow', () => ({ useTodayCheckinWindowSize: useTodayCheckinWindowSizeMock }));
vi.mock('./ui/TodayCheckinPanel', () => ({
    TodayCheckinPanel: () => <div data-testid="today-checkin-panel" />,
}));

const { default: TodayCheckinApp } = await import('./TodayCheckinApp');

describe('TodayCheckinApp', () => {
    beforeEach(() => {
        useBridgeClientMock.mockReset();
        useBridgeClientMock.mockReturnValue(true);
        useTodayCheckinWindowSizeMock.mockReset();
        useSettingsStore.setState({
            checkinEnabled: true,
            planPanelEnabled: true,
            uiScale: 1,
            committedUiScale: 1,
            autostartEnabled: false,
            dangerousChange: null,
        });
    });

    afterEach(() => {
        cleanup();
    });

    it('waits for the bridge snapshot before exposing check-in actions', () => {
        useBridgeClientMock.mockReturnValue(false);

        render(<TodayCheckinApp />);

        expect(screen.queryByTestId('today-checkin-panel')).toBeNull();
        expect(useTodayCheckinWindowSizeMock).toHaveBeenCalledWith(false);
    });

    it('renders the check-in panel after bridge hydration', () => {
        render(<TodayCheckinApp />);

        expect(screen.getByTestId('today-checkin-panel')).toBeInTheDocument();
        expect(useTodayCheckinWindowSizeMock).toHaveBeenCalledWith(true);
    });

    it('unmounts the today check-in panel when the check-in system is disabled', () => {
        useSettingsStore.setState({ checkinEnabled: false, planPanelEnabled: true });

        render(<TodayCheckinApp />);

        expect(screen.queryByTestId('today-checkin-panel')).toBeNull();
        expect(useTodayCheckinWindowSizeMock).toHaveBeenCalledWith(false);
    });

    it('unmounts the today check-in panel when the plan panel is disabled', () => {
        useSettingsStore.setState({ checkinEnabled: true, planPanelEnabled: false });

        render(<TodayCheckinApp />);

        expect(screen.queryByTestId('today-checkin-panel')).toBeNull();
        expect(useTodayCheckinWindowSizeMock).toHaveBeenCalledWith(false);
    });
});
