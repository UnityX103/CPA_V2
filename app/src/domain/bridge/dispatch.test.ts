import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    BRIDGE_VERSION,
    EVT_DISPATCH,
    EVT_DISPATCH_RESULT,
    type DispatchPayload,
} from './protocol';
import { dispatchConfirmed } from './dispatch';

const bridgeMocks = vi.hoisted(() => {
    const handlers = new Map<string, (event: { payload: unknown }) => void>();
    return {
        emit: vi.fn(),
        getByLabel: vi.fn(),
        handlers,
        listen: vi.fn((eventName: string, handler: (event: { payload: unknown }) => void) => {
            handlers.set(eventName, handler);
            return Promise.resolve(() => handlers.delete(eventName));
        }),
    };
});

vi.mock('@tauri-apps/api/webviewWindow', () => ({
    WebviewWindow: { getByLabel: bridgeMocks.getByLabel },
}));

vi.mock('@tauri-apps/api/event', () => ({ listen: bridgeMocks.listen }));

const payload = {
    v: BRIDGE_VERSION,
    store: 'pomodoro' as const,
    action: 'applyEndActionSettings' as const,
    args: ['playVideo' as const, {
        sourceKind: 'custom' as const,
        builtinVideoId: 'qianqian',
        customVideoPath: '/tmp/edited.webm',
    }],
} satisfies DispatchPayload;

beforeEach(() => {
    bridgeMocks.emit.mockReset();
    bridgeMocks.getByLabel.mockReset();
    bridgeMocks.listen.mockClear();
    bridgeMocks.handlers.clear();
    bridgeMocks.getByLabel.mockResolvedValue({ emit: bridgeMocks.emit });
});

describe('dispatchConfirmed', () => {
    it('does not resolve until the authoritative window acknowledges the matching request', async () => {
        let resolved = false;
        const pending = dispatchConfirmed(payload, { replyTo: 'settings', timeoutMs: 1000 })
            .then(() => { resolved = true; });

        await vi.waitFor(() => expect(bridgeMocks.emit).toHaveBeenCalledTimes(1));
        const [eventName, request] = bridgeMocks.emit.mock.calls[0];
        expect(eventName).toBe(EVT_DISPATCH);
        expect(request).toMatchObject({ replyTo: 'settings', payload });
        await Promise.resolve();
        expect(resolved).toBe(false);

        bridgeMocks.handlers.get(EVT_DISPATCH_RESULT)?.({
            payload: { requestId: request.requestId, ok: true },
        });

        await pending;
        expect(resolved).toBe(true);
    });

    it('rejects when the authoritative window reports that the action failed', async () => {
        const pending = dispatchConfirmed(payload, { replyTo: 'settings', timeoutMs: 1000 });
        await vi.waitFor(() => expect(bridgeMocks.emit).toHaveBeenCalledTimes(1));
        const request = bridgeMocks.emit.mock.calls[0][1];

        bridgeMocks.handlers.get(EVT_DISPATCH_RESULT)?.({
            payload: { requestId: request.requestId, ok: false, error: '保存番茄钟设置失败' },
        });

        await expect(pending).rejects.toThrow('保存番茄钟设置失败');
    });
});
