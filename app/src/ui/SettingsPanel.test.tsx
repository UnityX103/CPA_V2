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
    invoke.mockReset().mockImplementation((command: string) => {
        if (command === 'list_audio_output_devices') {
            return Promise.resolve([
                { id: 'coreaudio:built-in-output', name: 'MacBook Pro 扬声器', isDefault: true },
                { id: 'coreaudio:external-dac', name: 'USB DAC', isDefault: false },
            ]);
        }
        return Promise.resolve(undefined);
    });
    open.mockReset().mockResolvedValue(null);
    message.mockReset().mockResolvedValue(undefined);
    useSettingsStore.setState({
        activeTab: 'pomodoro',
        uiScale: 1,
        committedUiScale: 1,
        autostartEnabled: false,
        audioOutputDeviceId: null,
        soundVolume: 1,
    });
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
        absenceSensitivity: 'strict',
        platform: 'macos',
        availability: 'disabled',
        confirmedPresence: 'unknown',
        lastSuccessfulAt: null,
        lastError: null,
        inFlight: false,
        generation: 0,
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

    it('selects the playback device and exposes a volume control in global settings', async () => {
        render(<SettingsPanel />);
        fireEvent.click(screen.getByRole('button', { name: '全局' }));

        const device = await screen.findByRole('combobox', { name: '播放声音的设备' });
        expect(screen.getByRole('option', { name: '跟随系统默认设备' })).toBeTruthy();
        expect(screen.getByRole('option', { name: 'MacBook Pro 扬声器（系统默认）' })).toBeTruthy();
        expect(screen.getByRole('option', { name: 'USB DAC' })).toBeTruthy();
        fireEvent.change(device, { target: { value: 'coreaudio:external-dac' } });

        expect(useSettingsStore.getState().audioOutputDeviceId).toBe('coreaudio:external-dac');
        expect(screen.getByRole('slider', { name: '声音音量' }).getAttribute('aria-valuenow')).toBe('100');
        expect(screen.getByText('100%')).toBeTruthy();
    });

    it('renders the local camera automation controls', () => {
        render(<SettingsPanel />);

        const toggle = screen.getByRole('button', { name: '摄像头自动控制' });
        const toggleRow = toggle.closest('.pomo-row');
        const authorizationControl = screen.getByRole('group', { name: '摄像头授权状态' });

        expect(toggle.getAttribute('aria-pressed')).toBe('false');
        expect(toggleRow?.nextElementSibling).toBe(authorizationControl);
        expect(screen.getByText('检测间隔')).toBeTruthy();
        const threshold = screen.getByRole('combobox', { name: '离席判定阈值' }) as HTMLSelectElement;
        expect(threshold.value).toBe('strict');
        expect(screen.getByRole('option', { name: '关闭防抖' })).toBeTruthy();
        expect(screen.getByRole('option', { name: '严谨' })).toBeTruthy();
        expect(screen.getByRole('option', { name: '中等' })).toBeTruthy();
        expect(screen.getByRole('option', { name: '宽松' })).toBeTruthy();
        expect(screen.getByText('摄像头授权')).toBeTruthy();
        expect(screen.getByText('未启用')).toBeTruthy();
        expect(screen.getByText('工位状态')).toBeTruthy();
    });

    it('labels automatic focus-end pinning clearly', () => {
        render(<SettingsPanel />);

        expect(screen.getByRole('button', { name: '专注结束后自动置顶' })).toBeTruthy();
        expect(screen.getByText('专注结束后自动置顶')).toBeTruthy();
        expect(screen.queryByText('自动制定')).toBeNull();
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
        const applyButton = await screen.findByRole('button', { name: '应用' });
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
        expect(inputs).toHaveLength(3);
        expect(inputs[2].getAttribute('min')).toBe('5');
        fireEvent.change(inputs[2], { target: { value: '5' } });
        fireEvent.change(screen.getByRole('combobox', { name: '离席判定阈值' }), {
            target: { value: 'balanced' },
        });
        fireEvent.click(screen.getByRole('button', { name: '应用' }));

        await vi.waitFor(() => {
            expect(usePresenceStore.getState()).toEqual(expect.objectContaining({
                enabled: true,
                intervalSeconds: 5,
                absenceSensitivity: 'balanced',
            }));
        });
    });

});
