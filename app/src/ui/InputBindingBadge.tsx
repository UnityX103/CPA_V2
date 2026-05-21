import type { BindingInput, MouseButton } from '../domain/bindingKey';
import './InputBindingBadge.css';

interface InputBindingBadgeProps {
    input?: BindingInput | null;
    label: string;
}

const MOUSE_LABEL_TO_BUTTON: Record<string, MouseButton> = {
    '鼠标左键': 'left',
    '鼠标中键': 'middle',
    '鼠标右键': 'right',
};

export function inputFromRemoteLabel(label: string): BindingInput | null {
    const button = MOUSE_LABEL_TO_BUTTON[label.trim()];
    return button ? { kind: 'mouse', button } : null;
}

export function InputBindingBadge({ input, label }: InputBindingBadgeProps) {
    const resolved = input ?? inputFromRemoteLabel(label);
    if (resolved?.kind === 'mouse') {
        return (
            <span className="input-binding-badge input-binding-badge-mouse" title={label}>
                <MouseButtonIcon button={resolved.button} />
            </span>
        );
    }
    return <span className="input-binding-badge input-binding-badge-key">{label}</span>;
}

function MouseButtonIcon({ button }: { button: MouseButton }) {
    const testId = `mouse-${button}-icon`;
    return (
        <svg data-testid={testId} className="mouse-button-icon" viewBox="0 0 256 256" aria-hidden="true">
            <rect className="mouse-icon-body" x="56" y="24" width="144" height="208" rx="68" />
            <rect className="mouse-icon-split" x="60" y="110" width="136" height="6" />
            {button === 'middle' ? (
                <>
                    <ellipse className="mouse-icon-wheel-bg" cx="128" cy="74" rx="12" ry="38" />
                    <rect className="mouse-icon-wheel-detail" x="120" y="58" width="16" height="4" />
                    <rect className="mouse-icon-wheel-detail" x="120" y="78" width="16" height="4" />
                </>
            ) : (
                <>
                    <rect className="mouse-icon-split" x="125" y="32" width="6" height="78" />
                    <ellipse className="mouse-icon-indicator" cx={button === 'left' ? 96 : 160} cy="75" rx="18" ry="25" />
                </>
            )}
        </svg>
    );
}
