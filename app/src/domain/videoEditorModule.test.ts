import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    launchVideoEditorModule,
    readVideoEditorModuleStatus,
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
        await expect(launchVideoEditorModule()).resolves.toBeUndefined();

        expect(invoke.mock.calls.map(([command]) => command)).toEqual([
            'video_editor_module_status',
            'launch_video_editor_module',
        ]);
    });
});
