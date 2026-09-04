import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CockroachModulePanel } from './CockroachModulePanel';

const invoke = vi.hoisted(() => vi.fn());

vi.mock('@tauri-apps/api/core', () => ({ invoke }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }));

afterEach(() => {
    cleanup();
    invoke.mockReset();
});

describe('CockroachModulePanel', () => {
    it('keeps package lifecycle actions out of the feature settings panel', async () => {
        invoke.mockResolvedValue({
            installed: true,
            running: false,
            version: '1.1.0',
            target: 'macos-arm64',
            message: '蟑螂模块已下载',
            settings: { maxCount: 30, babyGrowthMinutes: 10 },
        });

        render(<CockroachModulePanel />);

        expect(await screen.findByRole('spinbutton', { name: '最大蟑螂数量' })).toBeTruthy();
        expect(screen.queryByRole('button', { name: '下载蟑螂模块' })).toBeNull();
        expect(screen.queryByRole('button', { name: '删除蟑螂模块' })).toBeNull();
        expect(screen.getByText(/安装、升级、启停与卸载请前往“扩展包”/)).toBeTruthy();
    });
});
