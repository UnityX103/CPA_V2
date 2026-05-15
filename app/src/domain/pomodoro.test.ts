import { describe, expect, it, beforeEach, vi } from 'vitest';
import { usePomodoroStore, createPomodoroStore } from './pomodoro';
import * as dispatchMod from './bridge/dispatch';
import { BRIDGE_VERSION } from './bridge/protocol';

function reset() {
    usePomodoroStore.setState({
        focusDurationSeconds: 25 * 60,
        breakDurationSeconds: 5 * 60,
        totalRounds: 4,
        currentRound: 1,
        remainingSeconds: 25 * 60,
        currentPhase: 'focus',
        isRunning: false,
        isPinned: false,
        autoStartBreak: true,
        consecutiveCompletedFocus: 0,
    });
}

describe('PomodoroTimerSystem.tick', () => {
    beforeEach(reset);

    // adversarial-review #7
    it('autoStartBreak=true 时 phase 切换不吃掉新阶段第一秒', () => {
        const store = usePomodoroStore.getState();
        store.applySettings(1, 60, 4, true);
        store.start();

        // 累积 1.2s：第 1s 触发 focus→break，多余 0.2s 必须被丢弃，不能扣到 break
        usePomodoroStore.getState().tick(1.2);
        expect(usePomodoroStore.getState().currentPhase).toBe('break');
        expect(usePomodoroStore.getState().remainingSeconds).toBe(60);

        // 再来 0.8s，break 还不能扣秒，因为 accumulator 应该被清零了
        usePomodoroStore.getState().tick(0.8);
        expect(usePomodoroStore.getState().remainingSeconds).toBe(60);

        // 再 0.3s（总共 1.1s）才扣到 59
        usePomodoroStore.getState().tick(0.3);
        expect(usePomodoroStore.getState().remainingSeconds).toBe(59);
    });

    it('暂停时 tick 不扣秒', () => {
        usePomodoroStore.getState().tick(5);
        expect(usePomodoroStore.getState().remainingSeconds).toBe(25 * 60);
    });

    it('completed 阶段 tick 不再推进', () => {
        usePomodoroStore.setState({
            currentPhase: 'completed',
            isRunning: true,
            remainingSeconds: 0,
        });
        usePomodoroStore.getState().tick(10);
        expect(usePomodoroStore.getState().currentPhase).toBe('completed');
        expect(usePomodoroStore.getState().remainingSeconds).toBe(0);
    });
});

describe('createPomodoroStore — settings-window mode', () => {
    it('applySettings dispatches instead of mutating local state', () => {
        const spy = vi.spyOn(dispatchMod, 'dispatch').mockResolvedValue();
        const store = createPomodoroStore({ isSettingsWindow: true });
        const before = store.getState().focusDurationSeconds;
        store.getState().applySettings(900, 180, 5, true);
        expect(store.getState().focusDurationSeconds).toBe(before);
        expect(spy).toHaveBeenCalledWith(expect.objectContaining({
            v: BRIDGE_VERSION, store: 'pomodoro', action: 'applySettings', args: [900, 180, 5, true],
        }));
        spy.mockRestore();
    });
});
