import { waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { encodePcm16, KegelNativeAudio, type RenderedBell } from '../../feature-packs/kegel/src/domain/kegelNativeAudio';

const sample: RenderedBell = { sampleRate: 22050, channels: 2, pcmBase64: 'AAAAAA==' };
const players: KegelNativeAudio[] = [];
afterEach(() => { players.forEach((player) => player.dispose()); players.length = 0; vi.useRealTimers(); });
function setup(render = vi.fn(async () => sample)) {
    const transport = vi.fn(async (command: string) => command === 'begin_kegel_module_audio' ? 7 : { accepted: true, fellBackToDefault: false });
    const report = vi.fn();
    const player = new KegelNativeAudio(report, transport as never, render);
    players.push(player);
    return { player, transport, render, report };
}
function calls(transport: ReturnType<typeof vi.fn>, command: string) {
    return transport.mock.calls.filter(([name]) => name === command);
}
describe('native Kegel audio routing', () => {
    it('sends host output selection and module volume to the native player', async () => {
        const { player, transport } = setup();
        player.setOutputDevice('wasapi:headphones');
        await player.unlock(); player.update(0.56, true, 0.6, 'contract', 'contract:1', 3);
        await waitFor(() => expect(calls(transport, 'play_kegel_module_audio')).toHaveLength(1));
        expect(calls(transport, 'configure_kegel_module_audio').slice(-1)[0]?.[1]).toEqual({ request: {
            token: 7, epoch: 1, active: true, outputDeviceId: 'wasapi:headphones', volume: 0.6,
        } });
        expect(calls(transport, 'play_kegel_module_audio')[0][1]).toMatchObject({ request: { token: 7, epoch: 1, audio: sample } });
    });
    it('switches hardware immediately without replaying a cue or resetting its phase', async () => {
        const { player, transport, render } = setup();
        await player.unlock(); player.update(0.55, true, 0.5, 'contract', 'contract:1');
        await waitFor(() => expect(calls(transport, 'play_kegel_module_audio')).toHaveLength(1));
        player.setOutputDevice('coreaudio:external-dac');
        player.update(0.54, true, 0.5, 'contract', 'contract:1');
        await waitFor(() => expect(calls(transport, 'configure_kegel_module_audio').slice(-1)[0]?.[1]).toMatchObject({ request: { outputDeviceId: 'coreaudio:external-dac' } }));
        expect(render).toHaveBeenCalledTimes(1);
        player.setOutputDevice(null);
        await waitFor(() => expect(calls(transport, 'configure_kegel_module_audio').slice(-1)[0]?.[1]).toMatchObject({ request: { outputDeviceId: null } }));
    });
    it('discards pending samples after pause and uses a new epoch on resume', async () => {
        let resolve!: (audio: RenderedBell) => void;
        const render = vi.fn(() => new Promise<RenderedBell>((done) => { resolve = done; }));
        const { player, transport } = setup(render);
        await player.unlock(); player.update(0.55, true, 0.5, 'contract', 'contract:1');
        player.update(0.55, false, 0.5, 'contract', 'contract:1'); resolve(sample);
        await waitFor(() => expect(calls(transport, 'configure_kegel_module_audio').slice(-1)[0]?.[1]).toMatchObject({ request: { active: false, epoch: 2 } }));
        expect(calls(transport, 'play_kegel_module_audio')).toHaveLength(0);
        player.update(0.55, true, 0.5, 'resetting', 'resetting:1', 0.6); resolve(sample);
        await waitFor(() => expect(calls(transport, 'play_kegel_module_audio')[0]?.[1]).toMatchObject({ request: { epoch: 3 } }));
    });
    it('does not play an old contraction that finishes rendering after relaxation starts', async () => {
        let resolve!: (audio: RenderedBell) => void;
        const render = vi.fn().mockImplementationOnce(() => new Promise<RenderedBell>((done) => { resolve = done; })).mockResolvedValue(sample);
        const { player, transport } = setup(render);
        await player.unlock(); player.update(0.55, true, 0.5, 'contract', 'contract:1');
        player.update(0.55, true, 0.5, 'relax', 'relax:1');
        await waitFor(() => expect(calls(transport, 'play_kegel_module_audio')).toHaveLength(1));
        resolve(sample); await Promise.resolve(); await Promise.resolve();
        expect(calls(transport, 'play_kegel_module_audio')).toHaveLength(1);
    });
    it('reports native fallback and sends explicit cleanup when the window disposes', async () => {
        const { player, transport, report } = setup();
        transport.mockImplementation(async (command: string) => command === 'begin_kegel_module_audio' ? 7 : { accepted: true, fellBackToDefault: true });
        await player.unlock(); player.update(0.55, true, 0.5, 'contract', 'contract:1');
        await waitFor(() => expect(report).toHaveBeenCalledWith('所选播放设备不可用，已使用系统默认输出。'));
        player.dispose();
        await waitFor(() => expect(transport).toHaveBeenCalledWith('end_kegel_module_audio', { token: 7 }));
    });
    it('encodes bounded stereo PCM in frame order and clips samples', () => {
        const buffer = { numberOfChannels: 2, sampleRate: 22050, length: 2,
            getChannelData: (channel: number) => channel === 0 ? Float32Array.of(-2, 0) : Float32Array.of(2, 0.5) } as AudioBuffer;
        const rendered = encodePcm16(buffer);
        const binary = atob(rendered.pcmBase64);
        const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
        const view = new DataView(bytes.buffer);
        expect([0, 2, 4, 6].map((offset) => view.getInt16(offset, true))).toEqual([-32768, 32767, 0, 16384]);
        expect(rendered).toMatchObject({ channels: 2, sampleRate: 22050 });
    });
});
