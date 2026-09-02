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
    it('explains the reusable noncommercial runtime and logic download', async () => {
        invoke.mockResolvedValue({
            installed: false,
            running: false,
            version: null,
            target: 'macos-arm64',
            message: '蟑螂模块尚未下载',
            settings: { maxCount: 30, babyGrowthMinutes: 10 },
        });

        render(<CockroachModulePanel />);

        expect(await screen.findByText(/首次下载基础运行时、通用依赖与业务逻辑/)).toBeTruthy();
        expect(screen.getByText(/后续业务更新会复用已校验的运行时与依赖/)).toBeTruthy();
        expect(screen.getByText(/仅限非商业开源学习/)).toBeTruthy();
    });
});
