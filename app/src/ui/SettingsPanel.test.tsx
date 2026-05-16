// CSS-text geometry guard — jsdom does not load stylesheets, so we parse the CSS source.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { useSettingsStore } from '../domain/settings';
import { useNetworkStore } from '../domain/network';
import { SettingsPanel } from './SettingsPanel';

const { startDragging, invokeMock, listenMock } = vi.hoisted(() => ({
    startDragging: vi.fn(),
    invokeMock: vi.fn(),
    listenMock: vi.fn(() => Promise.resolve(() => {})),
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

beforeEach(() => {
    startDragging.mockReset();
    invokeMock.mockReset();
    invokeMock.mockResolvedValue({ granted: true, platform: 'macos' });
    listenMock.mockReset();
    listenMock.mockResolvedValue(() => {});
    useSettingsStore.setState({ activeTab: 'pomodoro' });
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
    it('CSS pins the 460 × 440 shell (vnYnS 460×394 + 46px to fit Pomodoro tab without scroll, WSnlp collapsed per design)', () => {
        const here = path.dirname(fileURLToPath(import.meta.url));
        const css = readFileSync(path.join(here, 'SettingsPanel.css'), 'utf8');
        const ruleMatch = css.match(/\.settings-panel\s*\{[^}]*\}/);
        expect(ruleMatch, '.settings-panel rule not found').toBeTruthy();
        const rule = ruleMatch![0];
        expect(rule).toMatch(/width:\s*460px\s*;/);
        expect(rule).toMatch(/height:\s*440px\s*;/);
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

    it('renders the three Pdj9C cards', () => {
        render(<SettingsPanel />);
        expect(screen.getByText('界面缩放')).toBeTruthy();
        expect(screen.getByText('目标显示器')).toBeTruthy();
        expect(screen.getByText('按键计数')).toBeTruthy();
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
