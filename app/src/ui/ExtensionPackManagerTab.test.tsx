import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    useExtensionPackStore,
    type ExtensionPackId,
    type ExtensionPackStatus,
} from '../domain/extensionPacks';
import { ExtensionPackManagerTab } from './ExtensionPackManagerTab';

const invoke = vi.hoisted(() => vi.fn());

vi.mock('@tauri-apps/api/core', () => ({ invoke }));

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
