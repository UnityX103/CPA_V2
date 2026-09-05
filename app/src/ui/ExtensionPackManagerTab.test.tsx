import { act, cleanup, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    useExtensionPackStore,
    useExtensionPackSync,
    type ExtensionPackProgress,
    type ExtensionPackId,
    type ExtensionPackStatus,
} from '../domain/extensionPacks';
import { ExtensionPackManagerTab } from './ExtensionPackManagerTab';

const invoke = vi.hoisted(() => vi.fn());
const listeners = vi.hoisted(() => new Map<string, (event: { payload: Omit<ExtensionPackProgress, 'packId'> }) => void>());

vi.mock('@tauri-apps/api/core', () => ({ invoke }));
vi.mock('@tauri-apps/api/event', () => ({
    listen: vi.fn(async (event, callback) => {
        listeners.set(event, callback);
        return () => listeners.delete(event);
    }),
}));

function status(
    id: ExtensionPackId,
    installed: boolean,
    enabled: boolean,
): ExtensionPackStatus {
    return {
        id,
        installed,
        enabled,
        version: installed ? '1.0.0' : null,
        target: 'macos-arm64',
        message: '',
    };
}

beforeEach(() => {
    invoke.mockReset();
    listeners.clear();
    useExtensionPackStore.setState({
        hydrated: true,
        busyPackId: null,
        progress: null,
        error: null,
        statuses: {
            'video.core': status('video.core', true, true),
            'video.editor': status('video.editor', true, true),
            'pet.core': status('pet.core', false, false),
            'pet.cockroach-invasion': status('pet.cockroach-invasion', false, false),
        },
    });
});

afterEach(cleanup);

describe('ExtensionPackManagerTab', () => {
    it('ignores late progress and progress from a different pack family', async () => {
        invoke.mockResolvedValue(Object.values(useExtensionPackStore.getState().statuses));
        render(<ExtensionPackManagerTab />);
        await act(async () => { renderHook(() => useExtensionPackSync()); });
        const emit = (event: string, stage: ExtensionPackProgress['stage'] = 'download') => {
            listeners.get(event)!({ payload: { stage, downloadedBytes: 0, totalBytes: null, message: '模块下载完成' } });
        };
        act(() => {
            useExtensionPackStore.setState({ busyPackId: 'video.core' });
            emit('cockroach-module-progress');
        });
        expect(useExtensionPackStore.getState().progress).toBeNull();
        act(() => emit('video-editor-module-progress'));
        expect(screen.getByLabelText('视频通用包下载进度')).toBeTruthy();
        act(() => {
            useExtensionPackStore.setState({ busyPackId: null, progress: null });
            emit('video-editor-module-progress', 'complete');
            emit('video-editor-module-progress');
        });
        expect(useExtensionPackStore.getState().progress).toBeNull();
        expect(screen.queryByLabelText('视频通用包下载进度')).toBeNull();
        expect(screen.queryByLabelText('AI 视频编辑下载进度')).toBeNull();
    });

    it.each([false, true])('clears download progress when the install settles (failure: %s)', async (fails) => {
        let finish!: () => void;
        invoke.mockImplementation(() => new Promise((resolve, reject) => {
            finish = () => fails
                ? reject(new Error('安装失败'))
                : resolve(Object.values(useExtensionPackStore.getState().statuses));
        }));
        render(<ExtensionPackManagerTab />);
        let installation!: Promise<void>;
        act(() => {
            installation = useExtensionPackStore.getState().install('video.editor');
            useExtensionPackStore.setState({ progress: {
                packId: 'video.editor', stage: 'download', downloadedBytes: 50,
                totalBytes: 100, message: '下载中',
            } });
        });
        expect(screen.getByLabelText('AI 视频编辑下载进度')).toBeTruthy();
        await act(async () => { finish(); await installation; });
        expect(screen.queryByLabelText('AI 视频编辑下载进度')).toBeNull();
        expect(useExtensionPackStore.getState().progress).toBeNull();
        if (fails) expect(screen.getByRole('alert').textContent).toBe('安装失败');
    });

    it('offers upgrade, disable and uninstall for installed packs', () => {
        render(<ExtensionPackManagerTab />);

        expect(screen.getByText('AI 视频编辑')).toBeTruthy();
        expect(screen.getByText('蟑螂入侵')).toBeTruthy();
        expect(screen.getByText('视频通用包')).toBeTruthy();
        expect(screen.getByText('宠物通用包')).toBeTruthy();
        expect(screen.getByRole('button', { name: '升级 AI 视频编辑' })).toBeTruthy();
        expect(screen.getByRole('button', { name: '禁用 AI 视频编辑' })).toBeTruthy();
        expect(screen.getByRole('button', { name: '卸载 AI 视频编辑' })).toBeTruthy();
        expect(screen.getByRole('button', { name: '下载 蟑螂入侵' })).toBeTruthy();

        const commonUninstall = screen.getByRole('button', { name: '卸载 视频通用包' });
        expect((commonUninstall as HTMLButtonElement).disabled).toBe(true);
    });
});
