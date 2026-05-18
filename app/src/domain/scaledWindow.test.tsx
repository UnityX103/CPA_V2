import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSettingsStore } from './settings';
import {
    INPUT_COUNTER_BASE_HEIGHT,
    INPUT_COUNTER_BASE_WIDTH,
    MAIN_WINDOW_BASE_SIZE,
    SETTINGS_WINDOW_BASE_SIZE,
    SETTINGS_WINDOW_MIN_SIZE,
    useScaledWindowSize,
} from './scaledWindow';

const { invokeMock } = vi.hoisted(() => ({
    invokeMock: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));

function Probe({
    label,
    baseWidth,
    baseHeight,
    minWidth,
    minHeight,
    center = false,
    enabled = true,
}: {
    label: string;
    baseWidth: number;
    baseHeight: number;
    minWidth: number;
    minHeight: number;
    center?: boolean;
    enabled?: boolean;
}) {
    useScaledWindowSize({ label, baseWidth, baseHeight, minWidth, minHeight, center, enabled });
    return null;
}

beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValue(undefined);
    useSettingsStore.setState({
        uiScale: 1,
        committedUiScale: 1,
        dangerousChange: null,
    });
});

afterEach(() => {
    cleanup();
});

describe('useScaledWindowSize', () => {
    it('invokes the shared native resize command with current scale', async () => {
        useSettingsStore.setState({ uiScale: 1.5 });

        render(
            <Probe
                label="main"
                baseWidth={MAIN_WINDOW_BASE_SIZE.width}
                baseHeight={MAIN_WINDOW_BASE_SIZE.height}
                minWidth={MAIN_WINDOW_BASE_SIZE.width}
                minHeight={MAIN_WINDOW_BASE_SIZE.height}
            />,
        );

        await waitFor(() => {
            expect(invokeMock).toHaveBeenCalledWith('resize_scaled_window', {
                args: {
                    label: 'main',
                    baseWidth: 249,
                    baseHeight: 171,
                    minWidth: 249,
                    minHeight: 171,
                    scale: 1.5,
                    center: false,
                },
            });
        });
    });

    it('reinvokes when scale changes and passes center for settings', async () => {
        const { rerender } = render(
            <Probe
                label="settings"
                baseWidth={SETTINGS_WINDOW_BASE_SIZE.width}
                baseHeight={SETTINGS_WINDOW_BASE_SIZE.height}
                minWidth={SETTINGS_WINDOW_MIN_SIZE.width}
                minHeight={SETTINGS_WINDOW_MIN_SIZE.height}
                center
            />,
        );

        await waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(1));
        invokeMock.mockClear();
        useSettingsStore.setState({ uiScale: 2 });
        rerender(
            <Probe
                label="settings"
                baseWidth={SETTINGS_WINDOW_BASE_SIZE.width}
                baseHeight={SETTINGS_WINDOW_BASE_SIZE.height}
                minWidth={SETTINGS_WINDOW_MIN_SIZE.width}
                minHeight={SETTINGS_WINDOW_MIN_SIZE.height}
                center
            />,
        );

        await waitFor(() => {
            expect(invokeMock).toHaveBeenCalledWith('resize_scaled_window', {
                args: {
                    label: 'settings',
                    baseWidth: 460,
                    baseHeight: 440,
                    minWidth: 360,
                    minHeight: 320,
                    scale: 2,
                    center: true,
                },
            });
        });
    });

    it('does not invoke the resize command when disabled', async () => {
        render(
            <Probe
                label="input-counter"
                baseWidth={INPUT_COUNTER_BASE_WIDTH}
                baseHeight={INPUT_COUNTER_BASE_HEIGHT}
                minWidth={INPUT_COUNTER_BASE_WIDTH}
                minHeight={INPUT_COUNTER_BASE_HEIGHT}
                enabled={false}
            />,
        );

        await waitFor(() => {
            expect(invokeMock).not.toHaveBeenCalled();
        });
    });
});
