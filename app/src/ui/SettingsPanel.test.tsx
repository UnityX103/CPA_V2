import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePomodoroStore } from '../domain/pomodoro';
import { useSettingsStore } from '../domain/settings';
import { usePresenceStore } from '../domain/presence';
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
    usePresenceStore.setState({
        enabled: false,
        intervalSeconds: 60,
        presentThresholdSeconds: 60,
        platform: 'macos',
        availability: 'disabled',
        latestObservation: 'unknown',
        lastSuccessfulAt: null,
        lastError: null,
        inFlight: false,
        generation: 0,
        candidateDirection: null,
        candidateFirstAt: null,
        candidateLastAt: null,
        candidateCount: 0,
        observedPomodoroEpoch: 0,
        notice: null,
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

    it('renders the local camera automation controls', () => {
        render(<SettingsPanel />);

        const toggle = screen.getByRole('button', { name: '摄像头自动控制' });
        const toggleRow = toggle.closest('.pomo-row');
        const authorizationControl = screen.getByRole('group', { name: '摄像头授权状态' });

        expect(toggle.getAttribute('aria-pressed')).toBe('false');
        expect(toggleRow?.nextElementSibling).toBe(authorizationControl);
        expect(screen.getByText('检测间隔')).toBeTruthy();
        expect(screen.getByText('在场确认时长')).toBeTruthy();
        expect(screen.getByText('摄像头授权')).toBeTruthy();
        expect(screen.getByText('未启用')).toBeTruthy();
        expect(screen.getByText('最近观测')).toBeTruthy();
    });

    it('applies camera automation settings through the existing apply flow', async () => {
        render(<SettingsPanel />);

        fireEvent.click(screen.getByRole('button', { name: '摄像头自动控制' }));
        const inputs = screen.getAllByRole('spinbutton');
        expect(inputs[2].getAttribute('min')).toBe('5');
        fireEvent.change(inputs[2], { target: { value: '5' } });
        fireEvent.change(inputs[3], { target: { value: '120' } });
        fireEvent.click(screen.getByRole('button', { name: '应用' }));

        await vi.waitFor(() => {
            expect(usePresenceStore.getState()).toEqual(expect.objectContaining({
                enabled: true,
                intervalSeconds: 5,
                presentThresholdSeconds: 120,
            }));
        });
    });

});
