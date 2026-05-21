import type { CheckinItemIcon } from '../domain/checkin';
import { iconSrcForItemIcon } from './checkinItemIcons';

export function CheckinItemIconGlyph({ icon, className = '' }: { icon: CheckinItemIcon; className?: string }) {
    const src = iconSrcForItemIcon(icon);
    return (
        <span
            className={`checkin-item-icon-glyph ${className}`.trim()}
            aria-hidden="true"
            style={{
                WebkitMaskImage: `url(${src})`,
                maskImage: `url(${src})`,
            }}
        />
    );
}
