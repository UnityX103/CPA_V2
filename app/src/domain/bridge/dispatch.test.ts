import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { BRIDGE_VERSION, EVT_DISPATCH } from './protocol';
import { dispatch } from './dispatch';

describe('bridge dispatch', () => {
    const emit = vi.fn();

    beforeEach(() => {
        emit.mockReset();
        vi.spyOn(WebviewWindow, 'getByLabel').mockResolvedValue({ emit } as never);
    });

    it('emits retained actions to the main window', async () => {
        const payload = {
            v: BRIDGE_VERSION,
            store: 'pomodoro' as const,
            action: 'setAutoPinAfterFocus' as const,
            args: [false] as [boolean],
        };

        await dispatch(payload);

        expect(emit).toHaveBeenCalledWith(EVT_DISPATCH, payload);
    });
});
