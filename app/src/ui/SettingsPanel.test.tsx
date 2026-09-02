import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePomodoroStore } from '../domain/pomodoro';
import { useSettingsStore } from '../domain/settings';
import { usePresenceStore } from '../domain/presence';
import { SettingsPanel } from './SettingsPanel';

const invoke = vi.hoisted(() => vi.fn());
const listen = vi.hoisted(() => vi.fn());
const open = vi.hoisted(() => vi.fn());
const message = vi.hoisted(() => vi.fn());

vi.mock('@tauri-apps/api/core', () => ({ invoke }));
vi.mock('@tauri-apps/api/event', () => ({ listen }));
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
    listen.mockReset().mockResolvedValue(() => {});
    open.mockReset().mockResolvedValue(null);
    message.mockReset().mockResolvedValue(undefined);
    useSettingsStore.setState({
        activeTab: 'pomodoro',
        uiScale: 1,
        committedUiScale: 1,
        autostartEnabled: false,
        audioOutputDeviceId: null,
        soundVolume: 1,
        breakPetMode: 'off',
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
        expect(screen.getByRole('button', { name: '宠物' })).toBeTruthy();
        expect(screen.getByRole('button', { name: '视频编辑' })).toBeTruthy();
        expect(screen.getByRole('button', { name: '全局' })).toBeTruthy();
    });

    it('shows the separately downloadable video editor module shell', async () => {
        invoke.mockImplementation((command: string) => {
            if (command === 'video_editor_module_status') {
                return Promise.resolve({
                    installed: false,
                    version: null,
                    target: 'macos-arm64',
                    message: '视频编辑模块尚未下载',
                });
            }
            if (command === 'download_video_editor_module') {
                return Promise.resolve({
                    installed: true,
                    version: '1.0.0',
                    target: 'macos-arm64',
                    message: '视频编辑模块已下载',
                });
            }
            return Promise.resolve(undefined);
        });
        render(<SettingsPanel />);

        fireEvent.click(screen.getByRole('button', { name: '视频编辑' }));
        expect(await screen.findByText('视频编辑模板需要单独下载')).toBeTruthy();
        expect(screen.getByText(/默认应用包不包含这些内容/)).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: '下载视频编辑模板' }));
        await screen.findByRole('button', { name: '打开视频编辑器' });
        expect(screen.getByRole('button', { name: '更新视频编辑模板' })).toBeTruthy();
        expect(invoke).toHaveBeenCalledWith('download_video_editor_module');
    });

    it('keeps video module download progress when switching settings tabs', async () => {
        const notInstalled = {
            installed: false,
            version: null,
            target: 'macos-arm64',
            message: '视频编辑模块尚未下载',
        };
        let finishDownload!: (status: typeof notInstalled) => void;
        const pendingDownload = new Promise<typeof notInstalled>((resolve) => {
            finishDownload = resolve;
        });
        let progressListener: ((event: { payload: {
            stage: 'download';
            downloadedBytes: number;
            totalBytes: number;
            message: string;
        } }) => void) | undefined;

        listen.mockImplementation(async (eventName: string, listener: typeof progressListener) => {
            if (eventName === 'video-editor-module-progress') progressListener = listener;
            return () => {};
        });
        invoke.mockImplementation((command: string) => {
            if (command === 'video_editor_module_status') return Promise.resolve(notInstalled);
            if (command === 'download_video_editor_module') return pendingDownload;
            return Promise.resolve(undefined);
        });

        render(<SettingsPanel />);
        fireEvent.click(screen.getByRole('button', { name: '视频编辑' }));
        const download = await screen.findByRole('button', { name: '下载视频编辑模板' });
        fireEvent.click(download);
        await vi.waitFor(() => {
            expect(invoke.mock.calls.filter(([command]) => (
                command === 'download_video_editor_module'
            ))).toHaveLength(1);
        });

        act(() => {
            progressListener?.({
                payload: {
                    stage: 'download',
                    downloadedBytes: 25,
                    totalBytes: 100,
                    message: '正在下载视频编辑模块',
                },
            });
        });
        expect(await screen.findByText('正在下载视频编辑模块 · 25%')).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: '全局' }));
        fireEvent.click(screen.getByRole('button', { name: '视频编辑' }));

        expect(await screen.findByText('正在下载视频编辑模块 · 25%')).toBeTruthy();
        const restoredDownload = screen.getByRole('button', { name: '下载视频编辑模板' }) as HTMLButtonElement;
        expect(restoredDownload.disabled).toBe(true);
        expect(restoredDownload.textContent).toBe('下载中…');
        fireEvent.click(restoredDownload);
        expect(invoke.mock.calls.filter(([command]) => (
            command === 'download_video_editor_module'
        ))).toHaveLength(1);

        finishDownload({ ...notInstalled, installed: true, version: '1.3.0' });
    });

    it('opens the global settings surface', () => {
        render(<SettingsPanel />);

        fireEvent.click(screen.getByRole('button', { name: '全局' }));

        expect(screen.getByText('界面缩放')).toBeTruthy();
        expect(screen.getByText('开机自启动')).toBeTruthy();
    });

    it('shows the cockroach module panel only after cockroach invasion is selected', async () => {
        invoke.mockImplementation((command: string) => {
            if (command === 'cockroach_module_status') {
                return Promise.resolve({
                    installed: false,
                    running: false,
                    version: null,
                    target: 'macos-arm64',
                    message: '蟑螂模块尚未下载',
                    settings: { maxCount: 30, babyGrowthMinutes: 10 },
                });
            }
            return Promise.resolve(undefined);
        });
        render(<SettingsPanel />);

        fireEvent.click(screen.getByRole('button', { name: '宠物' }));
        expect(screen.queryByText('蟑螂模块需要单独下载')).toBeNull();

        fireEvent.click(screen.getByRole('button', { name: '选择蟑螂入侵' }));
        expect(await screen.findByText('蟑螂模块需要单独下载')).toBeTruthy();
        expect(screen.getByRole('button', { name: '下载蟑螂模块' })).toBeTruthy();
    });

    it('exposes upstream cockroach settings, simulation, and kill-all controls', async () => {
        const moduleStatus = {
            installed: true,
            running: false,
            version: '1.1.0',
            target: 'macos-arm64',
            message: '蟑螂模块已下载',
            settings: { maxCount: 30, babyGrowthMinutes: 10 },
        };
        invoke.mockImplementation((command: string) => {
            if (command === 'cockroach_module_status') return Promise.resolve(moduleStatus);
            if (command === 'launch_cockroach_module') {
                return Promise.resolve({ ...moduleStatus, running: true });
            }
            if (command === 'kill_all_cockroaches') return Promise.resolve(moduleStatus);
            return Promise.resolve(undefined);
        });
        useSettingsStore.setState({ activeTab: 'pet', breakPetMode: 'cockroachInvasion' });
        render(<SettingsPanel />);

        const maxCount = await screen.findByRole('spinbutton', { name: '最大蟑螂数量' });
        const growth = screen.getByRole('spinbutton', { name: '幼虫成长时间' });
        expect(maxCount.getAttribute('min')).toBe('1');
        expect(maxCount.getAttribute('max')).toBe('99');
        expect(growth.getAttribute('min')).toBe('1');
        expect(growth.getAttribute('max')).toBe('60');

        fireEvent.click(screen.getByRole('button', { name: '模拟蟑螂入侵' }));
        await vi.waitFor(() => {
            expect(invoke).toHaveBeenCalledWith('launch_cockroach_module', {
                settings: { maxCount: 30, babyGrowthMinutes: 10 },
            });
        });
        const killAll = screen.getByRole('button', { name: '杀死所有蟑螂' }) as HTMLButtonElement;
        await vi.waitFor(() => expect(killAll.disabled).toBe(false));
        fireEvent.click(killAll);
        await vi.waitFor(() => {
            expect(invoke).toHaveBeenCalledWith('kill_all_cockroaches');
        });
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

    it('reveals the rest-at-desk reminder and its method only after their dependencies are enabled', async () => {
        render(<SettingsPanel />);

        expect(screen.queryByRole('button', { name: '休息未离开工位时的提醒' })).toBeNull();
        expect(screen.queryByRole('combobox', { name: '提醒方式' })).toBeNull();

        fireEvent.click(screen.getByRole('button', { name: '摄像头自动控制' }));
        const reminder = screen.getByRole('button', { name: '休息未离开工位时的提醒' });
        expect(reminder.getAttribute('aria-pressed')).toBe('false');
        expect(screen.queryByRole('combobox', { name: '提醒方式' })).toBeNull();

        fireEvent.click(reminder);
        const method = screen.getByRole('combobox', { name: '提醒方式' }) as HTMLSelectElement;
        expect(method.value).toBe('cockroachInvasion');
        expect(screen.getByRole('option', { name: '蟑螂入侵' })).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: '应用' }));
        await vi.waitFor(() => {
            expect(usePresenceStore.getState()).toEqual(expect.objectContaining({
                restDeskReminderEnabled: true,
                restDeskReminderMode: 'cockroachInvasion',
            }));
            expect(useSettingsStore.getState().breakPetMode).toBe('cockroachInvasion');
        });
    });

});
