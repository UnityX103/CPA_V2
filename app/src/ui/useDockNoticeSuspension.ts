import { useEffect, useState } from 'react';

function isVisible(notice: Element, root: Element): boolean {
    for (let element: Element | null = notice; element; element = element.parentElement) {
        const style = getComputedStyle(element);
        if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') return false;
        if (element === root) break;
    }
    return true;
}

// New notifications default to a full window; compact notices explicitly opt out.
export function hasFullWindowNotice(root: Element): boolean {
    return [...root.querySelectorAll('[role="status"], [role="alert"], [role="dialog"]')]
        .some((notice) => !notice.closest('[data-dock-compatible="true"], [hidden], [aria-hidden="true"]')
            && isVisible(notice, root));
}

export function useDockNoticeSuspension() {
    const [suspended, setSuspended] = useState(false);
    useEffect(() => {
        const root = document.querySelector('.app-scale-root');
        if (!root) return;
        const update = () => setSuspended(hasFullWindowNotice(root));
        const observer = new MutationObserver(update);
        observer.observe(root, { subtree: true, childList: true, attributes: true,
            attributeFilter: ['role', 'hidden', 'aria-hidden', 'data-dock-compatible', 'style', 'class'] });
        update();
        return () => observer.disconnect();
    }, []);
    return suspended;
}
