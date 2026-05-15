import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';

const invokeMock = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({
    invoke: (...args: unknown[]) => invokeMock(...args),
}));

// Stub ResizeObserver and MutationObserver which are not available in jsdom.
class FakeResizeObserver {
    constructor(_cb: ResizeObserverCallback) {}
    observe() {}
    unobserve() {}
    disconnect() {}
}
vi.stubGlobal('ResizeObserver', FakeResizeObserver);

class FakeMutationObserver {
    constructor(_cb: MutationCallback) {}
    observe() {}
    disconnect() {}
    takeRecords() { return []; }
}
vi.stubGlobal('MutationObserver', FakeMutationObserver);

// Stub getBoundingClientRect so jsdom returns the inline style values.
beforeEach(() => {
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
        const s = this.style;
        return {
            x: parseFloat(s.left) || 0,
            y: parseFloat(s.top) || 0,
            left: parseFloat(s.left) || 0,
            top: parseFloat(s.top) || 0,
            width: parseFloat(s.width) || 0,
            height: parseFloat(s.height) || 0,
            right: (parseFloat(s.left) || 0) + (parseFloat(s.width) || 0),
            bottom: (parseFloat(s.top) || 0) + (parseFloat(s.height) || 0),
            toJSON: () => ({}),
        } as DOMRect;
    });
});

// Import AFTER the mock is registered.
const { useHitRegion, clearHitRegions } = await import('./passthrough');

function Probe({ label, hide }: { label: string; hide?: boolean }) {
    const ref = useHitRegion(label);
    if (hide) return null;
    return <div ref={ref} style={{ position: 'absolute', left: 10, top: 20, width: 30, height: 40 }} data-testid="probe" />;
}

describe('useHitRegion', () => {
    beforeEach(() => {
        invokeMock.mockReset();
        cleanup();
    });

    it('registers on mount with a unique id and the element rect', () => {
        const { unmount } = render(<Probe label="panel-a" />);
        const calls = invokeMock.mock.calls.filter(([cmd]) => cmd === 'register_hit_region');
        expect(calls.length).toBeGreaterThanOrEqual(1);
        const [, args] = calls[0];
        expect(args.id).toMatch(/^panel-a-\d+$/);
        expect(args.rect).toEqual({ x: 10, y: 20, w: 30, h: 40 });
        unmount();
    });

    it('unregisters on unmount with the same id used at mount', () => {
        const { unmount } = render(<Probe label="panel-b" />);
        const registerCall = invokeMock.mock.calls.find(([cmd]) => cmd === 'register_hit_region')!;
        const id = registerCall[1].id;
        invokeMock.mockClear();
        unmount();
        const unregister = invokeMock.mock.calls.find(([cmd]) => cmd === 'unregister_hit_region');
        expect(unregister).toBeTruthy();
        expect(unregister![1]).toEqual({ id });
    });

    it('handles conditional rendering: registers when the element appears, unregisters when it disappears', () => {
        const { rerender } = render(<Probe label="panel-c" hide />);
        expect(invokeMock.mock.calls.filter(([c]) => c === 'register_hit_region')).toHaveLength(0);
        rerender(<Probe label="panel-c" />);
        expect(invokeMock.mock.calls.filter(([c]) => c === 'register_hit_region')).toHaveLength(1);
        rerender(<Probe label="panel-c" hide />);
        expect(invokeMock.mock.calls.filter(([c]) => c === 'unregister_hit_region')).toHaveLength(1);
    });

    it('two instances get different ids', () => {
        render(
            <>
                <Probe label="dup" />
                <Probe label="dup" />
            </>,
        );
        const ids = invokeMock.mock.calls
            .filter(([c]) => c === 'register_hit_region')
            .map(([, a]) => a.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it('clearHitRegions() forwards to the clear_hit_regions command', () => {
        invokeMock.mockReset();
        clearHitRegions();
        expect(invokeMock).toHaveBeenCalledWith('clear_hit_regions');
    });
});
