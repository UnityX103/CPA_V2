import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePomodoroStore } from '../domain/pomodoro';
import { useSettingsStore } from '../domain/settings';
import { SettingsPanel } from './SettingsPanel';

const invoke = vi.hoisted(() => vi.fn());

vi.mock('@tauri-apps/api/core', () => ({ invoke }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock('@tauri-apps/api/window', () => ({
    getCurrentWindow: () => ({ startDragging: vi.fn(async () => {}) }),
}));

beforeEach(() => {
    invoke.mockReset().mockResolvedValue(undefined);
    useSettingsStore.setState({ activeTab: 'pomodoro', uiScale: 1, committedUiScale: 1, autostartEnabled: false });
    usePomodoroStore.setState({
        focusDurationSeconds: 1500,
        breakDurationSeconds: 300,
        autoStartBreak: false,
        autoPinAfterFocus: true,
        endActionMode: 'topWindow',
    });
});

afterEach(cleanup);

describe('SettingsPanel', () => {
    it('shows the retained navigation tabs', () => {
        render(<SettingsPanel />);

        expect(screen.getByRole('button', { name: '番茄钟' })).toBeTruthy();
        expect(screen.getByRole('button', { name: '联机' })).toBeTruthy();
        expect(screen.getByRole('button', { name: '全局' })).toBeTruthy();
    });

    it('opens the global settings surface', () => {
        render(<SettingsPanel />);

        fireEvent.click(screen.getByRole('button', { name: '全局' }));

        expect(screen.getByText('界面缩放')).toBeTruthy();
        expect(screen.getByText('开机自启动')).toBeTruthy();
    });
});
