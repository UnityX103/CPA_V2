// CSS-text geometry guard — jsdom does not load stylesheets, so we parse the CSS source.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { useSettingsStore } from '../domain/settings';
import { usePomodoroStore } from '../domain/pomodoro';
import { useNetworkStore } from '../domain/network';
import { useBindingKeyStore } from '../domain/bindingKey';
import { SettingsPanel } from './SettingsPanel';

function cssRule(css: string, selector: string): string {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const ruleMatch = css.match(new RegExp(`${escaped}\\s*\\{[^}]*\\}`));
    expect(ruleMatch, `${selector} rule not found`).toBeTruthy();
    return ruleMatch![0];
}

const { startDragging, invokeMock, listenMock, pickCustomWebmPathMock } = vi.hoisted(() => ({
    startDragging: vi.fn(),
    invokeMock: vi.fn(),
    listenMock: vi.fn(() => Promise.resolve(() => {})),
    pickCustomWebmPathMock: vi.fn(),
}));

vi.mock('@tauri-apps/api/window', () => ({
    getCurrentWindow: () => ({
        startDragging: () => {
            startDragging();
            return Promise.resolve();
        },
    }),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));
vi.mock('@tauri-apps/api/event', () => ({ listen: listenMock }));
vi.mock('../domain/videoFiles', () => ({ pickCustomWebmPath: pickCustomWebmPathMock }));

beforeEach(() => {
    startDragging.mockReset();
    invokeMock.mockReset();
    invokeMock.mockResolvedValue({ granted: true, platform: 'macos' });
    listenMock.mockReset();
    listenMock.mockResolvedValue(() => {});
    pickCustomWebmPathMock.mockReset();
    pickCustomWebmPathMock.mockResolvedValue(null);
    useSettingsStore.setState({ activeTab: 'pomodoro' });
    usePomodoroStore.setState({
        focusDurationSeconds: 25 * 60,
        breakDurationSeconds: 5 * 60,
        totalRounds: 4,
        currentRound: 1,
        remainingSeconds: 25 * 60,
        currentPhase: 'focus',
        isRunning: false,
        isPinned: false,
        autoStartBreak: true,
        consecutiveCompletedFocus: 0,
        endActionMode: 'playVideo',
        endActionVideo: {
            sourceKind: 'builtin',
            builtinVideoId: 'qianqian',
            customVideoPath: '',
        },
        lastEndEvent: null,
    });
    cleanup();
});

describe('SettingsPanel drag', () => {
    it('header pointer down triggers native window drag', async () => {
        render(<SettingsPanel />);
        const head = screen.getByRole('dialog', { name: '设置' }).querySelector('.settings-head')!;
        await act(async () => {
            fireEvent.pointerDown(head, { button: 0 });
        });
        expect(startDragging).toHaveBeenCalledTimes(1);
    });

    it('clicking the close button does NOT trigger drag', async () => {
        render(<SettingsPanel />);
        const closeBtn = screen.getByRole('button', { name: '关闭' });
        await act(async () => {
            fireEvent.pointerDown(closeBtn, { button: 0 });
        });
        expect(startDragging).not.toHaveBeenCalled();
    });
});

describe('SettingsPanel close button', () => {
    it('clicking the close button invokes close_settings_window', async () => {
        invokeMock.mockClear();
        render(<SettingsPanel />);
        const closeBtn = screen.getByRole('button', { name: '关闭' });
        await act(async () => { fireEvent.click(closeBtn); });
        expect(invokeMock).toHaveBeenCalledWith('close_settings_window');
    });
});

describe('SettingsPanel geometry', () => {
    const here = path.dirname(fileURLToPath(import.meta.url));

    it('CSS lets the shell adapt to window width and stretch with window height', () => {
        const css = readFileSync(path.join(here, 'SettingsPanel.css'), 'utf8');
        const rule = cssRule(css, '.settings-panel');
        expect(rule).toMatch(/width:\s*100%\s*;/);
        expect(rule).not.toMatch(/width:\s*\d+px\s*;/);
        expect(rule).toMatch(/min-height:\s*100%\s*;/);
        expect(rule).not.toMatch(/height:\s*\d+px\s*;/);
    });

    it('settings window is resizable and has minimum bounds instead of a locked shell', () => {
        const libRs = readFileSync(path.join(here, '../../src-tauri/src/lib.rs'), 'utf8');
        expect(libRs).toMatch(/\.resizable\(true\)/);
        expect(libRs).toMatch(/\.min_inner_size\(\s*SETTINGS_MIN_W,\s*SETTINGS_MIN_H\s*\)/);
        expect(libRs).not.toMatch(/\.resizable\(false\)/);
    });

    it('content flex areas can shrink and wrap instead of forcing a fixed width', () => {
        const css = readFileSync(path.join(here, 'SettingsPanel.css'), 'utf8');
        expect(cssRule(css, '.settings-panel')).toMatch(/min-width:\s*0\s*;/);
        expect(cssRule(css, '.settings-body')).toMatch(/min-height:\s*0\s*;/);
        expect(cssRule(css, '.settings-content')).toMatch(/min-width:\s*0\s*;/);
        expect(cssRule(css, '.settings-content')).toMatch(/min-height:\s*0\s*;/);
        expect(cssRule(css, '.settings-content-scroll')).toMatch(/min-height:\s*0\s*;/);
        expect(cssRule(css, '.card')).toMatch(/min-width:\s*0\s*;/);
        expect(cssRule(css, '.card-grid')).toMatch(/flex-wrap:\s*wrap\s*;/);
        expect(cssRule(css, '.card-grid > .card')).toMatch(/flex:\s*1\s+1\s+140px\s*;/);
        expect(cssRule(css, '.card-actions')).toMatch(/flex-wrap:\s*wrap\s*;/);
        expect(cssRule(css, '.pomo-row')).toMatch(/flex-wrap:\s*wrap\s*;/);
        expect(cssRule(css, '.online-room-head')).toMatch(/flex-wrap:\s*wrap\s*;/);
    });

    it('narrow settings widths stack the sidebar above the content', () => {
        const css = readFileSync(path.join(here, 'SettingsPanel.css'), 'utf8');
        expect(css).toMatch(/@media\s*\(\s*max-width:\s*420px\s*\)/);
        expect(css).toMatch(/\.settings-body\s*\{[^}]*flex-direction:\s*column\s*;/);
        expect(css).toMatch(/\.settings-nav\s*\{[^}]*width:\s*100%\s*;[^}]*flex-direction:\s*row\s*;/);
        expect(css).toMatch(/\.settings-tab\s*\{[^}]*flex:\s*1\s+0\s+auto\s*;/);
    });
});

