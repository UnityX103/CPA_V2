import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSettingsStore } from './domain/settings';

const { useBridgeClientMock, useCheckinEditorWindowSizeMock } = vi.hoisted(() => ({
    useBridgeClientMock: vi.fn(),
    useCheckinEditorWindowSizeMock: vi.fn(),
}));

vi.mock('./domain/bridge/client', () => ({ useBridgeClient: useBridgeClientMock }));
vi.mock('./domain/checkinWindow', () => ({ useCheckinEditorWindowSize: useCheckinEditorWindowSizeMock }));
vi.mock('./ui/CheckinPlanEditorPanel', () => ({
    CheckinPlanEditorPanel: () => <div data-testid="checkin-plan-editor-panel" />,
}));

const { default: CheckinEditorApp } = await import('./CheckinEditorApp');

describe('CheckinEditorApp', () => {
    beforeEach(() => {
        useBridgeClientMock.mockReset();
        useBridgeClientMock.mockReturnValue(true);
        useCheckinEditorWindowSizeMock.mockReset();
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

    it('waits for the bridge snapshot before exposing editor actions', () => {
        useBridgeClientMock.mockReturnValue(false);

        render(<CheckinEditorApp />);

        expect(screen.queryByTestId('checkin-plan-editor-panel')).toBeNull();
        expect(useCheckinEditorWindowSizeMock).toHaveBeenCalledWith(false);
    });

    it('renders the editor after bridge hydration', () => {
        render(<CheckinEditorApp />);

        expect(screen.getByTestId('checkin-plan-editor-panel')).toBeInTheDocument();
        expect(useCheckinEditorWindowSizeMock).toHaveBeenCalledWith(true);
    });

    it('unmounts the editor panel when the check-in system is disabled', () => {
        useSettingsStore.setState({ checkinEnabled: false });

        render(<CheckinEditorApp />);

        expect(screen.queryByTestId('checkin-plan-editor-panel')).toBeNull();
        expect(useCheckinEditorWindowSizeMock).toHaveBeenCalledWith(false);
    });
});
