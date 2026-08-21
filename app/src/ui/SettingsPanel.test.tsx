import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePomodoroStore } from '../domain/pomodoro';
import { useSettingsStore } from '../domain/settings';
import { usePresenceStore } from '../domain/presence';
import { SettingsPanel } from './SettingsPanel';

const invoke = vi.hoisted(() => vi.fn());
const open = vi.hoisted(() => vi.fn());
const message = vi.hoisted(() => vi.fn());

vi.mock('@tauri-apps/api/core', () => ({ invoke }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock('@tauri-apps/api/window', () => ({
    getCurrentWindow: () => ({ startDragging: vi.fn(async () => {}) }),
}));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open, message }));

beforeEach(() => {
    invoke.mockReset().mockResolvedValue(undefined);
    open.mockReset().mockResolvedValue(null);
    message.mockReset().mockResolvedValue(undefined);
    useSettingsStore.setState({ activeTab: 'pomodoro', uiScale: 1, committedUiScale: 1, autostartEnabled: false });
    usePomodoroStore.setState({
        focusDurationSeconds: 1500,
        breakDurationSeconds: 300,
        autoStartBreak: false,
        autoPinAfterFocus: true,
        endActionMode: 'playVideo',
        endActionVideo: {
            sourceKind: 'builtin',
            builtinVideoId: 'qianqian',
            customVideoPath: '',
        },
        endSounds: {
            focus: { sourceKind: 'builtin', builtinSoundId: 'clear-success', customSoundPath: '' },
            break: { sourceKind: 'builtin', builtinSoundId: 'triple-ping', customSoundPath: '' },
        },
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
        expect(screen.getByText('切换状态确认时长')).toBeTruthy();
        expect(screen.getByText('摄像头授权')).toBeTruthy();
        expect(screen.getByText('未启用')).toBeTruthy();
        expect(screen.getByText('最近观测')).toBeTruthy();
    });

    it('shows focus-end video prompt settings with bundled and custom sources', () => {
        render(<SettingsPanel />);

        expect(screen.getByRole('combobox', { name: '计时结束提示' })).toBeTruthy();
        expect(screen.getByRole('option', { name: '弹窗到顶部' })).toBeTruthy();
        expect(screen.getByRole('option', { name: '播放视频' })).toBeTruthy();
        expect(screen.getByRole('combobox', { name: '视频选项' })).toBeTruthy();
        expect(screen.getByRole('option', { name: '千千' })).toBeTruthy();
        expect(screen.getByRole('option', { name: '自定义视频' })).toBeTruthy();
    });

    it('shows independent focus and break sound settings with all bundled choices', () => {
        render(<SettingsPanel />);

        expect((screen.getByRole('combobox', { name: '专注结束声音' }) as HTMLSelectElement).value).toBe('clear-success');
        expect((screen.getByRole('combobox', { name: '休息结束声音' }) as HTMLSelectElement).value).toBe('triple-ping');
        expect(screen.getByRole('option', { name: '清澈完成' })).toBeTruthy();
        expect(screen.getByRole('option', { name: '轻盈成功' })).toBeTruthy();
        expect(screen.getByRole('option', { name: '木琴奖励' })).toBeTruthy();
        expect(screen.getByRole('option', { name: '高铃认可' })).toBeTruthy();
        expect(screen.getByRole('option', { name: '三连提示' })).toBeTruthy();
        expect(screen.getByRole('option', { name: '中低音通知' })).toBeTruthy();
        expect(screen.getByRole('option', { name: '复古闹铃' })).toBeTruthy();
        expect(screen.getByRole('button', { name: '选择专注结束声音本机 MP3' })).toBeTruthy();
        expect(screen.getByRole('button', { name: '选择休息结束声音本机 MP3' })).toBeTruthy();
    });

    it('selects and applies an independent custom focus-end MP3 path', async () => {
        open.mockResolvedValue('/Users/xpy/Music/focus-end.mp3');
        render(<SettingsPanel />);

        fireEvent.click(screen.getByRole('button', { name: '选择专注结束声音本机 MP3' }));

        expect(await screen.findByText('本机 MP3 · focus-end.mp3')).toBeTruthy();
        const applyButton = screen.getByRole('button', { name: '应用' });
        await vi.waitFor(() => expect(applyButton).toHaveProperty('disabled', false));
        fireEvent.click(applyButton);

        await vi.waitFor(() => {
            expect(usePomodoroStore.getState().endSounds).toEqual({
                focus: {
                    sourceKind: 'custom',
                    builtinSoundId: 'clear-success',
                    customSoundPath: '/Users/xpy/Music/focus-end.mp3',
                },
                break: {
                    sourceKind: 'builtin',
                    builtinSoundId: 'triple-ping',
                    customSoundPath: '',
                },
            });
        });
    });

    it('selects and applies a custom focus-end video path', async () => {
        open.mockResolvedValue('/Users/xpy/Videos/focus-end.webm');
        render(<SettingsPanel />);

        fireEvent.change(screen.getByRole('combobox', { name: '视频选项' }), {
            target: { value: 'custom' },
        });
        fireEvent.click(screen.getByRole('button', { name: '选择自定义视频' }));

        expect(await screen.findByText('focus-end.webm')).toBeTruthy();
        const applyButton = screen.getByRole('button', { name: '应用' });
        await vi.waitFor(() => expect(applyButton).toHaveProperty('disabled', false));
        fireEvent.click(applyButton);

        await vi.waitFor(() => {
            expect(usePomodoroStore.getState().endActionVideo).toEqual({
                sourceKind: 'custom',
                builtinVideoId: 'qianqian',
                customVideoPath: '/Users/xpy/Videos/focus-end.webm',
            });
        });
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
