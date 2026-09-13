import { act, renderHook, waitFor, cleanup } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { usePomodoroDocking } from './usePomodoroDocking';
const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn().mockResolvedValue(() => {}) }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); invoke.mockReset(); });
it('keeps rapid hover enter/leave in order while native resize is pending', async () => {
    vi.stubGlobal('__TAURI_INTERNALS__', {});
    let finishEnter!: () => void;
    invoke.mockImplementation((command, args) => {
        if (command === 'configure_pomodoro_docking') return Promise.resolve({ side: 'right', expanded: false, dragging: false });
        if (args.hovered) return new Promise<void>(resolve => { finishEnter = resolve; });
        return Promise.resolve();
    });
    const { result } = renderHook(() => usePomodoroDocking(true, false));
    await waitFor(() => expect(result.current.side).toBe('right'));
    act(() => { result.current.hover(true); result.current.hover(false); });
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('hover_pomodoro_docking', { hovered: true }));
    expect(invoke).not.toHaveBeenCalledWith('hover_pomodoro_docking', { hovered: false });
    await act(async () => finishEnter());
    await waitFor(() => expect(invoke).toHaveBeenLastCalledWith('hover_pomodoro_docking', { hovered: false }));
});

it('waits for restored preferences and configures the dock with the saved scale', async () => {
    vi.stubGlobal('__TAURI_INTERNALS__', {});
    invoke.mockResolvedValue({ side: 'right', expanded: false, dragging: false });
    const { useSettingsStore } = await import('../domain/settings');
    const previousScale = useSettingsStore.getState().uiScale;
    const { rerender } = renderHook(({ ready }) => usePomodoroDocking(true, false, 'focus', ready), {
        initialProps: { ready: false },
    });
    await act(async () => {});
    expect(invoke).not.toHaveBeenCalled();
    act(() => useSettingsStore.setState({ uiScale: 2.4 }));
    rerender({ ready: true });
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('configure_pomodoro_docking', {
        autoDock: true, paused: false, phase: 'focus', scale: 2.4, suspended: false,
    }));
    act(() => useSettingsStore.setState({ uiScale: 1.5 }));
    await waitFor(() => expect(invoke).toHaveBeenLastCalledWith('configure_pomodoro_docking', {
        autoDock: true, paused: false, phase: 'focus', scale: 1.5, suspended: false,
    }));
    act(() => useSettingsStore.setState({ uiScale: previousScale }));
});
