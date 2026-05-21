import { describe, expect, it, vi } from 'vitest';
import { createPomodoroStore } from './pomodoro';
import * as dispatchMod from './bridge/dispatch';
import { BRIDGE_VERSION } from './bridge/protocol';
import { DEFAULT_BUILTIN_POMODORO_VIDEO_ID } from './pomodoroVideos';

function freshStore() {
    return createPomodoroStore({ isSettingsWindow: false });
}

describe('Pomodoro end action settings', () => {
    it('defaults to playVideo with bundled qianqian video', () => {
        const store = freshStore();

        expect(store.getState().endActionMode).toBe('playVideo');
        expect(store.getState().endActionVideo).toEqual({
            sourceKind: 'builtin',
            builtinVideoId: DEFAULT_BUILTIN_POMODORO_VIDEO_ID,
            customVideoPath: '',
        });
        expect(store.getState().lastEndEvent).toBeNull();
    });

    it('applies end-action settings without resetting timer progress', () => {
        const store = freshStore();
        store.getState().applySettings(60, 30, 4, true, false);
        store.getState().start();
        for (let i = 0; i < 10; i += 1) {
            store.getState().tick(1);
        }

        store.getState().applyEndActionSettings('topWindow', {
            sourceKind: 'custom',
            builtinVideoId: DEFAULT_BUILTIN_POMODORO_VIDEO_ID,
            customVideoPath: '/tmp/custom.mp4',
        });

        expect(store.getState().endActionMode).toBe('topWindow');
        expect(store.getState().endActionVideo).toEqual({
            sourceKind: 'custom',
            builtinVideoId: DEFAULT_BUILTIN_POMODORO_VIDEO_ID,
            customVideoPath: '/tmp/custom.mp4',
        });
        expect(store.getState().currentPhase).toBe('focus');
        expect(store.getState().remainingSeconds).toBe(50);
        expect(store.getState().isRunning).toBe(true);
    });
});

describe('PomodoroTimerSystem.tick', () => {
    // adversarial-review #7
    it('autoStartBreak=true 时 phase 切换不吃掉新阶段第一秒', () => {
        const store = freshStore();
        store.getState().applySettings(1, 60, 4, true, true);
        store.getState().start();

        // 累积 1.2s：第 1s 触发 focus→break，多余 0.2s 必须被丢弃，不能扣到 break
        store.getState().tick(1.2);
        expect(store.getState().currentPhase).toBe('break');
        expect(store.getState().remainingSeconds).toBe(60);

        // 再来 0.8s，break 还不能扣秒，因为 accumulator 应该被清零了
        store.getState().tick(0.8);
        expect(store.getState().remainingSeconds).toBe(60);

        // 再 0.3s（总共 1.1s）才扣到 59
        store.getState().tick(0.3);
        expect(store.getState().remainingSeconds).toBe(59);
    });

    it('consumes multiple elapsed seconds in one tick without changing phase', () => {
        const store = freshStore();
        store.getState().applySettings(10, 60, 4, true, false);
        store.getState().start();

        store.getState().tick(3.2);

        expect(store.getState().currentPhase).toBe('focus');
        expect(store.getState().remainingSeconds).toBe(7);
    });

    it('autoStartBreak=false by default pauses at the start of break', () => {
        const store = freshStore();
        store.getState().applySettings(1, 60, 4, true, false);
        store.getState().start();

        store.getState().tick(1);

        expect(store.getState().currentPhase).toBe('break');
        expect(store.getState().remainingSeconds).toBe(60);
        expect(store.getState().isRunning).toBe(false);
    });

    it('autoStartBreak=true starts break immediately after focus completes', () => {
        const store = freshStore();
        store.getState().applySettings(1, 60, 4, true, true);
        store.getState().start();

        store.getState().tick(1);

        expect(store.getState().currentPhase).toBe('break');
        expect(store.getState().remainingSeconds).toBe(60);
        expect(store.getState().isRunning).toBe(true);
    });

    it('暂停时 tick 不扣秒', () => {
        const store = freshStore();

        store.getState().tick(5);

        expect(store.getState().remainingSeconds).toBe(25 * 60);
    });

    it('completed 阶段 tick 不再推进', () => {
        const store = freshStore();
        store.setState({
            currentPhase: 'completed',
            isRunning: true,
            remainingSeconds: 0,
        });
        store.getState().tick(10);
        expect(store.getState().currentPhase).toBe('completed');
        expect(store.getState().remainingSeconds).toBe(0);
    });

    it('emits an end event when timer advances focus to break', () => {
        const store = freshStore();
        store.getState().applySettings(1, 60, 4, true, false);
        store.getState().start();

        store.getState().tick(1);

        expect(store.getState().lastEndEvent).toEqual({
            id: 1,
            fromPhase: 'focus',
            toPhase: 'break',
            triggeredBy: 'timer',
        });
    });

    it('keeps end event ids unique across reset and restart in the same store', () => {
        const store = freshStore();
        store.getState().applySettings(1, 60, 4, true, false);
        store.getState().start();
        store.getState().tick(1);
        expect(store.getState().lastEndEvent?.id).toBe(1);

        store.getState().reset();
        store.getState().start();
        store.getState().tick(1);

        expect(store.getState().lastEndEvent).toEqual({
            id: 2,
            fromPhase: 'focus',
            toPhase: 'break',
            triggeredBy: 'timer',
        });
    });
});

