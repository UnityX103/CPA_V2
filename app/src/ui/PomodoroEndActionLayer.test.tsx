import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePomodoroStore, type PomodoroEndEvent } from '../domain/pomodoro';
import { PomodoroEndActionLayer } from './PomodoroEndActionLayer';

const focusAppWindow = vi.hoisted(() => vi.fn());

vi.mock('../domain/focusWindow', () => ({ focusAppWindow }));

function endEvent(overrides: Partial<PomodoroEndEvent> = {}): PomodoroEndEvent {
    return {
        id: 1,
        fromPhase: 'focus',
        toPhase: 'break',
        triggeredBy: 'timer',
        ...overrides,
    };
}

beforeEach(() => {
    focusAppWindow.mockReset();
    focusAppWindow.mockResolvedValue(undefined);
    usePomodoroStore.setState({ lastEndEvent: null });
});

afterEach(cleanup);

describe('PomodoroEndActionLayer', () => {
    it('brings the main window forward for timer completions', async () => {
        render(<PomodoroEndActionLayer />);

        await act(async () => {
            usePomodoroStore.setState({ lastEndEvent: endEvent() });
        });

        expect(await screen.findByText('专注结束')).toBeTruthy();
        expect(focusAppWindow).toHaveBeenCalledWith('main');
    });

    it('ignores manual skips', async () => {
        render(<PomodoroEndActionLayer />);

        await act(async () => {
            usePomodoroStore.setState({ lastEndEvent: endEvent({ triggeredBy: 'skip' }) });
        });

        expect(screen.queryByText('专注结束')).toBeNull();
        expect(focusAppWindow).not.toHaveBeenCalled();
    });
});