describe('PomodoroTab parity with gs1Tv', () => {
    it('renders pomoGrid + 3 visible pomoFooter rows (WSnlp collapsed per design)', () => {
        render(<SettingsPanel />);
        // pomoGrid: work + break cards (label text)
        expect(screen.getByText('专注时长')).toBeTruthy();
        expect(screen.getByText('休息时长')).toBeTruthy();
        // pomoFooter rows (WSnlp 视频文件 omitted — enabled:false in design)
        expect(screen.getByText('结束提示音')).toBeTruthy();
        expect(screen.getByText('计时结束提示')).toBeTruthy();
        expect(screen.queryByText('视频文件')).toBeNull();
        expect(screen.getByText('自定义视频文件')).toBeTruthy();
    });

    it('does NOT render the obsolete 总轮次 / 休息自动开始 rows', () => {
        render(<SettingsPanel />);
        expect(screen.queryByText('总轮次')).toBeNull();
        expect(screen.queryByText('休息自动开始')).toBeNull();
    });
});

describe('PomodoroTab end action settings', () => {
    it('shows qianqian as the default bundled video option and playVideo action', () => {
        render(<SettingsPanel />);

        expect(screen.getByRole('option', { name: '播放视频' })).toBeTruthy();
        expect(screen.getByRole('option', { name: '千千' })).toBeTruthy();
        expect(screen.getByLabelText('计时结束提示')).toHaveProperty('value', 'playVideo');
        expect(screen.getByLabelText('视频选项')).toHaveProperty('value', 'qianqian');
    });

    it('applies topWindow as the end action', () => {
        render(<SettingsPanel />);

        fireEvent.change(screen.getByLabelText('计时结束提示'), { target: { value: 'topWindow' } });
        fireEvent.click(screen.getByRole('button', { name: '应用' }));

        expect(usePomodoroStore.getState().endActionMode).toBe('topWindow');
        expect(usePomodoroStore.getState().endActionVideo).toEqual({
            sourceKind: 'builtin',
            builtinVideoId: 'qianqian',
            customVideoPath: '',
        });
    });

    it('applying only the end action does not reset a running timer', () => {
        usePomodoroStore.setState({
            remainingSeconds: 1234,
            currentPhase: 'focus',
            isRunning: true,
        });
        render(<SettingsPanel />);

        fireEvent.change(screen.getByLabelText('计时结束提示'), { target: { value: 'topWindow' } });
        fireEvent.click(screen.getByRole('button', { name: '应用' }));

        const state = usePomodoroStore.getState();
        expect(state.endActionMode).toBe('topWindow');
        expect(state.remainingSeconds).toBe(1234);
        expect(state.currentPhase).toBe('focus');
        expect(state.isRunning).toBe(true);
    });

    it('keeps unsaved video draft when the mirrored store replaces the video object reference', () => {
        render(<SettingsPanel />);

        fireEvent.change(screen.getByLabelText('视频选项'), { target: { value: 'custom' } });
        expect(screen.getByLabelText('视频选项')).toHaveProperty('value', 'custom');

        act(() => {
            const current = usePomodoroStore.getState().endActionVideo;
            usePomodoroStore.setState({ endActionVideo: { ...current } });
        });

        expect(screen.getByLabelText('视频选项')).toHaveProperty('value', 'custom');
        expect(screen.getByRole('button', { name: '应用' })).toHaveProperty('disabled', false);
    });

    it('syncs clean end action drafts when the committed store value changes', () => {
        render(<SettingsPanel />);

        act(() => {
            usePomodoroStore.setState({
                endActionMode: 'topWindow',
                endActionVideo: {
                    sourceKind: 'builtin',
                    builtinVideoId: 'qianqian',
                    customVideoPath: '',
                },
            });
        });

        expect(screen.getByLabelText('计时结束提示')).toHaveProperty('value', 'topWindow');
        expect(screen.getByRole('button', { name: '应用' })).toHaveProperty('disabled', true);
    });

    it('selecting a custom webm shows the basename and applies the custom video', async () => {
        pickCustomWebmPathMock.mockResolvedValue('/Users/xpy/Videos/custom.webm');
        render(<SettingsPanel />);

        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: '选择自定义视频' }));
        });

        expect(screen.getByText('custom.webm')).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: '应用' }));

        expect(usePomodoroStore.getState().endActionMode).toBe('playVideo');
        expect(usePomodoroStore.getState().endActionVideo).toEqual({
            sourceKind: 'custom',
            builtinVideoId: 'qianqian',
            customVideoPath: '/Users/xpy/Videos/custom.webm',
        });
    });

    it('canceling the custom picker leaves the draft clean', async () => {
        render(<SettingsPanel />);

        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: '选择自定义视频' }));
        });

        const apply = screen.getByRole('button', { name: '应用' });
        expect(apply).toHaveProperty('disabled', true);
        expect(screen.getByText('未选择')).toBeTruthy();
        expect(usePomodoroStore.getState().endActionVideo.customVideoPath).toBe('');
    });
});

