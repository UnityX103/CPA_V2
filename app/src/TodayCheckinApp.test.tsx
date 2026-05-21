import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
});
