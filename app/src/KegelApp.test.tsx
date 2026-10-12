import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { KegelPreviewApp } from '../feature-packs/kegel/src/App';
vi.mock('../feature-packs/kegel/src/domain/kegelAudio', () => ({ KegelAudio: class {
    unlock = async () => {}; setOutputDevice = () => {}; update = () => {}; finish = () => {}; dispose = () => {};
} }));
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('kegel guide controls', () => {
    it('starts, pauses, resumes with a reset transition and exits through Escape', async () => {
        render(<KegelPreviewApp />);
        expect(screen.getByText('给自己一个休息')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: '开始凯格尔运动' }));
        await waitFor(() => expect(screen.getByText('收缩 · 保持')).toBeTruthy());
        fireEvent.click(screen.getByRole('button', { name: '暂停凯格尔运动' }));
        await waitFor(() => expect(screen.getByText('已暂停')).toBeTruthy());
        fireEvent.click(screen.getByRole('button', { name: '恢复凯格尔运动' }));
        await waitFor(() => expect(screen.getByText('准备继续')).toBeTruthy());
        fireEvent.keyDown(window, { key: 'Escape' });
        await waitFor(() => expect(screen.getByText('运动已结束')).toBeTruthy());
    });
    it('applies repetition and timing settings before starting', async () => {
        render(<KegelPreviewApp />);
        fireEvent.click(screen.getByText('节奏设置'));
        fireEvent.change(screen.getByLabelText('每组次数'), { target: { value: '5' } });
        fireEvent.change(screen.getByLabelText('放松秒数'), { target: { value: '4' } });
        fireEvent.click(screen.getByText('保存设置'));
        await waitFor(() => expect(screen.getByText('5 次 · 1 组')).toBeTruthy());
        expect(screen.getByText(/约 35 秒/)).toBeTruthy();
        // First Esc closes settings; the second ends the pending exercise.
        fireEvent.keyDown(window, { key: 'Escape' });
        expect(screen.queryByText('运动节奏')).toBeNull();
        fireEvent.keyDown(window, { key: 'Escape' });
    });
    it('updates daily completion totals after a whole set finishes', async () => {
        vi.useFakeTimers();
        render(<KegelPreviewApp />);
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: '开始凯格尔运动' })); });
        act(() => { vi.advanceTimersByTime(90050); });
        expect(screen.getByText('这一组，完成了')).toBeTruthy();
        expect(screen.getByText('连续 1 天 · 今日 1 组 / 15 次')).toBeTruthy();
    });
});
