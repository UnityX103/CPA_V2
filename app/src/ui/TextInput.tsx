import { useState, type InputHTMLAttributes } from 'react';
import './TextInput.css';

export function TextInput({ className = '', ...props }: InputHTMLAttributes<HTMLInputElement>) {
    return <input className={`text-input ${className}`} {...props} />;
}

interface NumberInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>,
    'type' | 'value' | 'defaultValue' | 'onChange' | 'min' | 'max' | 'step'> {
    value: number;
    onChange: (value: number) => void;
    min: number;
    max: number;
    suffix?: string;
    variant?: 'default' | 'warning';
}

export function NumberInput({
    value, onChange, min, max, suffix, variant, className = '',
    onBlur, onKeyDown, ...props
}: NumberInputProps) {
    const [editing, setEditing] = useState({ sourceValue: value, draft: String(value) });
    if (editing.sourceValue !== value) {
        setEditing({ sourceValue: value, draft: String(value) });
    }

    const commit = (raw: string) => {
        const parsed = raw.trim() === '' ? NaN : Number(raw);
        const next = Number.isFinite(parsed)
            ? Math.max(min, Math.min(max, Math.round(parsed)))
            : value;
        setEditing({ sourceValue: next, draft: String(next) });
        if (next !== value) onChange(next);
    };

    return (
        <span className={`num-input ${variant === 'warning' ? 'input-suffix-warning' : ''} ${className}`}>
            <TextInput
                {...props}
                type="number"
                inputMode="numeric"
                value={editing.draft}
                min={min}
                max={max}
                step={1}
                onChange={(event) => {
                    const draft = event.currentTarget.value;
                    const parsed = draft.trim() === '' ? NaN : Number(draft);
                    const valid = Number.isSafeInteger(parsed) && parsed >= min && parsed <= max;
                    setEditing({ sourceValue: valid ? parsed : value, draft });
                    if (valid && parsed !== value) onChange(parsed);
                }}
                onBlur={(event) => {
                    commit(event.currentTarget.value);
                    onBlur?.(event);
                }}
                onKeyDown={(event) => {
                    onKeyDown?.(event);
                    if (event.defaultPrevented || event.nativeEvent.isComposing) return;
                    if (event.key === 'Enter') {
                        event.preventDefault();
                        event.currentTarget.blur();
                    } else if (event.key === 'Escape') {
                        event.preventDefault();
                        event.currentTarget.value = String(value);
                        setEditing({ sourceValue: value, draft: String(value) });
                        event.currentTarget.blur();
                    }
                }}
            />
            {suffix && <span className="num-suffix" aria-hidden="true">{suffix}</span>}
        </span>
    );
}
