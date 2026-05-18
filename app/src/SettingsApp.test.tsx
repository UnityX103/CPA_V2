import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSettingsStore } from './domain/settings';

const { invokeMock } = vi.hoisted(() => ({
    invokeMock: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));
vi.mock('./domain/bridge/client', () => ({ useBridgeClient: vi.fn() }));
vi.mock('./ui/SettingsPanel', () => ({ SettingsPanel: () => <div data-testid="settings-panel" /> }));
vi.mock('./ui/DangerousChangeDialog', () => ({ DangerousChangeDialog: () => null }));

const { default: SettingsApp } = await import('./SettingsApp');

beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValue(undefined);
    useSettingsStore.setState({ uiScale: 1.5, committedUiScale: 1.5, dangerousChange: null });
});

afterEach(() => {
    cleanup();
});

describe('SettingsApp scaled window sizing', () => {
    it('requests centered native resize for the settings window when global scale is active', async () => {
        render(<SettingsApp />);

        await waitFor(() => {
            expect(invokeMock).toHaveBeenCalledWith('resize_scaled_window', {
                args: {
                    label: 'settings',
                    baseWidth: 460,
                    baseHeight: 440,
                    minWidth: 360,
                    minHeight: 320,
                    scale: 1.5,
                    center: true,
                },
            });
        });
    });
});
