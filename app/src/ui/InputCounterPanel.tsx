import { useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useActiveAppStore } from '../domain/activeApp';
import { isVisibleBindingEntry, useBindingKeyStore, type BindingKeyEntry } from '../domain/bindingKey';
import { useSettingsStore } from '../domain/settings';
import { shouldStartWindowDrag } from './windowDrag';
import './InputCounterPanel.css';

const BASE_HEIGHT = 84;
const PILL_HEIGHT = 19;
const PILL_GAP = 8;

function windowHeightForPills(count: number): number {
    if (count <= 1) return BASE_HEIGHT;
    return BASE_HEIGHT + (count - 1) * (PILL_HEIGHT + PILL_GAP);
}

export function InputCounterPanel() {
    const panelEnabled = useBindingKeyStore((s) => s.panelEnabled);
    const entries = useBindingKeyStore((s) => s.entries);
    const activeApp = useActiveAppStore((s) => s.current);
    const showActiveAppWindowTitle = useSettingsStore((s) => s.showActiveAppWindowTitle);
    const [isPinned, setPinned] = useState(false);

    const boundEntries = useMemo(() => entries.filter(isVisibleBindingEntry), [entries]);
    const appLabel = (
        showActiveAppWindowTitle ? activeApp?.window_title?.trim() : ''
    ) || activeApp?.name?.trim() || '未聚焦应用';
    const appIcon = activeApp?.icon_data_url || null;

    useEffect(() => {
        if (!panelEnabled || boundEntries.length === 0) return;
        void invoke('resize_input_counter_window', { height: windowHeightForPills(boundEntries.length) })
            .catch(() => { /* non-Tauri/test env */ });
    }, [boundEntries.length, panelEnabled]);

    if (!panelEnabled || boundEntries.length === 0) return null;

    const onPanelPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
        if (!shouldStartWindowDrag(e.button, e.target)) return;
        void getCurrentWindow().startDragging().catch(() => {
            /* non-Tauri/test env */
        });
    };

    const onTogglePin = () => {
        const next = !isPinned;
        setPinned(next);
        void invoke('set_input_counter_window_pinned', { onTop: next })
            .catch((error) => {
                setPinned(!next);
                console.error('[input-counter] set pinned failed', error);
            });
    };

    return (
        <div
            className="input-counter-panel"
            role="complementary"
            aria-label="按键统计"
            onPointerDown={onPanelPointerDown}
        >
            <div className="input-counter-head">
                {boundEntries.length > 0 && (
                    <div className="input-counter-pill-list" data-testid="input-counter-pill-list">
                        {boundEntries.map((entry) => (
                            <KeyCounterPill key={entry.id} entry={entry} />
                        ))}
                    </div>
                )}
                <button
                    className={`input-counter-pin ${isPinned ? 'is-pinned' : ''}`}
                    aria-label="置顶"
                    aria-pressed={isPinned}
                    title={isPinned ? '取消置顶' : '置顶'}
                    onClick={onTogglePin}
                >
                    <PinIcon />
                </button>
            </div>
            <div className="input-counter-divider" />
            <div className="input-counter-footer" title={appLabel}>
                {appIcon ? (
                    <img className="input-counter-app-img" src={appIcon} alt="" draggable={false} />
                ) : (
                    <AppWindowIcon />
                )}
                <span className="input-counter-app-text">{appLabel}</span>
            </div>
        </div>
    );
}

function KeyCounterPill({ entry }: { entry: BindingKeyEntry }) {
    return (
        <div className="input-counter-pill">
            <span className="input-counter-key-badge">{entry.label}</span>
            <span className="input-counter-key-count">{entry.pressCount}</span>
        </div>
    );
}

function PinIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M14 4v5l3 3v2h-5v6l-1 1-1-1v-6H5v-2l3-3V4H7V2h8v2h-1z" />
        </svg>
    );
}

function AppWindowIcon() {
    return (
        <svg
            data-testid="active-app-fallback-icon"
            className="input-counter-app-icon"
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
        >
            <rect x="3" y="5" width="18" height="14" rx="2" />
            <path d="M3 9h18" />
        </svg>
    );
}
