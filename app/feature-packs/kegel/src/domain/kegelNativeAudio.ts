import { invoke } from '@tauri-apps/api/core';
import { kegelScale, type KegelPhase, type KegelSession } from './kegel';
import { createBellGraph, nextBellPitch, scheduleBell, type KegelAudioPlayer } from './kegelAudio';

export interface RenderedBell { sampleRate: number; channels: number; pcmBase64: string; }
export interface BellRenderRequest { frequency: number; phase: KegelPhase; durationSeconds: number; scale: number; }
interface PlaybackResult { accepted: boolean; fellBackToDefault: boolean; }
type Transport = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;
type Render = (request: BellRenderRequest) => Promise<RenderedBell>;

export function encodePcm16(buffer: AudioBuffer): RenderedBell {
    const channels = buffer.numberOfChannels;
    const data = Array.from({ length: channels }, (_, i) => buffer.getChannelData(i));
    const bytes = new Uint8Array(buffer.length * channels * 2);
    const view = new DataView(bytes.buffer);
    for (let frame = 0; frame < buffer.length; frame++) {
        for (let channel = 0; channel < channels; channel++) {
            const sample = Math.max(-1, Math.min(1, data[channel][frame]));
            view.setInt16((frame * channels + channel) * 2, Math.round(sample * (sample < 0 ? 32768 : 32767)), true);
        }
    }
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
    return { sampleRate: buffer.sampleRate, channels, pcmBase64: btoa(binary) };
}

/** Offline synthesis cannot play through the WebView's default hardware. */
export async function renderBell(request: BellRenderRequest): Promise<RenderedBell> {
    const finished = request.phase === 'finished';
    const rate = 22050;
    const ctx = new OfflineAudioContext(2, Math.ceil(rate * (finished ? 3 : 9.95)), rate);
    const { master, filter } = createBellGraph(ctx);
    master.gain.value = finished ? 0.27 : 0.32;
    if (finished) master.gain.setTargetAtTime(0, 1.8, 0.35);
    const voice = scheduleBell(ctx, filter, request.frequency, request.phase !== 'contract', finished ? 2.5 : 5.5,
        request.phase === 'relax' || request.phase === 'resetting' ? 1.65 : 1);
    const duration = Math.max(0.05, request.durationSeconds);
    const curve = (map: (tension: number) => number) => Float32Array.from({ length: 128 }, (_, i) => {
        const session: KegelSession = { id: 'audio', phase: request.phase, elapsed: i / 127 * duration,
            completedReps: 0, paused: false, resetFromScale: request.scale,
            plan: { repetitions: 1, contractSeconds: duration, relaxSeconds: duration } };
        return map(Math.max(0, Math.min(1, (1 - kegelScale(session)) / 0.48)));
    });
    filter.frequency.setValueCurveAtTime(curve((tension) => 1300 + 2400 * tension), 0, duration);
    for (const oscillator of voice.oscillators) oscillator.detune.setValueCurveAtTime(curve((tension) => tension * 28 - 14), 0, duration);
    return encodePcm16(await ctx.startRendering());
}

/** Native output owns routing and tail playback; synthesis stays in the pack. */
export class KegelNativeAudio implements KegelAudioPlayer {
    private opening: Promise<number> | null = null;
    private queue = Promise.resolve();
    private epoch = 0;
    private disposed = false;
    private active = false;
    private volume = 0.5;
    private outputDeviceId: string | null = null;
    private cue = '';
    private pitch = 0;
    private finishTimer: ReturnType<typeof setTimeout> | null = null;
    constructor(private readonly report: (message: string) => void = () => {},
        private readonly transport: Transport = invoke, private readonly render: Render = renderBell) {}

    async unlock(): Promise<void> {
        if (this.disposed) return;
        if (!this.opening) {
            this.opening = this.transport<number>('begin_kegel_module_audio').catch((error) => { this.opening = null; throw error; });
            this.configure();
        }
        await this.opening;
    }
    private send(command: string, args: (token: number) => Record<string, unknown>, current: () => boolean = () => true): void {
        const opening = this.opening;
        if (!opening) return;
        this.queue = this.queue.catch(() => {}).then(async () => {
            const token = await opening;
            if (this.disposed || !current()) return;
            const result = await this.transport<PlaybackResult>(command, args(token));
            if (!this.disposed && result?.accepted) this.report(result.fellBackToDefault ? '所选播放设备不可用，已使用系统默认输出。' : '');
        }).catch(() => { if (!this.disposed) this.report('声音暂不可用，请检查番茄钟的播放设备设置。'); });
    }
    private configure(): void {
        const configuration = { epoch: this.epoch, active: this.active, outputDeviceId: this.outputDeviceId, volume: this.volume };
        this.send('configure_kegel_module_audio', (token) => ({ request: { ...configuration, token } }));
    }
    setOutputDevice(deviceId: string | null): void {
        if (this.outputDeviceId === deviceId) return;
        this.outputDeviceId = deviceId; this.configure();
    }
    private setState(active: boolean, volume: number): void {
        if (active === this.active && volume === this.volume) return;
        if (active !== this.active) { this.epoch++; this.cue = ''; }
        this.active = active; this.volume = volume; this.configure();
    }
    private play(request: BellRenderRequest): void {
        const epoch = this.epoch;
        const cue = this.cue;
        void this.render(request).then((audio) => {
            const current = () => this.active && epoch === this.epoch && cue === this.cue;
            if (this.disposed || !current()) return;
            this.send('play_kegel_module_audio', (token) => ({ request: { token, epoch, audio } }), current);
        }).catch(() => { if (!this.disposed && epoch === this.epoch) this.report('声音暂不可用，可继续使用泡泡引导。'); });
    }
    update(scale: number, audible: boolean, volume: number, phase: KegelPhase, cue: string, durationSeconds = 3): void {
        if (this.disposed) return;
        if (this.finishTimer !== null) { clearTimeout(this.finishTimer); this.finishTimer = null; }
        this.setState(audible && volume > 0, volume);
        if (!this.active || !this.opening || cue === this.cue) return;
        this.cue = cue;
        if (phase === 'contract') this.pitch = nextBellPitch(this.pitch);
        if (!this.pitch) this.pitch = nextBellPitch(0);
        this.play({ frequency: phase === 'contract' ? this.pitch : this.pitch / 2, phase, durationSeconds, scale });
    }
    finish(volume: number): void {
        if (this.disposed || !this.opening) return;
        this.epoch++; this.setState(volume > 0, volume); this.cue = 'finished'; this.configure();
        if (volume > 0) this.play({ frequency: 261.6256, phase: 'finished', durationSeconds: 2.5, scale: 1 });
        this.finishTimer = setTimeout(() => { this.finishTimer = null; this.setState(false, volume); }, 3000);
    }
    dispose(): void {
        this.disposed = true; this.epoch++;
        if (this.finishTimer !== null) clearTimeout(this.finishTimer);
        void this.opening?.then((token) => this.transport('end_kegel_module_audio', { token })).catch(() => {});
    }
}
