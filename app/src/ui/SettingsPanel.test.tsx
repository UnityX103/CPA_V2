// CSS-text geometry guard — jsdom does not load stylesheets, so we parse the CSS source.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { useSettingsStore } from '../domain/settings';
import { useNetworkStore } from '../domain/network';
import { useBindingKeyStore } from '../domain/bindingKey';
import { SettingsPanel } from './SettingsPanel';
import { DangerousChangeDialog } from './DangerousChangeDialog';

function cssRule(css: string, selector: string): string {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const ruleMatch = css.match(new RegExp(`${escaped}\\s*\\{[^}]*\\}`));
    expect(ruleMatch, `${selector} rule not found`).toBeTruthy();
    return ruleMatch![0];
}

function cssDecl(rule: string, property: string): string | null {
    const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = rule.match(new RegExp(`(?:^|[;{]\\s*)${escaped}\\s*:\\s*([^;]+)`));
    return match ? match[1].trim() : null;
}

function renderSettingsPanelWithDangerDialog() {
    return render(
        <>
            <SettingsPanel />
            <DangerousChangeDialog />
        </>,
    );
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
    useSettingsStore.setState({
        activeTab: 'pomodoro',
        uiScale: 1.0,
        committedUiScale: 1.0,
        dangerousChange: null,
    });
    cleanup();
});

afterEach(() => {
    vi.useRealTimers();
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

    it('content empty area pointer down triggers native window drag', async () => {
        render(<SettingsPanel />);
        const content = screen.getByRole('dialog', { name: '设置' }).querySelector('.settings-content')!;
        await act(async () => {
            fireEvent.pointerDown(content, { button: 0 });
        });
        expect(startDragging).toHaveBeenCalledTimes(1);
    });

    it('right-clicking empty content does NOT trigger drag', async () => {
        render(<SettingsPanel />);
        const content = screen.getByRole('dialog', { name: '设置' }).querySelector('.settings-content')!;
        await act(async () => {
            fireEvent.pointerDown(content, { button: 2 });
        });
        expect(startDragging).not.toHaveBeenCalled();
    });

    it('clicking a settings tab does NOT trigger drag', async () => {
        render(<SettingsPanel />);
        const tab = screen.getByRole('button', { name: '联机' });
        await act(async () => {
            fireEvent.pointerDown(tab, { button: 0 });
        });
        expect(startDragging).not.toHaveBeenCalled();
    });

    it('clicking an input does NOT trigger drag', async () => {
        render(<SettingsPanel />);
        const input = screen.getAllByRole('spinbutton')[0];
        await act(async () => {
            fireEvent.pointerDown(input, { button: 0 });
        });
        expect(startDragging).not.toHaveBeenCalled();
    });

    it('clicking the scale slider does NOT trigger drag', async () => {
        useSettingsStore.setState({ activeTab: 'global' });
        render(<SettingsPanel />);
        const slider = screen.getByRole('slider');
        await act(async () => {
            fireEvent.pointerDown(slider, { button: 0 });
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

    it('CSS lets the shell adapt to window width and stay bounded by window height', () => {
        const css = readFileSync(path.join(here, 'SettingsPanel.css'), 'utf8');
        const rule = cssRule(css, '.settings-panel');
        expect(rule).toMatch(/width:\s*100%\s*;/);
        expect(rule).not.toMatch(/width:\s*\d+px\s*;/);
        expect(cssDecl(rule, 'height')).toBe('100%');
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

    it('shows a blocking dangerous-change dialog when a scale preview is pending', () => {
        useSettingsStore.setState({
            activeTab: 'global',
            uiScale: 1.5,
            committedUiScale: 1.0,
            dangerousChange: {
                id: 'scale-preview',
                kind: 'uiScale',
                previousValue: 1.0,
                nextValue: 1.5,
                expiresAt: Date.now() + 5000,
            },
        });

        renderSettingsPanelWithDangerDialog();

        expect(screen.getByRole('dialog', { name: '应用界面缩放？' })).toBeTruthy();
        expect(screen.getByText(/剩余 5s 后自动还原/)).toBeTruthy();
        expect(screen.getByTestId('dangerous-change-mask')).toBeTruthy();
    });

    it('dialog apply and cancel route to the pending dangerous action', async () => {
        useSettingsStore.setState({
            activeTab: 'global',
            uiScale: 1.5,
            committedUiScale: 1.0,
            dangerousChange: {
                id: 'scale-preview',
                kind: 'uiScale',
                previousValue: 1.0,
                nextValue: 1.5,
                expiresAt: Date.now() + 5000,
            },
        });
        const applySpy = vi.spyOn(useSettingsStore.getState(), 'applyDangerousChange');
        const revertSpy = vi.spyOn(useSettingsStore.getState(), 'revertDangerousChange');

        renderSettingsPanelWithDangerDialog();

        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: '应用' }));
        });
        expect(applySpy).toHaveBeenCalledWith('scale-preview');

        await act(async () => {
            useSettingsStore.setState({
                dangerousChange: {
                    id: 'scale-preview',
                    kind: 'uiScale',
                    previousValue: 1.0,
                    nextValue: 1.5,
                    expiresAt: Date.now() + 5000,
                },
            });
        });

        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: '取消' }));
        });
        expect(revertSpy).toHaveBeenCalledWith('scale-preview');
    });

    it('dialog countdown expiry reverts the pending dangerous change', async () => {
        vi.useFakeTimers();
        useSettingsStore.setState({
            activeTab: 'global',
            uiScale: 1.5,
            committedUiScale: 1.0,
            dangerousChange: {
                id: 'scale-preview',
                kind: 'uiScale',
                previousValue: 1.0,
                nextValue: 1.5,
                expiresAt: Date.now() + 5000,
            },
        });
        const revertSpy = vi.spyOn(useSettingsStore.getState(), 'revertDangerousChange');

        renderSettingsPanelWithDangerDialog();

        await act(async () => {
            vi.advanceTimersByTime(5000);
        });

        expect(revertSpy).toHaveBeenCalledWith('scale-preview');
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
