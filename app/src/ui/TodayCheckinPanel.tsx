import type { PointerEvent } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import {
    dailySummary,
    effectiveItemsForDate,
    isRestDate,
    recordForDate,
    useCheckinStore,
} from '../domain/checkin';
import { openCheckinEditorWindow } from '../domain/checkinWindow';
import { CheckinItemIconGlyph } from './CheckinItemIconGlyph';
import { resolveCheckinItemIcon } from './checkinItemIcons';
import { shouldStartWindowDrag } from './windowDrag';
import './TodayCheckinPanel.css';

function todayLocalDate(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

export function TodayCheckinPanel() {
    const state = useCheckinStore();
    const date = todayLocalDate();
    const rest = isRestDate(state, date);
    const summary = dailySummary(state, date);
    const items = effectiveItemsForDate(state, date);
    const record = recordForDate(state, date);
    const completedItems = items.filter((item) => (record.countsByItemId[item.id] ?? 0) >= item.targetCount).length;
    const percent = Math.round(summary.completionRate * 100);

    const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
        if (!shouldStartWindowDrag(e.button, e.target)) return;
        void getCurrentWindow().startDragging().catch(() => {
            /* drag may fail outside the Tauri runtime */
        });
    };

    return (
        <div
            className={`today-checkin-panel ${percent >= 100 ? 'is-complete' : ''} ${rest ? 'is-rest' : ''}`}
            onPointerDown={onPointerDown}
        >
            <div className="today-checkin-head">
                <div className="today-checkin-title-wrap">
                    <h2>今日打卡</h2>
                    <p>{rest ? '今天不计入本周目标' : `${completedItems}/${items.length} 项已完成`}</p>
                </div>
                <span className="today-checkin-status">{rest ? '休息' : percent >= 100 ? '全部完成' : '未完成'}</span>
            </div>

            {rest ? (
                <div className="today-checkin-rest">
                    <span>当天休息</span>
                    <p>今天不生成打卡项目，明天继续。</p>
                </div>
            ) : (
                <>
                    <div className="today-checkin-progress">
                        <div className="today-checkin-progress-meta">
                            <span>今日进度</span>
                            <strong>{percent}%</strong>
                        </div>
                        <div className="today-checkin-track" aria-hidden="true">
                            <div style={{ width: `${percent}%` }} />
                        </div>
                    </div>

                    <div className="today-checkin-list">
                        {items.map((item) => {
                            const count = record.countsByItemId[item.id] ?? 0;
                            const done = count >= item.targetCount;

                            return (
                                <div key={item.id} className={`today-checkin-item ${done ? 'done' : ''}`}>
                                    <CheckinItemIconGlyph
                                        className="today-checkin-item-icon"
                                        icon={resolveCheckinItemIcon(item)}
                                    />
                                    <div className="today-checkin-item-copy">
                                        <strong>{item.title}</strong>
                                        <span>{count}/{item.targetCount} 次</span>
                                    </div>
                                    <div className="today-checkin-item-actions">
                                        <span>{done ? '完成' : '进行中'}</span>
                                        <button
                                            type="button"
                                            aria-label={`${item.title} +1`}
                                            onClick={() => state.incrementItem(date, item.id)}
                                        >
                                            +1
                                        </button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </>
            )}

            <div className="today-checkin-footer">
                <span>{rest ? '休息日不影响连续完成' : '点击 +1 记录一次完成'}</span>
                <button type="button" aria-label="编辑打卡计划" onClick={() => void openCheckinEditorWindow()}>
                    编辑
                </button>
            </div>
        </div>
    );
}
