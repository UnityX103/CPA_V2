import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CockroachInvasionApp from './CockroachInvasionApp';

const tauri = vi.hoisted(() => {
    let activeHandler: ((event: { payload: { active: boolean } }) => void) | null = null;
    return {
        invoke: vi.fn(async (command: string) => {
            if (command === 'cockroach_invasion_window_context') {
                return {
                    screens: [{ x: 0, y: 0, width: 1_920, height: 1_080 }],
                    width: 180,
                    height: 180,
                    scaleFactor: 1,
                };
            }
            return undefined;
        }),
        activeHandler: () => activeHandler,
        listen: vi.fn(async (_event: string, handler: typeof activeHandler) => {
            activeHandler = handler;
            return () => { activeHandler = null; };
        }),
    };
});

vi.mock('@tauri-apps/api/core', () => ({ invoke: tauri.invoke }));
vi.mock('@tauri-apps/api/event', () => ({ listen: tauri.listen }));

beforeEach(() => {
    tauri.invoke.mockClear();
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
});

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

describe('CockroachInvasionApp', () => {
    it('shows on activation and turns a direct pointer hit into a fleeing state', async () => {
        render(<CockroachInvasionApp />);
        await waitFor(() => expect(tauri.activeHandler()).not.toBeNull());

        tauri.activeHandler()?.({ payload: { active: true } });
        await waitFor(() => expect(tauri.invoke).toHaveBeenCalledWith(
            'show_cockroach_invasion_window',
        ));

        fireEvent.pointerDown(screen.getByRole('button', { name: '赶走蟑螂' }), {
            clientX: 20,
            clientY: 90,
        });
        expect(document.querySelector('.cockroach-animation')?.classList.contains('is-fleeing'))
            .toBe(true);
    });
});
