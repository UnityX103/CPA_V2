import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useActiveAppStore } from '../domain/activeApp';
import { useBindingKeyStore } from '../domain/bindingKey';
import { useSettingsStore } from '../domain/settings';
import { InputCounterPanel } from './InputCounterPanel';

const { startDraggingMock, invokeMock } = vi.hoisted(() => ({
    startDraggingMock: vi.fn(),
    invokeMock: vi.fn(),
}));

vi.mock('@tauri-apps/api/window', () => ({
    getCurrentWindow: () => ({
        startDragging: () => {
            startDraggingMock();
            return Promise.resolve();
        },
    }),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));

beforeEach(() => {
    startDraggingMock.mockReset();
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
    useActiveAppStore.setState({ current: null });
    useSettingsStore.setState({
        showActiveAppWindowTitle: true,
        uiScale: 1,
    });
});

afterEach(() => {
    cleanup();
});

describe('InputCounterPanel', () => {
    it('returns nothing when the global key counter setting is disabled', () => {
        useBindingKeyStore.setState({ panelEnabled: false });

        const { container } = render(<InputCounterPanel />);

        expect(container.firstChild).toBeNull();
    });

    it('returns nothing and skips native resize when enabled but no key is bound', async () => {
        useActiveAppStore.setState({
            current: {
                name: 'VS Code',
                bundle_id: 'com.microsoft.VSCode',
                window_title: 'README.md - CPA_V2',
                icon_data_url: null,
            },
        });

        const { container } = render(<InputCounterPanel />);

        expect(container.firstChild).toBeNull();
        await waitFor(() => {
            expect(invokeMock).not.toHaveBeenCalledWith('resize_scaled_window', expect.anything());
        });
    });

    it('requests scaled native size from visible key count and global scale', async () => {
        useSettingsStore.setState({ uiScale: 1.5 });
        useBindingKeyStore.setState({
            entries: [
                { id: 'space', label: 'Space', keyCode: 49, pressCount: 47, enabled: true },
                { id: 'enter', label: 'Enter', keyCode: 36, pressCount: 3, enabled: true },
            ],
        });

        render(<InputCounterPanel />);

        await waitFor(() => {
            expect(invokeMock).toHaveBeenCalledWith('resize_scaled_window', {
                args: {
                    label: 'input-counter',
                    baseWidth: 128,
                    baseHeight: 111,
                    minWidth: 128,
                    minHeight: 84,
                    scale: 1.5,
                    center: false,
                },
            });
        });
    });

    it('falls back from window title to app name and then a placeholder label', () => {
        useBindingKeyStore.setState({
            entries: [
                { id: 'space', label: 'Space', keyCode: 49, pressCount: 47, enabled: true },
            ],
        });
        useActiveAppStore.setState({
            current: {
                name: 'Finder',
                bundle_id: 'com.apple.finder',
                window_title: '',
                icon_data_url: null,
            },
        });
        const { rerender } = render(<InputCounterPanel />);
        expect(screen.getByText('Finder')).toBeInTheDocument();

        useActiveAppStore.setState({ current: null });
        rerender(<InputCounterPanel />);
        expect(screen.getByText('未聚焦应用')).toBeInTheDocument();
    });

    it('uses the app name instead of the window title when title display is disabled', () => {
        useBindingKeyStore.setState({
            entries: [
                { id: 'space', label: 'Space', keyCode: 49, pressCount: 47, enabled: true },
            ],
        });
        useSettingsStore.setState({ showActiveAppWindowTitle: false });
        useActiveAppStore.setState({
            current: {
                name: 'Excel',
                bundle_id: 'com.microsoft.Excel',
                window_title: 'Budget.xlsx',
                icon_data_url: null,
            },
        });

        render(<InputCounterPanel />);

        expect(screen.getByText('Excel')).toBeInTheDocument();
        expect(screen.queryByText('Budget.xlsx')).toBeNull();
    });

    it('renders enabled bound keys as design pills with live counts', () => {
        useBindingKeyStore.setState({
            entries: [
                { id: 'space', label: 'Space', keyCode: 49, pressCount: 47, enabled: true },
                { id: 'disabled', label: 'A', keyCode: 0, pressCount: 3, enabled: false },
                { id: 'unbound', label: '未绑定', keyCode: -1, pressCount: 0, enabled: true },
            ],
        });

        render(<InputCounterPanel />);

        expect(screen.getByTestId('input-counter-pill-list')).toBeInTheDocument();
        expect(screen.getByText('Space')).toBeInTheDocument();
        expect(screen.getByText('47')).toBeInTheDocument();
        expect(screen.queryByText('A')).toBeNull();
        expect(screen.queryByText('未绑定')).toBeNull();
    });

    it('starts native drag from panel background but not from the pin button', () => {
        useBindingKeyStore.setState({
            entries: [
                { id: 'space', label: 'Space', keyCode: 49, pressCount: 47, enabled: true },
            ],
        });
        render(<InputCounterPanel />);
        const panel = screen.getByRole('complementary', { name: '按键统计' });
        fireEvent.pointerDown(panel, { button: 0 });
        expect(startDraggingMock).toHaveBeenCalledTimes(1);

        fireEvent.pointerDown(screen.getByRole('button', { name: '置顶' }), { button: 0 });
        expect(startDraggingMock).toHaveBeenCalledTimes(1);
    });

    it('toggles native always-on-top for the independent panel window', () => {
        useBindingKeyStore.setState({
            entries: [
                { id: 'space', label: 'Space', keyCode: 49, pressCount: 47, enabled: true },
            ],
        });
        render(<InputCounterPanel />);
        const pin = screen.getByRole('button', { name: '置顶' });

        fireEvent.click(pin);
        expect(pin).toHaveAttribute('aria-pressed', 'true');
        expect(invokeMock).toHaveBeenCalledWith('set_input_counter_window_pinned', { onTop: true });

        fireEvent.click(pin);
        expect(pin).toHaveAttribute('aria-pressed', 'false');
        expect(invokeMock).toHaveBeenCalledWith('set_input_counter_window_pinned', { onTop: false });
    });
});
