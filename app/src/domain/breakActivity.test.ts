import { describe, expect, it } from 'vitest';
import { createPomodoroStore } from './pomodoro';
import { KegelController } from '../../feature-packs/kegel/src/controller';
import { DEFAULT_KEGEL_SETTINGS, kegelScale } from '../../feature-packs/kegel/src/domain/kegel';
import { kegelStats } from '../../feature-packs/kegel/src/domain/kegelHistory';

function setup(breakSeconds = 300, repetitions = 15) {
    const store = createPomodoroStore({ isSettingsWindow: false });
    const controller = new KegelController({
        control: (id, action) => store.getState().controlBreakActivity(id, action),
        saveHistory: async () => {}, saveSettings: async () => {},
    });
    controller.hydrate({ ...DEFAULT_KEGEL_SETTINGS, enabled: true, repetitions }, []);
    const transmit = () => {
        const state = store.getState();
        controller.receive({ activity: state.breakActivity, phase: state.currentPhase, remainingSeconds: state.remainingSeconds });
    };
    store.subscribe(transmit);
    store.getState().configureBreakActivity('wellness.kegel');
    store.getState().applySettings(1, breakSeconds, 2, true, true);
    store.getState().start(); store.getState().tick(1);
    const tick = async (seconds: number) => { store.getState().tick(seconds); controller.tick(seconds); await controller.flush(); };
    return { store, controller, tick, toggle: () => controller.control('toggle') };
}
describe('installed break-activity integration', () => {
    it('leaves ordinary auto-start unchanged when no feature is registered', () => {
        const store = createPomodoroStore({ isSettingsWindow: false });
        store.getState().applySettings(1, 5, 2, true, true);
        store.getState().start(); store.getState().tick(1);
        expect(store.getState()).toMatchObject({ currentPhase: 'break', breakActivity: null, isRunning: true });
    });
    it('reserves a break before auto-start and denies conflicting presence automation', async () => {
        const { store, toggle, tick } = setup();
        expect(store.getState().isRunning).toBe(false);
        await tick(20);
        expect(store.getState().remainingSeconds).toBe(300);
        expect(store.getState().resumeBreakFromPresence()).toBe(false);
        await toggle();
        expect(store.getState().pauseBreakFromPresence()).toBe(false);
    });
    it('lets an independent exercise finish first and retains the remaining break', async () => {
        const { store, controller, toggle, tick } = setup();
        await toggle(); await tick(90);
        expect(controller.state.session?.phase).toBe('finished');
        expect(store.getState().breakActivity).toBeNull();
        expect(store.getState().remainingSeconds).toBe(210);
        expect(kegelStats(controller.state.history)).toMatchObject({ sets: 1, repetitions: 15, streak: 1 });
        await tick(210);
        expect(store.getState().currentPhase).toBe('focus');
    });
    it('holds at zero until the longer exercise finishes', async () => {
        const { store, controller, toggle, tick } = setup(2, 2);
        await toggle(); await tick(11);
        expect(store.getState()).toMatchObject({ remainingSeconds: 0, currentPhase: 'break' });
        await tick(1);
        expect(store.getState().currentPhase).toBe('focus');
        expect(kegelStats(controller.state.history).sets).toBe(1);
    });
    it('freezes both timers and repeats only the unfinished action after an uncounted reset', async () => {
        const { store, controller, toggle, tick } = setup();
        await toggle(); await tick(10);
        const scale = kegelScale(controller.state.session);
        await toggle(); await tick(30);
        expect(store.getState().remainingSeconds).toBe(290);
        expect(kegelScale(controller.state.session)).toBe(scale);
        await toggle(); await tick(0.6);
        expect(store.getState().remainingSeconds).toBe(290);
        expect(controller.state.session).toMatchObject({ phase: 'contract', elapsed: 0, completedReps: 1 });
        await tick(6);
        expect(kegelStats(controller.state.history)).toMatchObject({ sets: 0, repetitions: 2 });
    });
    it('releases the timer on disable while retaining feature-owned partial history', async () => {
        const { store, controller, toggle, tick } = setup();
        await toggle(); await tick(7);
        store.getState().configureBreakActivity(null);
        expect(store.getState()).toMatchObject({ breakActivity: null, isRunning: true });
        expect(controller.state.session?.phase).toBe('skipped');
        expect(kegelStats(controller.state.history)).toMatchObject({ sets: 0, repetitions: 1 });
        store.getState().reset();
        expect(kegelStats(controller.state.history).repetitions).toBe(1);
    });
    it('ignores a stale session command after a reset', async () => {
        const { store } = setup();
        const id = store.getState().breakActivity!.id;
        store.getState().reset();
        store.getState().controlBreakActivity(id, 'finish');
        expect(store.getState()).toMatchObject({ currentPhase: 'focus', isRunning: false, breakActivity: null });
    });
    it('refreshes settings without replacing unsaved counts or the current exercise plan', async () => {
        const { controller, toggle, tick } = setup();
        await toggle(); await tick(7);
        const history = controller.state.history;
        controller.refreshSettings({ ...controller.state.settings, repetitions: 20, volume: 0.8 });
        expect(controller.state.history).toBe(history);
        expect(controller.state.settings.repetitions).toBe(20);
        expect(controller.state.session?.plan.repetitions).toBe(15);
        expect(controller.state.session?.completedReps).toBe(1);
    });
    it('keeps exercise progress when the host changes audio hardware', async () => {
        const { store, controller, toggle, tick } = setup();
        await toggle(); await tick(7);
        const session = controller.state.session;
        controller.receive({ activity: store.getState().breakActivity, phase: 'break', remainingSeconds: 293,
            audioOutputDeviceId: 'wasapi:headphones' });
        expect(controller.state.audioOutputDeviceId).toBe('wasapi:headphones');
        expect(controller.state.session).toBe(session);
    });
});
