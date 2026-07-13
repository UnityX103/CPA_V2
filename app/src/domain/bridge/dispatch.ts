import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { listen } from '@tauri-apps/api/event';
import {
    EVT_DISPATCH,
    EVT_DISPATCH_RESULT,
    type ConfirmedDispatchRequest,
    type DispatchPayload,
    type DispatchResult,
} from './protocol';

export async function dispatch(payload: DispatchPayload): Promise<void> {
    try {
        const w = await WebviewWindow.getByLabel('main');
        if (!w) return;
        await w.emit(EVT_DISPATCH, payload);
    } catch {
        /* swallow — settings window in non-Tauri/test env */
    }
}

interface ConfirmedDispatchOptions {
    replyTo: string;
    timeoutMs?: number;
}

const DEFAULT_CONFIRM_TIMEOUT_MS = 5000;

export async function dispatchConfirmed(
    payload: DispatchPayload,
    options: ConfirmedDispatchOptions,
): Promise<void> {
    const requestId = createDispatchRequestId();
    let resolveResult!: () => void;
    let rejectResult!: (error: Error) => void;
    const result = new Promise<void>((resolve, reject) => {
        resolveResult = resolve;
        rejectResult = reject;
    });
    const unlisten = await listen<DispatchResult>(EVT_DISPATCH_RESULT, (event) => {
        if (event.payload.requestId !== requestId) return;
        if (event.payload.ok) {
            resolveResult();
            return;
        }
        rejectResult(new Error(event.payload.error || '主窗口未能应用设置'));
    });
    const timeout = globalThis.setTimeout(() => {
        rejectResult(new Error('等待主窗口确认设置超时'));
    }, options.timeoutMs ?? DEFAULT_CONFIRM_TIMEOUT_MS);

    try {
        const main = await WebviewWindow.getByLabel('main');
        if (!main) {
            throw new Error('主窗口不可用，无法保存设置');
        }
        const request: ConfirmedDispatchRequest = {
            requestId,
            replyTo: options.replyTo,
            payload,
        };
        await main.emit(EVT_DISPATCH, request);
        await result;
    } finally {
        globalThis.clearTimeout(timeout);
        unlisten();
    }
}

function createDispatchRequestId(): string {
    return globalThis.crypto?.randomUUID?.()
        ?? `dispatch-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
