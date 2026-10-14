import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePomodoroStore } from '../pomodoro';
import { EVT_STATE } from './protocol';
import { useBridgeHost } from './host';

const emit = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock('@tauri-apps/api/webviewWindow', () => ({ WebviewWindow: {
    getByLabel: vi.fn(async (label: string) => label === 'settings' ? { emit } : null),
} }));

const initial = usePomodoroStore.getState();
beforeEach(() => {
    emit.mockClear();
    usePomodoroStore.setState({ autoStartOnLaunch: false, playVideoOnBreakEnd: false, breakActivity: null });
});
afterEach(() => { cleanup(); usePomodoroStore.setState(initial); });
function Host() { useBridgeHost(); return null; }

describe('retained pomodoro settings subscription', () => {
    it('pushes the centered reminder change to the open settings window', async () => {
        render(<Host />);
        act(() => usePomodoroStore.getState().setAutoCenterAfterBreak(false));
        await waitFor(() => expect(emit).toHaveBeenCalledWith(EVT_STATE,
            expect.objectContaining({ pomodoro: expect.objectContaining({ autoCenterAfterBreak: false }) })));
    });
    it('pushes automatic start and break-end video changes to an open settings window', async () => {
        render(<Host />);
        act(() => usePomodoroStore.getState().setAutoStartOnLaunch(true));
        await waitFor(() => expect(emit).toHaveBeenCalledWith(EVT_STATE,
            expect.objectContaining({ pomodoro: expect.objectContaining({ autoStartOnLaunch: true }) })));
        emit.mockClear();
        act(() => {
            const state = usePomodoroStore.getState();
            state.applyEndActionSettings(state.endActionMode, state.endActionVideo, true);
        });
        await waitFor(() => expect(emit).toHaveBeenCalledWith(EVT_STATE,
            expect.objectContaining({ pomodoro: expect.objectContaining({ playVideoOnBreakEnd: true }) })));
    });

    it('keeps transient break-activity updates out of retained settings broadcasts', async () => {
        render(<Host />);
        await act(async () => {
            usePomodoroStore.setState({ breakActivity: { id: 'exercise', ownerId: 'wellness.kegel', status: 'running' } });
            usePomodoroStore.setState({ breakActivity: { id: 'exercise', ownerId: 'wellness.kegel', status: 'paused' } });
        });
        expect(emit).not.toHaveBeenCalled();
    });
});
