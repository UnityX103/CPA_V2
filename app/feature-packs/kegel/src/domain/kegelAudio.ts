import type { KegelPhase } from './kegel';

export const BELL_PITCHES = [196, 220, 261.6256, 293.6648, 329.6276, 392] as const;
const PARTIALS = [1, 2.01, 2.76, 3.92, 5.43, 6.8];
const LEVELS = [0.55, 0.23, 0.16, 0.1, 0.06, 0.035];
interface BellVoice { oscillators: OscillatorNode[]; gains: GainNode[]; }
export interface KegelAudioPlayer {
    unlock(): Promise<void>;
    setOutputDevice(deviceId: string | null): void;
    update(scale: number, audible: boolean, volume: number, phase: KegelPhase, cue: string, durationSeconds?: number): void;
    finish(volume: number): void;
    dispose(): void;
}

/** Shared graph for browser preview and offline samples routed to native output. */
export function createBellGraph(ctx: BaseAudioContext) {
    const master = ctx.createGain(); master.gain.value = 0;
    const filter = ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 2400;
    const dry = ctx.createGain(); dry.gain.value = 0.42;
    const wet = ctx.createGain(); wet.gain.value = 0.9;
    const reverb = ctx.createConvolver();
    const impulse = ctx.createBuffer(2, Math.round(ctx.sampleRate * 4.4), ctx.sampleRate);
    for (let channel = 0; channel < 2; channel++) {
        const data = impulse.getChannelData(channel);
        for (let i = 0; i < data.length; i++) {
            const t = i / ctx.sampleRate;
            data[i] = t < 0.025 ? 0 : (Math.random() * 2 - 1) * Math.exp(-t * 1.25) * Math.min(1, (t - 0.025) / 0.07);
        }
    }
    reverb.buffer = impulse;
    filter.connect(dry).connect(master);
    filter.connect(reverb).connect(wet).connect(master);
    master.connect(ctx.destination);
    return { master, filter, reverb };
}

export function scheduleBell(ctx: BaseAudioContext, filter: BiquadFilterNode, frequency: number,
    soft: boolean, duration: number, level: number): BellVoice {
    const start = ctx.currentTime;
    const voice: BellVoice = { oscillators: [], gains: [] };
    PARTIALS.forEach((ratio, index) => {
        const oscillator = ctx.createOscillator(); oscillator.type = 'sine'; oscillator.frequency.value = frequency * ratio;
        const gain = ctx.createGain();
        const end = start + duration / (1 + index * 0.22);
        const peak = LEVELS[index] * (soft ? (index === 0 ? 0.8 : 0.35) : 1) * level;
        gain.gain.setValueAtTime(0, start);
        gain.gain.linearRampToValueAtTime(peak, start + (soft ? 0.04 : 0.007));
        gain.gain.exponentialRampToValueAtTime(0.00001, end);
        oscillator.connect(gain).connect(filter); oscillator.start(start); oscillator.stop(end + 0.03);
        voice.oscillators.push(oscillator); voice.gains.push(gain);
    });
    return voice;
}

export function nextBellPitch(previous: number, random = Math.random): number {
    let index = Math.min(BELL_PITCHES.length - 2, Math.floor(random() * (BELL_PITCHES.length - 1)));
    const previousIndex = BELL_PITCHES.findIndex((pitch) => pitch === previous);
    if (previousIndex < 0) return BELL_PITCHES[Math.min(BELL_PITCHES.length - 1, Math.floor(random() * BELL_PITCHES.length))];
    if (index >= previousIndex) index++;
    return BELL_PITCHES[index];
}

/** Pitched bronze-bell partials with a stereo hall tail. No external samples. */
export class KegelAudio implements KegelAudioPlayer {
    private context: AudioContext | null = null;
    private master: GainNode | null = null;
    private filter: BiquadFilterNode | null = null;
    private reverb: ConvolverNode | null = null;
    private voices: BellVoice[] = [];
    private cue = '';
    private pitch = 0;
    setOutputDevice(_deviceId: string | null): void { /* Browser preview uses its own default output. */ }

    async unlock(): Promise<void> {
        if (!this.context) {
            const ctx = new AudioContext();
            this.context = ctx;
            const { master, filter, reverb } = createBellGraph(ctx);
            this.master = master; this.filter = filter; this.reverb = reverb;
        }
        await this.context.resume();
    }

    private strike(frequency: number, soft: boolean, duration = 5.5, level = 1): void {
        if (!this.context || !this.filter) return;
        const ctx = this.context;
        const voice = scheduleBell(ctx, this.filter, frequency, soft, duration, level);
        voice.oscillators.forEach((oscillator, index) => {
            const gain = voice.gains[index];
            oscillator.onended = () => {
                oscillator.disconnect(); gain.disconnect();
                if (index === 0) this.voices = this.voices.filter((v) => v !== voice);
            };
        });
        this.voices.push(voice);
    }

    update(scale: number, audible: boolean, volume: number, phase: KegelPhase, cue: string): void {
        if (!this.context || !this.master || !this.filter) return;
        const now = this.context.currentTime;
        if (!audible || volume === 0) {
            this.master.gain.setTargetAtTime(0, now, 0.025);
            if (this.cue) {
                // Clear old voices and reverb so resume cannot revive a paused tail.
                this.voices.forEach((voice) => voice.oscillators.forEach((oscillator) => {
                    try { oscillator.stop(now + 0.08); } catch { /* already ended */ }
                }));
                if (this.reverb?.buffer) { const buffer = this.reverb.buffer; this.reverb.buffer = null; this.reverb.buffer = buffer; }
                this.voices = []; this.cue = '';
            }
            return;
        }
        this.master.gain.setTargetAtTime(volume * 0.32, now, 0.035);
        if (cue !== this.cue) {
            this.cue = cue;
            if (phase === 'contract') this.pitch = nextBellPitch(this.pitch);
            if (!this.pitch) this.pitch = nextBellPitch(0);
            // Bring the softer, lower relaxation bell forward without changing
            // the contraction cue, finishing cue, or the user's volume setting.
            this.strike(phase === 'contract' ? this.pitch : this.pitch / 2,
                phase !== 'contract', 5.5, phase === 'relax' || phase === 'resetting' ? 1.65 : 1);
        }
        const tension = Math.max(0, Math.min(1, (1 - scale) / 0.48));
        this.filter.frequency.setTargetAtTime(1300 + 2400 * tension, now, 0.4);
        this.voices.forEach((voice) => voice.oscillators.forEach((oscillator) => {
            oscillator.detune.setTargetAtTime(tension * 28 - 14, now, 0.3);
        }));
    }

    finish(volume: number): void {
        if (!this.context || !this.master) return;
        this.master.gain.setTargetAtTime(volume * 0.27, this.context.currentTime, 0.03);
        this.strike(261.6256, true, 2.5);
        this.master.gain.setTargetAtTime(0, this.context.currentTime + 1.8, 0.35);
    }
    dispose(): void {
        this.voices.forEach((voice) => voice.oscillators.forEach((oscillator) => { try { oscillator.stop(); } catch { /* ended */ } }));
        void this.context?.close(); this.context = null; this.voices = [];
    }
}