describe('OnlineTab parity with 8Le5R', () => {
    beforeEach(() => {
        useSettingsStore.setState({ activeTab: 'online' });
        useNetworkStore.setState({
            status: 'idle',
            roomCode: '',
            playerId: null,
            players: {},
            lastError: null,
        });
    });

    it('renders onlHistCard (历史房间) below the join form when not joined', () => {
        render(<SettingsPanel />);
        expect(screen.getByText('历史房间')).toBeTruthy();
    });

    it('renders onlBusyOverlay when status is connecting', () => {
        useNetworkStore.setState({ status: 'connecting' });
        render(<SettingsPanel />);
        expect(screen.getByText('正在加入房间…')).toBeTruthy();
    });

    it('does NOT render busy overlay when idle', () => {
        render(<SettingsPanel />);
        expect(screen.queryByText('正在加入房间…')).toBeNull();
    });
});

describe('GlobalTab parity with Pdj9C', () => {
    beforeEach(() => {
        useSettingsStore.setState({ activeTab: 'global' });
    });

    it('renders global controls without the obsolete target display setting', () => {
        render(<SettingsPanel />);
        expect(screen.getByText('界面缩放')).toBeTruthy();
        expect(screen.getByText('按键计数')).toBeTruthy();
        expect(screen.queryByText('目标显示器')).toBeNull();
        expect(screen.queryByText(/显示器 \d+/)).toBeNull();
    });

    it('shows accessibility permission banner when permissionGranted is false', async () => {
        invokeMock.mockResolvedValue({ granted: false, platform: 'macos' });
        useBindingKeyStore.setState({ permissionGranted: false, platform: 'macos' });

        await act(async () => {
            render(<SettingsPanel />);
        });

        expect(screen.getByText('需要辅助功能权限才能统计按键')).toBeTruthy();
        expect(screen.getByRole('button', { name: '申请权限' })).toBeTruthy();
        expect(screen.getByRole('button', { name: '打开系统设置' })).toBeTruthy();
    });
});

describe('PetTab parity with v2ZgA', () => {
    beforeEach(() => {
        useSettingsStore.setState({ activeTab: 'pet' });
    });

    it('renders the placeholder card (v2ZgA is fit_content(70) with no children)', () => {
        render(<SettingsPanel />);
        expect(screen.getByText('桌宠形态')).toBeTruthy();
        expect(screen.getByText(/尚未实现/)).toBeTruthy();
    });
});
