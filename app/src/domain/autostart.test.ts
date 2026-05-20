import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyAutostartEnabled, readAutostartEnabled } from './autostart';

const plugin = vi.hoisted(() => ({
    enable: vi.fn(),
    disable: vi.fn(),
    isEnabled: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-autostart', () => plugin);

beforeEach(() => {
    plugin.enable.mockReset();
    plugin.disable.mockReset();
    plugin.isEnabled.mockReset();
});

describe('autostart domain helper', () => {
    it('reads the current plugin state', async () => {
        plugin.isEnabled.mockResolvedValue(true);

        await expect(readAutostartEnabled(false)).resolves.toBe(true);

        expect(plugin.isEnabled).toHaveBeenCalledTimes(1);
    });

    it('returns the fallback when reading fails', async () => {
        plugin.isEnabled.mockRejectedValue(new Error('plugin unavailable'));

        await expect(readAutostartEnabled(false)).resolves.toBe(false);
    });

    it('enables autostart and returns confirmed state', async () => {
        plugin.enable.mockResolvedValue(undefined);
        plugin.isEnabled.mockResolvedValue(true);

        await expect(applyAutostartEnabled(true, false)).resolves.toBe(true);

        expect(plugin.enable).toHaveBeenCalledTimes(1);
        expect(plugin.disable).not.toHaveBeenCalled();
    });

    it('disables autostart and returns confirmed state', async () => {
        plugin.disable.mockResolvedValue(undefined);
        plugin.isEnabled.mockResolvedValue(false);

        await expect(applyAutostartEnabled(false, true)).resolves.toBe(false);

        expect(plugin.disable).toHaveBeenCalledTimes(1);
        expect(plugin.enable).not.toHaveBeenCalled();
    });

    it('falls back to the previous confirmed state when applying fails and re-query fails', async () => {
        plugin.enable.mockRejectedValue(new Error('registration failed'));
        plugin.isEnabled.mockRejectedValue(new Error('query failed'));

        await expect(applyAutostartEnabled(true, false)).resolves.toBe(false);
    });
});
