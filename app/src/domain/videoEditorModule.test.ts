import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    downloadVideoEditorModule,
    launchVideoEditorModule,
    readVideoEditorModuleStatus,
    uninstallVideoEditorModule,
    videoEditorModuleProgressText,
} from './videoEditorModule';

const invoke = vi.hoisted(() => vi.fn());

vi.mock('@tauri-apps/api/core', () => ({ invoke }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }));

beforeEach(() => invoke.mockReset());

describe('video editor module adapter', () => {
    it('uses the dedicated host-shell commands', async () => {
        const status = {
            installed: false,
            version: null,
            target: 'macos-arm64',
            message: '尚未下载',
        };
        invoke.mockImplementation((command: string) => (
            command === 'launch_video_editor_module'
                ? Promise.resolve(undefined)
                : Promise.resolve(status)
        ));

        await expect(readVideoEditorModuleStatus()).resolves.toEqual(status);
        await expect(downloadVideoEditorModule()).resolves.toEqual(status);
        await expect(launchVideoEditorModule()).resolves.toBeUndefined();
        await expect(uninstallVideoEditorModule()).resolves.toEqual(status);

        expect(invoke.mock.calls.map(([command]) => command)).toEqual([
            'video_editor_module_status',
            'download_video_editor_module',
            'launch_video_editor_module',
            'uninstall_video_editor_module',
        ]);
    });

    it('formats determinate and indeterminate download progress', () => {
        expect(videoEditorModuleProgressText({
            stage: 'download',
            downloadedBytes: 50,
            totalBytes: 200,
            message: '正在下载视频编辑模块',
        })).toBe('正在下载视频编辑模块 · 25%');
        expect(videoEditorModuleProgressText({
            stage: 'install',
            downloadedBytes: 200,
            totalBytes: 200,
            message: '正在安装视频编辑模块',
        })).toBe('正在安装视频编辑模块');
    });
});
