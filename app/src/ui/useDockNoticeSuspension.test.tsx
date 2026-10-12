import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { hasFullWindowNotice, useDockNoticeSuspension } from './useDockNoticeSuspension';

afterEach(cleanup);
it('keeps docking suspended until all incompatible notifications disappear', async () => {
    const { result } = renderHook(() => useDockNoticeSuspension(), {
        wrapper: ({ children }) => <div className="app-scale-root">{children}</div>,
    });
    const root = document.querySelector('.app-scale-root')!;
    const update = document.createElement('div');
    update.setAttribute('role', 'status');
    update.textContent = '新版本已准备好';
    const warning = document.createElement('div');
    warning.setAttribute('role', 'alert');
    await act(async () => { root.append(update, warning); });
    await waitFor(() => expect(result.current).toBe(true));
    await act(async () => update.remove());
    expect(result.current).toBe(true);
    await act(async () => warning.remove());
    await waitFor(() => expect(result.current).toBe(false));
});
it('compact and hidden notices do not require a full window', () => {
    const root = document.createElement('div');
    root.innerHTML = '<div role="status" data-dock-compatible="true">已暂停</div><div hidden><div role="alert">隐藏通知</div></div>';
    expect(hasFullWindowNotice(root)).toBe(false);
});
