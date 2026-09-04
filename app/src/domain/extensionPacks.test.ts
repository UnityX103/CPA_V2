import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    createExtensionPackStore,
    extensionPackRegistry,
    settingsContributionsFor,
    type ExtensionPackStatus,
} from './extensionPacks';

const invoke = vi.hoisted(() => vi.fn());

vi.mock('@tauri-apps/api/core', () => ({ invoke }));

beforeEach(() => invoke.mockReset());

function status(
    id: ExtensionPackStatus['id'],
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

describe('extension pack registry', () => {
    it('contributes settings only for installed and enabled feature packs', () => {
        expect(extensionPackRegistry['video.editor'].dependencies).toEqual(['video.core']);
        expect(extensionPackRegistry['pet.cockroach-invasion'].dependencies).toEqual(['pet.core']);

        expect(settingsContributionsFor([
            status('video.core', true, true),
            status('video.editor', true, false),
            status('pet.core', true, true),
            status('pet.cockroach-invasion', true, true),
        ])).toEqual([
            {
                packId: 'pet.cockroach-invasion',
                tab: 'pet',
                label: '宠物',
                renderer: 'pet.cockroach-invasion',
            },
        ]);
    });

    it('installs a feature through the native dependency transaction', async () => {
        const installed = [
            status('video.core', true, true),
            status('video.editor', true, true),
            status('pet.core', false, false),
            status('pet.cockroach-invasion', false, false),
        ];
        invoke.mockResolvedValue(installed);
        const store = createExtensionPackStore();

        await store.getState().install('video.editor');

        expect(invoke).toHaveBeenCalledWith('install_extension_pack', {
            packId: 'video.editor',
        });
        expect(store.getState().statuses['video.core']).toEqual(installed[0]);
        expect(store.getState().statuses['video.editor']).toEqual(installed[1]);
    });

    it('changes enablement through the native lifecycle transaction', async () => {
        const disabled = [
            status('video.core', true, true),
            status('video.editor', true, false),
            status('pet.core', false, false),
            status('pet.cockroach-invasion', false, false),
        ];
        invoke.mockResolvedValue(disabled);
        const store = createExtensionPackStore();

        await store.getState().setEnabled('video.editor', false);

        expect(invoke).toHaveBeenCalledWith('set_extension_pack_enabled', {
            packId: 'video.editor',
            enabled: false,
        });
        expect(store.getState().statuses['video.editor'].enabled).toBe(false);
    });

    it('uninstalls a pack through the native dependency transaction', async () => {
        const uninstalled = [
            status('video.core', true, true),
            status('video.editor', false, false),
            status('pet.core', false, false),
            status('pet.cockroach-invasion', false, false),
        ];
        invoke.mockResolvedValue(uninstalled);
        const store = createExtensionPackStore();

        await store.getState().uninstall('video.editor');

        expect(invoke).toHaveBeenCalledWith('uninstall_extension_pack', {
            packId: 'video.editor',
        });
        expect(store.getState().statuses['video.editor'].installed).toBe(false);
        expect(store.getState().statuses['video.core'].installed).toBe(true);
    });

    it('hydrates the catalog from the native installation state', async () => {
        const nativeStatuses = [
            status('video.core', true, true),
            status('video.editor', true, true),
            status('pet.core', false, false),
            status('pet.cockroach-invasion', false, false),
        ];
        invoke.mockResolvedValue(nativeStatuses);
        const store = createExtensionPackStore();

        await store.getState().refresh();

        expect(invoke).toHaveBeenCalledWith('extension_pack_statuses');
        expect(store.getState().hydrated).toBe(true);
        expect(store.getState().statuses['video.editor'].installed).toBe(true);
    });
});
