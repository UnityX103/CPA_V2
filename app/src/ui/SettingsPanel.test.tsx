// CSS-text geometry guard — jsdom does not load stylesheets, so we parse the CSS source.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { useSettingsStore } from '../domain/settings';
import { useNetworkStore } from '../domain/network';
import { useBindingKeyStore } from '../domain/bindingKey';
import { SettingsPanel } from './SettingsPanel';

function cssRule(css: string, selector: string): string {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const ruleMatch = css.match(new RegExp(`${escaped}\\s*\\{[^}]*\\}`));
    expect(ruleMatch, `${selector} rule not found`).toBeTruthy();
    return ruleMatch![0];
}

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
    const here = path.dirname(fileURLToPath(import.meta.url));

    it('CSS keeps the shell at the fixed design width and height', () => {
        const css = readFileSync(path.join(here, 'SettingsPanel.css'), 'utf8');
        const rule = cssRule(css, '.settings-panel');
        expect(rule).toMatch(/width:\s*460px\s*;/);
        expect(rule).toMatch(/height:\s*440px\s*;/);
        expect(rule).not.toMatch(/width:\s*100%\s*;/);
        expect(rule).not.toMatch(/min-height:\s*100%\s*;/);
    });

    it('scrolls tab content inside the fixed shell instead of growing the shell', () => {
        const css = readFileSync(path.join(here, 'SettingsPanel.css'), 'utf8');
        expect(cssRule(css, '.settings-body')).toMatch(/min-height:\s*0\s*;/);
        const contentRule = cssRule(css, '.settings-content');
        expect(contentRule).toMatch(/min-height:\s*0\s*;/);
        expect(contentRule).toMatch(/overflow:\s*hidden\s*;/);
        const scrollRule = cssRule(css, '.settings-content-scroll');
        expect(scrollRule).toMatch(/flex:\s*1\s*;/);
        expect(scrollRule).toMatch(/min-height:\s*0\s*;/);
        expect(scrollRule).toMatch(/width:\s*100%\s*;/);
        expect(scrollRule).toMatch(/max-width:\s*100%\s*;/);
        expect(scrollRule).toMatch(/overflow-y:\s*auto\s*;/);
        const tabPaneRule = cssRule(css, '.tab-pane');
        expect(tabPaneRule).toMatch(/width:\s*100%\s*;/);
        expect(tabPaneRule).toMatch(/max-width:\s*100%\s*;/);
    });

    it('settings window keeps its fixed shell size instead of being resizable', () => {
        const libRs = readFileSync(path.join(here, '../../src-tauri/src/lib.rs'), 'utf8');
        expect(libRs).toMatch(/\.inner_size\(\s*SETTINGS_W,\s*SETTINGS_H\s*\)/);
        expect(libRs).toMatch(/\.resizable\(false\)/);
        expect(libRs).not.toMatch(/\.resizable\(true\)/);
        expect(libRs).not.toMatch(/\.min_inner_size\(/);
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
