const NO_WINDOW_DRAG_SELECTOR = [
    'button',
    'input',
    'select',
    'textarea',
    'a',
    '[role="button"]',
    '[role="slider"]',
    '[data-no-window-drag]',
].join(',');

export function shouldStartWindowDrag(button: number, target: EventTarget | null): boolean {
    if (button !== 0) return false;
    if (!(target instanceof HTMLElement)) return false;
    return target.closest(NO_WINDOW_DRAG_SELECTOR) === null;
}
