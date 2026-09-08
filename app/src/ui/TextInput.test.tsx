import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NumberInput, TextInput } from './TextInput';

afterEach(cleanup);

function NumberField({ min = 1, max = 120 }: { min?: number; max?: number }) {
    const [value, setValue] = useState(30);
    return <>
        <NumberInput aria-label="时长" value={value} onChange={setValue} min={min} max={max} suffix="分钟" />
        <output data-testid="value">{value}</output>
    </>;
}

describe('NumberInput', () => {
    it('keeps an empty draft without committing zero and restores the last value on blur', () => {
        render(<NumberField />);
        const input = screen.getByRole('spinbutton') as HTMLInputElement;
        fireEvent.change(input, { target: { value: '' } });
        expect(input.value).toBe('');
        expect(screen.getByTestId('value').textContent).toBe('30');
        fireEvent.blur(input);
        expect(input.value).toBe('30');
    });

    it('allows typing through a value below the minimum without interrupting editing', () => {
        render(<NumberField min={5} />);
        const input = screen.getByRole('spinbutton') as HTMLInputElement;
        fireEvent.change(input, { target: { value: '1' } });
        expect(input.value).toBe('1');
        expect(screen.getByTestId('value').textContent).toBe('30');
        fireEvent.change(input, { target: { value: '15' } });
        expect(input.value).toBe('15');
        expect(screen.getByTestId('value').textContent).toBe('15');
    });

    it.each([['999', '120'], ['-2', '1'], ['2.6', '3']])('normalizes %s to %s only on blur', (draft, expected) => {
        render(<NumberField />);
        const input = screen.getByRole('spinbutton') as HTMLInputElement;
        fireEvent.change(input, { target: { value: draft } });
        expect(input.value).toBe(draft);
        expect(screen.getByTestId('value').textContent).toBe('30');
        fireEvent.blur(input);
        expect(input.value).toBe(expected);
        expect(screen.getByTestId('value').textContent).toBe(expected);
    });

    it('distinguishes a valid zero from an empty draft', () => {
        render(<NumberField min={0} />);
        const input = screen.getByRole('spinbutton') as HTMLInputElement;
        fireEvent.change(input, { target: { value: '0' } });
        fireEvent.blur(input);
        expect(input.value).toBe('0');
        expect(screen.getByTestId('value').textContent).toBe('0');
    });

    it('commits on Enter and cancels an invalid draft on Escape', () => {
        render(<NumberField />);
        const input = screen.getByRole('spinbutton') as HTMLInputElement;
        input.focus();
        fireEvent.change(input, { target: { value: '999' } });
        fireEvent.keyDown(input, { key: 'Enter' });
        expect(input.value).toBe('120');
        input.focus();
        fireEvent.change(input, { target: { value: '-10' } });
        fireEvent.keyDown(input, { key: 'Escape' });
        expect(input.value).toBe('120');
    });

    it('refreshes displayed values when settings are loaded externally', () => {
        const onChange = vi.fn();
        const { rerender } = render(<NumberInput value={25} onChange={onChange} min={1} max={120} />);
        const input = screen.getByRole('spinbutton') as HTMLInputElement;
        fireEvent.change(input, { target: { value: '' } });
        rerender(<NumberInput value={45} onChange={onChange} min={1} max={120} />);
        expect(input.value).toBe('45');
        expect(onChange).not.toHaveBeenCalled();
    });
});

describe('TextInput', () => {
    it('preserves text composition and native password and accessibility attributes', () => {
        const onChange = vi.fn();
        render(<TextInput aria-label="密码" type="password" autoComplete="current-password" onChange={onChange} />);
        const input = screen.getByLabelText('密码') as HTMLInputElement;
        fireEvent.compositionStart(input);
        fireEvent.change(input, { target: { value: '测试密码' } });
        fireEvent.compositionEnd(input);
        expect(input.value).toBe('测试密码');
        expect(input.type).toBe('password');
        expect(input.autocomplete).toBe('current-password');
        expect(onChange).toHaveBeenCalledTimes(1);
    });
});
