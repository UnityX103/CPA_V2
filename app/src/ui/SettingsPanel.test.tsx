// CSS-text geometry guard — jsdom does not load stylesheets, so we parse the CSS source.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { useSettingsStore } from '../domain/settings';
import { usePomodoroStore } from '../domain/pomodoro';
import { useNetworkStore } from '../domain/network';
import { useBindingKeyStore } from '../domain/bindingKey';
import { useAppUpdateStore } from '../domain/appUpdate';
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
    useSettingsStore.setState({
        activeTab: 'pomodoro',
        uiScale: 1.0,
        committedUiScale: 1.0,
        showActiveAppWindowTitle: true,
        autostartEnabled: false,
        dangerousChange: null,
    });
    usePomodoroStore.setState({
        focusDurationSeconds: 25 * 60,
        breakDurationSeconds: 5 * 60,
        totalRounds: 4,
        currentRound: 1,
        remainingSeconds: 25 * 60,
        currentPhase: 'focus',
        isRunning: false,
        isPinned: false,
        autoStartBreak: false,
        consecutiveCompletedFocus: 0,
        endActionMode: 'playVideo',
        endActionVideo: {
            sourceKind: 'builtin',
            builtinVideoId: 'qianqian',
            customVideoPath: '',
        },
        lastEndEvent: null,
    });
    useAppUpdateStore.setState({
        autoUpdateEnabled: true,
        status: 'idle',
        currentVersion: '0.1.0',
        availableVersion: null,
        releaseNotes: null,
        lastCheckedAt: null,
        errorMessage: null,
        setAutoUpdateEnabled: async (enabled: boolean) => {
            useAppUpdateStore.setState({
                autoUpdateEnabled: enabled,
                status: enabled ? 'idle' : 'disabled',
                errorMessage: null,
            });
        },
        checkNow: async () => {
            useAppUpdateStore.setState({ status: 'checking', errorMessage: null });
        },
        restartForUpdate: async () => {},
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

    it('closing settings reverts a pending dangerous change before hiding the window', async () => {
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

        render(<SettingsPanel />);
        const closeBtn = screen.getByRole('button', { name: '关闭' });

        await act(async () => {
            fireEvent.click(closeBtn);
        });

        expect(revertSpy).toHaveBeenCalledWith('scale-preview');
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
        const settingsBuilder = libRs.match(/fn build_settings_window_hidden[\s\S]*?Ok\(w\)/)?.[0] ?? '';
        expect(settingsBuilder).toMatch(/\.resizable\(true\)/);
        expect(settingsBuilder).toMatch(/\.min_inner_size\(\s*SETTINGS_MIN_W,\s*SETTINGS_MIN_H\s*\)/);
        expect(settingsBuilder).not.toMatch(/\.resizable\(false\)/);
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

    it('settings modal layer can cover the unscaled window while content scales', () => {
        const globalCss = readFileSync(path.join(here, '../styles/global.css'), 'utf8');
        const settingsCss = readFileSync(path.join(here, 'SettingsPanel.css'), 'utf8');

        expect(globalCss).toMatch(/\.settings-window-root\s*\{[^}]*--app-ui-scale:/);
        expect(globalCss).toMatch(/\.settings-scale-content\s*\{[^}]*zoom:\s*var\(--app-ui-scale\)/);
        expect(settingsCss).toMatch(/\.danger-modal-layer\s*\{[^}]*position:\s*absolute;[^}]*inset:\s*0;/);
    });

    it('keeps root wrappers fixed while only contentArea scrolls vertically', () => {
        const globalCss = readFileSync(path.join(here, '../styles/global.css'), 'utf8');
        const settingsCss = readFileSync(path.join(here, 'SettingsPanel.css'), 'utf8');

        const windowRoot = cssRule(globalCss, '.settings-window-root');
        const scaleContent = cssRule(globalCss, '.settings-scale-content');
        const panel = cssRule(settingsCss, '.settings-panel');
        const body = cssRule(settingsCss, '.settings-body');
        const content = cssRule(settingsCss, '.settings-content');
        const scroll = cssRule(settingsCss, '.settings-content-scroll');

        expect(cssDecl(windowRoot, 'overflow')).toBe('hidden');
        expect(cssDecl(scaleContent, 'height')).toBe('100%');
        expect(cssDecl(scaleContent, 'overflow')).toBe('hidden');
        expect(cssDecl(panel, 'height')).toBe('100%');
        expect(cssDecl(body, 'overflow')).toBe('hidden');
        expect(cssDecl(content, 'overflow')).toBe('hidden');
        expect(cssDecl(scroll, 'overflow-y')).toBe('auto');
        expect(cssDecl(scroll, 'overflow-x')).toBe('hidden');
        expect(settingsCss.match(/overflow-y:\s*auto\s*;/g)).toHaveLength(1);
    });

    it('ordinary Apply is an overlay and does not reserve tab layout space', () => {
        const css = readFileSync(path.join(here, 'SettingsPanel.css'), 'utf8');
        const row = cssRule(css, '.apply-row');
        const hidden = cssRule(css, '.apply-row.hidden');

        expect(row).toMatch(/position:\s*absolute\s*;/);
        expect(row).toMatch(/height:\s*54px\s*;/);
        expect(row).toMatch(/padding:\s*8px\s+16px\s*;/);
        expect(hidden).toMatch(/display:\s*none\s*;/);
        expect(css).not.toMatch(/\.tab-pane\.has-apply\s*\{/);
    });
});

describe('PomodoroTab parity with gs1Tv', () => {
    it('renders pomoGrid + visible pomoFooter rows while custom video stays hidden by default', () => {
        render(<SettingsPanel />);
        // pomoGrid: work + break cards (label text)
        expect(screen.getByText('专注时长')).toBeTruthy();
        expect(screen.getByText('休息时长')).toBeTruthy();
        // pomoFooter rows (WSnlp 视频文件 omitted — enabled:false in design)
        expect(screen.getByText('结束提示音')).toBeTruthy();
        expect(screen.getByText('计时结束提示')).toBeTruthy();
        expect(screen.queryByText('视频文件')).toBeNull();
        expect(screen.queryByText('自定义视频文件')).toBeNull();
    });

    it('renders 自动开始休息 while omitting obsolete 总轮次', () => {
        render(<SettingsPanel />);
        expect(screen.queryByText('总轮次')).toBeNull();
        expect(screen.getByText('自动开始休息')).toBeTruthy();
    });

    it('keeps 自动开始休息 directly below 结束提示音 per fnZ59 ordering in PUI.pen', () => {
        render(<SettingsPanel />);

        const notif = screen.getByText('结束提示音');
        const autoStart = screen.getByText('自动开始休息');
        const endAction = screen.getByText('计时结束提示');

        expect(notif.compareDocumentPosition(autoStart) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(autoStart.compareDocumentPosition(endAction) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('hides the ordinary Apply overlay until a Pomodoro setting changes', () => {
        render(<SettingsPanel />);

        expect(screen.queryByRole('button', { name: '应用' })).toBeNull();

        fireEvent.click(screen.getByRole('button', { name: '自动开始休息' }));

        const apply = screen.getByRole('button', { name: '应用' }) as HTMLButtonElement;
        expect(apply.disabled).toBe(false);
    });

    it('hides the ordinary Apply overlay after applying Pomodoro changes', () => {
        render(<SettingsPanel />);

        fireEvent.click(screen.getByRole('button', { name: '自动开始休息' }));
        fireEvent.click(screen.getByRole('button', { name: '应用' }));

        expect(usePomodoroStore.getState().autoStartBreak).toBe(true);
        expect(screen.queryByRole('button', { name: '应用' })).toBeNull();
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
        expect(screen.getByRole('button', { name: '应用' })).toHaveProperty('disabled', true);
    });

    it('does not allow applying a custom video option until a file is selected', async () => {
        render(<SettingsPanel />);

        fireEvent.change(screen.getByLabelText('视频选项'), { target: { value: 'custom' } });
        expect(screen.getByText('自定义视频文件')).toBeTruthy();
        const apply = screen.getByRole('button', { name: '应用' });
        expect(apply).toHaveProperty('disabled', true);

        fireEvent.click(apply);
        expect(usePomodoroStore.getState().endActionVideo).toEqual({
            sourceKind: 'builtin',
            builtinVideoId: 'qianqian',
            customVideoPath: '',
        });

        pickCustomWebmPathMock.mockResolvedValue('/Users/xpy/Videos/custom.webm');
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: '选择自定义视频' }));
        });

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
        expect(screen.queryByRole('button', { name: '应用' })).toBeNull();
    });

    it('selecting a custom webm shows the basename and applies the custom video', async () => {
        pickCustomWebmPathMock.mockResolvedValue('/Users/xpy/Videos/custom.webm');
        render(<SettingsPanel />);

        fireEvent.change(screen.getByLabelText('视频选项'), { target: { value: 'custom' } });
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

    it('canceling the custom picker keeps the custom draft dirty but incomplete', async () => {
        render(<SettingsPanel />);

        fireEvent.change(screen.getByLabelText('视频选项'), { target: { value: 'custom' } });
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: '选择自定义视频' }));
        });

        expect(screen.getByRole('button', { name: '应用' })).toHaveProperty('disabled', true);
        expect(screen.getByText('未选择')).toBeTruthy();
        expect(usePomodoroStore.getState().endActionVideo.customVideoPath).toBe('');
    });

    it('hides the custom video row again when switching back to a bundled video', () => {
        render(<SettingsPanel />);

        fireEvent.change(screen.getByLabelText('视频选项'), { target: { value: 'custom' } });
        expect(screen.getByText('自定义视频文件')).toBeTruthy();

        fireEvent.change(screen.getByLabelText('视频选项'), { target: { value: 'qianqian' } });

        expect(screen.queryByText('自定义视频文件')).toBeNull();
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
        expect(screen.getByText('显示打开的文件名')).toBeTruthy();
        expect(screen.getByText('开机自启动')).toBeTruthy();
        expect(screen.getByText('自动下载并安装更新')).toBeTruthy();
        expect(screen.getByText('按键计数')).toBeTruthy();
        expect(screen.queryByText('目标显示器')).toBeNull();
        expect(screen.queryByText(/显示器 \d+/)).toBeNull();
    });

    it('keeps autostart between active title and app update controls', () => {
        render(<SettingsPanel />);

        const activeTitle = screen.getByText('显示打开的文件名');
        const autostart = screen.getByText('开机自启动');
        const autoUpdate = screen.getByText('自动下载并安装更新');
        const bindingKey = screen.getByText('按键计数');

        expect(activeTitle.compareDocumentPosition(autostart) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(autostart.compareDocumentPosition(autoUpdate) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(autoUpdate.compareDocumentPosition(bindingKey) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('toggles whether active app window titles are shown', () => {
        render(<SettingsPanel />);
        const toggle = screen.getByRole('button', { name: '显示打开的文件名' });

        expect(toggle.getAttribute('aria-pressed')).toBe('true');
        fireEvent.click(toggle);
        expect(useSettingsStore.getState().showActiveAppWindowTitle).toBe(false);
    });

    it('routes autostart toggles to the settings store action', () => {
        const setAutostartEnabled = vi.fn();
        useSettingsStore.setState({ setAutostartEnabled });
        render(<SettingsPanel />);

        const toggle = screen.getByRole('button', { name: '开机自启动' });

        expect(toggle.getAttribute('aria-pressed')).toBe('false');
        fireEvent.click(toggle);
        expect(setAutostartEnabled).toHaveBeenCalledWith(true);
    });

    it('shows app update status and can disable automatic updates', () => {
        render(<SettingsPanel />);

        expect(screen.getByText('当前版本 0.1.0 · 等待检查')).toBeTruthy();
        const toggle = screen.getByRole('button', { name: '自动下载并安装更新' });
        expect(toggle.getAttribute('aria-pressed')).toBe('true');

        fireEvent.click(toggle);

        expect(useAppUpdateStore.getState().autoUpdateEnabled).toBe(false);
        expect(screen.getByText('自动更新已关闭')).toBeTruthy();
    });

    it('routes the manual update check button to the app update store', async () => {
        const checkNow = vi.fn(async () => {
            useAppUpdateStore.setState({ status: 'checking' });
        });
        useAppUpdateStore.setState({ checkNow });

        render(<SettingsPanel />);

        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: '立即检查' }));
        });

        expect(checkNow).toHaveBeenCalledTimes(1);
        expect(screen.getByText('当前版本 0.1.0 · 正在检查')).toBeTruthy();
    });

    it('shows restart action when an update is ready', async () => {
        const restartForUpdate = vi.fn(async () => {});
        useAppUpdateStore.setState({
            status: 'readyToRestart',
            availableVersion: '0.2.0',
            restartForUpdate,
        });

        render(<SettingsPanel />);

        expect(screen.getByText('新版本 0.2.0 已安装 · 重启后生效')).toBeTruthy();
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: '重启更新' }));
        });
        expect(restartForUpdate).toHaveBeenCalledTimes(1);
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

    it('shows listener health banner when permission is granted but listener is stopped', async () => {
        invokeMock.mockImplementation((command: string) => {
            if (command === 'accessibility_status') {
                return Promise.resolve({ granted: true, platform: 'macos' });
            }
            if (command === 'key_counter_health') {
                return Promise.resolve({
                    permissionGranted: true,
                    platform: 'macos',
                    listenerRunning: false,
                    lastStartError: '[key_counter] CGEventTap create failed',
                    lastStartedAtMs: null,
                    lastStoppedAtMs: 1770000001000,
                    bundleIdentifier: 'com.nanzhai.cpa',
                    executablePath: '/Applications/桌宠番茄钟.app/Contents/MacOS/app',
                    codeSignIdentifier: 'app-461de596266994b3',
                });
            }
            return Promise.resolve();
        });
        useBindingKeyStore.setState({
            permissionGranted: true,
            platform: 'macos',
            listenerRunning: false,
            listenerError: '[key_counter] CGEventTap create failed',
            listenerDiagnostic: {
                bundleIdentifier: 'com.nanzhai.cpa',
                executablePath: '/Applications/桌宠番茄钟.app/Contents/MacOS/app',
                codeSignIdentifier: 'app-461de596266994b3',
            },
        });

        await act(async () => {
            render(<SettingsPanel />);
        });

        expect(screen.getByText('已授予权限，但监听器未启动')).toBeTruthy();
        expect(screen.getByText('[key_counter] CGEventTap create failed')).toBeTruthy();
        expect(screen.getByText(/app-461de596266994b3/)).toBeTruthy();
        expect(screen.getByRole('button', { name: '重试监听' })).toBeTruthy();
    });

    it('retries listener from the settings banner', async () => {
        invokeMock.mockImplementation((command: string) => {
            if (command === 'restart_key_counter_listener') {
                return Promise.resolve({
                    permissionGranted: true,
                    platform: 'macos',
                    listenerRunning: true,
                    lastStartError: null,
                    lastStartedAtMs: 1770000002000,
                    lastStoppedAtMs: 1770000001000,
                    bundleIdentifier: 'com.nanzhai.cpa',
                    executablePath: '/Applications/桌宠番茄钟.app/Contents/MacOS/app',
                    codeSignIdentifier: 'app-461de596266994b3',
                });
            }
            return Promise.resolve({ granted: true, platform: 'macos' });
        });
        useBindingKeyStore.setState({
            permissionGranted: true,
            platform: 'macos',
            listenerRunning: false,
            listenerError: 'tap failed',
            listenerDiagnostic: null,
        });

        await act(async () => {
            render(<SettingsPanel />);
        });
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: '重试监听' }));
        });

        expect(invokeMock).toHaveBeenCalledWith('restart_key_counter_listener');
        expect(useBindingKeyStore.getState().listenerRunning).toBe(true);
    });

    it('finishes a Windows key capture from the focused settings window', async () => {
        invokeMock.mockResolvedValue({ granted: true, platform: 'windows' });
        useBindingKeyStore.setState({
            permissionGranted: true,
            platform: 'windows',
            entries: [{
                id: 'bk-space',
                label: '未绑定',
                keyCode: -1,
                pressCount: 3,
                enabled: true,
            }],
            capturingId: 'bk-space',
        });

        await act(async () => {
            render(<SettingsPanel />);
        });

        await act(async () => {
            fireEvent.keyDown(window, { key: ' ', code: 'Space', keyCode: 32, which: 32 });
        });

        expect(useBindingKeyStore.getState().capturingId).toBe(null);
        expect(useBindingKeyStore.getState().entries[0]).toEqual(expect.objectContaining({
            keyCode: 32,
            label: 'Space',
            pressCount: 0,
        }));
    });

    it('scale slider applies only when dragging ends', async () => {
        useSettingsStore.setState({
            activeTab: 'global',
            uiScale: 1.0,
            committedUiScale: 1.0,
            dangerousChange: null,
        });
        const previewSpy = vi.spyOn(useSettingsStore.getState(), 'previewDangerousUiScale');

        render(<SettingsPanel />);
        const slider = screen.getByRole('slider');
        vi.spyOn(slider, 'getBoundingClientRect').mockReturnValue({
            x: 0,
            y: 0,
            left: 0,
            top: 0,
            right: 200,
            bottom: 24,
            width: 200,
            height: 24,
            toJSON: () => ({}),
        } as DOMRect);
        slider.setPointerCapture = vi.fn();
        slider.releasePointerCapture = vi.fn();

        await act(async () => {
            fireEvent.pointerDown(slider, { pointerId: 1, button: 0, clientX: 100 });
            fireEvent.pointerMove(slider, { pointerId: 1, clientX: 160 });
        });

        expect(previewSpy).not.toHaveBeenCalled();
        expect(slider.getAttribute('aria-valuenow')).toBe('170');
        expect(screen.getByText('1.7×')).toBeTruthy();

        await act(async () => {
            fireEvent.pointerUp(slider, { pointerId: 1, clientX: 160 });
        });

        expect(previewSpy).toHaveBeenCalledTimes(1);
        expect(previewSpy).toHaveBeenCalledWith(1.7);
        expect(slider.setPointerCapture).toHaveBeenCalledWith(1);
        expect(slider.releasePointerCapture).toHaveBeenCalledWith(1);
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
