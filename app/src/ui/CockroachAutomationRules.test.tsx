import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CockroachAutomationRules } from './CockroachAutomationRules';
const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }));
afterEach(() => { cleanup(); invoke.mockReset(); });

describe('Cockroach rule editor', () => {
    it('loads, edits, adds, deletes and saves only event/action pairs in row order', async () => {
        invoke.mockResolvedValueOnce([{ event: 'focus.started', action: 'kill-all' }]).mockResolvedValue([]);
        render(<CockroachAutomationRules />);
        const first = await screen.findByLabelText('规则 1 事件');
        expect(within(first).getAllByRole('option')).toHaveLength(6);
        expect(within(screen.getByLabelText('规则 1 操作')).getAllByRole('option')).toHaveLength(4);
        fireEvent.click(screen.getByRole('button', { name: '添加规则' }));
        fireEvent.change(screen.getByLabelText('规则 2 操作'), { target: { value: 'start-simulation' } });
        fireEvent.click(screen.getByRole('button', { name: '删除规则 1' }));
        fireEvent.click(screen.getByRole('button', { name: '保存规则' }));
        await screen.findByText('规则已保存');
        expect(invoke).toHaveBeenLastCalledWith('save_cockroach_automation_rules', {
            rules: [{ event: 'break.present', action: 'start-simulation' }],
        });
        fireEvent.click(screen.getByRole('button', { name: '删除规则 1' }));
        fireEvent.click(screen.getByRole('button', { name: '保存规则' }));
        await waitFor(() => expect(invoke).toHaveBeenLastCalledWith('save_cockroach_automation_rules', { rules: [] }));
    });
    it('never allows failed reads to overwrite stored rules', async () => {
        invoke.mockRejectedValueOnce(new Error('无法读取事件规则'));
        await act(async () => { render(<CockroachAutomationRules />); });
        expect(screen.getByRole('alert').textContent).toContain('无法读取事件规则');
        expect((screen.getByRole('button', { name: '保存规则' }) as HTMLButtonElement).disabled).toBe(true);
    });
});
