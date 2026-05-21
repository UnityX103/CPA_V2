import type { CheckinItem, CheckinItemIcon } from '../domain/checkin';

export interface CheckinItemIconOption {
    id: CheckinItemIcon;
    label: string;
    src: string;
}

export const CHECKIN_ITEM_ICON_OPTIONS: CheckinItemIconOption[] = [
    { id: 'activity', label: '活力', src: '/checkin-icons/icon-activity.svg' },
    { id: 'dumbbell', label: '运动', src: '/checkin-icons/icon-dumbbell.svg' },
    { id: 'bookOpen', label: '阅读', src: '/checkin-icons/icon-book-open.svg' },
    { id: 'droplet', label: '喝水', src: '/checkin-icons/icon-droplet.svg' },
    { id: 'listChecks', label: '清单', src: '/checkin-icons/icon-list-checks.svg' },
    { id: 'sparkle', label: '星光', src: '/checkin-icons/icon-sparkle.svg' },
    { id: 'coffee', label: '咖啡', src: '/checkin-icons/icon-coffee.svg' },
    { id: 'moon', label: '月亮', src: '/checkin-icons/icon-moon.svg' },
    { id: 'sun', label: '太阳', src: '/checkin-icons/icon-sun.svg' },
    { id: 'leaf', label: '叶子', src: '/checkin-icons/icon-leaf.svg' },
    { id: 'music', label: '音乐', src: '/checkin-icons/icon-music.svg' },
    { id: 'pencil', label: '书写', src: '/checkin-icons/icon-pencil.svg' },
    { id: 'target', label: '目标', src: '/checkin-icons/icon-target.svg' },
    { id: 'flame', label: '火焰', src: '/checkin-icons/icon-flame.svg' },
    { id: 'heart', label: '爱', src: '/checkin-icons/icon-heart.svg' },
    { id: 'apple', label: '苹果', src: '/checkin-icons/icon-apple.svg' },
    { id: 'clock', label: '时钟', src: '/checkin-icons/icon-clock.svg' },
    { id: 'meditation', label: '冥想', src: '/checkin-icons/icon-meditation.svg' },
];

export const CHECKIN_ITEM_ICON_KEYS = CHECKIN_ITEM_ICON_OPTIONS.map((option) => option.id);

export function resolveCheckinItemIcon(item: CheckinItem): CheckinItemIcon {
    return item.icon ?? (item.type === 'pomodoroFocus' ? 'activity' : 'sparkle');
}

export function iconSrcForItemIcon(icon: CheckinItemIcon): string {
    return CHECKIN_ITEM_ICON_OPTIONS.find((option) => option.id === icon)?.src
        ?? CHECKIN_ITEM_ICON_OPTIONS[0].src;
}
