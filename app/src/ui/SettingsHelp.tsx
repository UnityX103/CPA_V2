import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import './SettingsHelp.css';

export function SettingsHelp({ label, children }: { label: string; children: ReactNode }) {
    const id = useId();
    const button = useRef<HTMLButtonElement>(null);
    const tip = useRef<HTMLDivElement>(null);
    const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const [open, setOpen] = useState(false);
    const [position, setPosition] = useState({ left: 12, top: 12 });
    const show = () => { clearTimeout(timer.current); setOpen(true); };
    const hide = () => { clearTimeout(timer.current); timer.current = setTimeout(() => setOpen(false), 120); };
    useEffect(() => () => clearTimeout(timer.current), []);
    useLayoutEffect(() => {
        if (!open || !button.current || !tip.current) return;
        const anchor = button.current.getBoundingClientRect();
        const bubble = tip.current.getBoundingClientRect();
        setPosition({
            left: Math.max(12, Math.min(anchor.right - bubble.width, window.innerWidth - bubble.width - 12)),
            top: anchor.bottom + bubble.height + 18 <= window.innerHeight
                ? anchor.bottom + 6 : Math.max(12, anchor.top - bubble.height - 6),
        });
        const close = () => setOpen(false);
        const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') close(); };
        window.addEventListener('resize', close);
        window.addEventListener('scroll', close, true);
        window.addEventListener('keydown', escape);
        return () => {
            window.removeEventListener('resize', close);
            window.removeEventListener('scroll', close, true);
            window.removeEventListener('keydown', escape);
        };
    }, [open]);
    return <>
        <button ref={button} type="button" className="settings-help-button"
            aria-label={`${label}说明`} aria-describedby={id}
            onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={hide}
            onClick={show}>?</button>
        {createPortal(<div ref={tip} id={id} role="tooltip" hidden={!open}
            className="settings-help-tooltip" style={position}
            onMouseEnter={show} onMouseLeave={hide}>{children}</div>, document.body)}
    </>;
}