describe('PomodoroTimerSystem.skip', () => {
    it('emits an end event when skip advances focus to break', () => {
        const store = freshStore();
        store.getState().applySettings(60, 30, 4, true, false);
        store.getState().start();

        store.getState().skip();

        expect(store.getState().lastEndEvent).toEqual({
            id: 1,
            fromPhase: 'focus',
            toPhase: 'break',
            triggeredBy: 'skip',
        });
    });
});

describe('Pomodoro pin state', () => {
    it('setPinned sets an explicit pin state without toggling', () => {
        const store = freshStore();

        store.getState().setPinned(true);
        expect(store.getState().isPinned).toBe(true);

        store.getState().setPinned(true);
        expect(store.getState().isPinned).toBe(true);

        store.getState().setPinned(false);
        expect(store.getState().isPinned).toBe(false);
    });
});

describe('createPomodoroStore — settings-window mode', () => {
    it('applySettings dispatches instead of mutating local state', () => {
        const spy = vi.spyOn(dispatchMod, 'dispatch').mockResolvedValue();
        const store = createPomodoroStore({ isSettingsWindow: true });
        const before = store.getState().focusDurationSeconds;
        store.getState().applySettings(900, 180, 5, true, false);
        expect(store.getState().focusDurationSeconds).toBe(before);
        expect(spy).toHaveBeenCalledWith(expect.objectContaining({
            v: BRIDGE_VERSION, store: 'pomodoro', action: 'applySettings', args: [900, 180, 5, true, false],
        }));
        spy.mockRestore();
    });

    it('applyEndActionSettings dispatches instead of mutating local state', () => {
        const spy = vi.spyOn(dispatchMod, 'dispatch').mockResolvedValue();
        const store = createPomodoroStore({ isSettingsWindow: true });
        const before = store.getState().endActionMode;
        store.getState().applyEndActionSettings('topWindow', {
            sourceKind: 'custom',
            builtinVideoId: DEFAULT_BUILTIN_POMODORO_VIDEO_ID,
            customVideoPath: '/tmp/custom.mp4',
        });
        expect(store.getState().endActionMode).toBe(before);
        expect(store.getState().endActionVideo).toEqual({
            sourceKind: 'builtin',
            builtinVideoId: DEFAULT_BUILTIN_POMODORO_VIDEO_ID,
            customVideoPath: '',
        });
        expect(spy).toHaveBeenCalledWith(expect.objectContaining({
            v: BRIDGE_VERSION,
            store: 'pomodoro',
            action: 'applyEndActionSettings',
            args: ['topWindow', {
                sourceKind: 'custom',
                builtinVideoId: DEFAULT_BUILTIN_POMODORO_VIDEO_ID,
                customVideoPath: '/tmp/custom.mp4',
            }],
        }));
        spy.mockRestore();
    });
});
