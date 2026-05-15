import { useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';

let counter = 0;
const newId = (label: string) => `${label}-${++counter}`;

/**
 * Register the given DOM element as a hit region: native code will accept
 * mouse events that land inside its bounding rect, and pass everything else
 * through to whichever app is underneath.
 *
 * Returns a ref-callback so the hook handles attach/detach correctly even
 * when the host component returns null conditionally. Pass the result as a
 * React `ref` prop.
 *
 * Re-reports the rect on element resize, ancestor reflow (`window.resize`),
 * and style/class mutations (covers panels that move via inline transform).
 */
export function useHitRegion(label: string): (el: HTMLElement | null) => void {
    const idRef = useRef<string | null>(null);
    const observerRef = useRef<ResizeObserver | null>(null);
    const mutationRef = useRef<MutationObserver | null>(null);
    const resizeHandlerRef = useRef<(() => void) | null>(null);

    const report = useCallback((el: HTMLElement) => {
        const r = el.getBoundingClientRect();
        if (!idRef.current) return;
        void invoke('register_hit_region', {
            id: idRef.current,
            rect: { x: r.left, y: r.top, w: r.width, h: r.height },
        });
    }, []);

    return useCallback((el: HTMLElement | null) => {
        if (el === null) {
            if (idRef.current) {
                void invoke('unregister_hit_region', { id: idRef.current });
                idRef.current = null;
            }
            observerRef.current?.disconnect();
            mutationRef.current?.disconnect();
            if (resizeHandlerRef.current) {
                window.removeEventListener('resize', resizeHandlerRef.current);
                resizeHandlerRef.current = null;
            }
            return;
        }
        idRef.current = newId(label);
        report(el);
        const ro = new ResizeObserver(() => report(el));
        ro.observe(el);
        observerRef.current = ro;
        const mo = new MutationObserver(() => report(el));
        mo.observe(el, { attributes: true, attributeFilter: ['style', 'class'] });
        mutationRef.current = mo;
        const onResize = () => report(el);
        window.addEventListener('resize', onResize);
        resizeHandlerRef.current = onResize;
    }, [label, report]);
}

/**
 * Clear every registered hit region. Call once on app boot so a webview
 * reload (which re-mounts the React tree) doesn't leave stale rects from
 * the previous load alive in Rust state.
 */
export function clearHitRegions(): void {
    void invoke('clear_hit_regions');
}
