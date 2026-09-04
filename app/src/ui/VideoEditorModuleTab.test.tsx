import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useExtensionPackStore } from '../domain/extensionPacks';
import { VideoEditorModuleTab } from './VideoEditorModuleTab';

const invoke = vi.hoisted(() => vi.fn());

vi.mock('@tauri-apps/api/core', () => ({ invoke }));

beforeEach(() => {
    invoke.mockReset().mockResolvedValue(undefined);
    useExtensionPackStore.setState((state) => ({
        hydrated: true,
        statuses: {
            ...state.statuses,
            'video.core': {
                id: 'video.core',
                installed: true,
                enabled: true,
                version: 'engine 1.0.0 + models 1.0.0',
                target: 'macos-arm64',
                message: '',
            },
            'video.editor': {
                id: 'video.editor',
                installed: true,
                enabled: true,
                version: '1.3.0',
                target: 'macos-arm64',
                message: '',
            },
        },
    }));
});

afterEach(cleanup);

describe('VideoEditorModuleTab', () => {
    it('keeps package lifecycle actions in the extension manager', async () => {
        render(<VideoEditorModuleTab />);

        expect(screen.getByText('视频编辑功能包 1.3.0')).toBeTruthy();
        expect(screen.queryByRole('button', { name: '更新视频编辑模板' })).toBeNull();
        expect(screen.queryByRole('button', { name: '删除视频编辑模板' })).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: '打开视频编辑器' }));
        await vi.waitFor(() => {
            expect(invoke).toHaveBeenCalledWith('launch_video_editor_module');
        });
    });
});
