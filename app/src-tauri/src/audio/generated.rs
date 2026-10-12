//! Bounded generated PCM playback through the same CPAL device resolver as MP3.
//! No feature synthesis, exercises, or sample assets belong in the host.
use super::{normalize_volume, resolve_output_device};
use base64::Engine;
use rodio::{buffer::SamplesBuffer, cpal::traits::DeviceTrait, DeviceSinkBuilder, MixerDeviceSink, Player, Source};
use serde::Deserialize;
use std::{num::NonZero, time::Instant};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PcmAudio {
    pub sample_rate: u32,
    pub channels: u16,
    pub pcm_base64: String,
}
impl PcmAudio {
    pub fn decode(self) -> Result<SamplesBuffer, String> {
        if ![22050, 24000, 44100, 48000].contains(&self.sample_rate) || ![1, 2].contains(&self.channels)
            || self.pcm_base64.len() > 2_560_000 { return Err("合成音频格式或大小无效".into()); }
        let bytes = base64::engine::general_purpose::STANDARD.decode(&self.pcm_base64).map_err(|_| "合成音频编码无效")?;
        let frame_bytes = self.channels as usize * 2;
        if bytes.is_empty() || bytes.len() % frame_bytes != 0 || bytes.len() > self.sample_rate as usize * frame_bytes * 10 {
            return Err("合成音频长度无效".into());
        }
        let samples = bytes.chunks_exact(2).map(|b| i16::from_le_bytes([b[0], b[1]]) as f32 / 32768.0).collect::<Vec<_>>();
        Ok(SamplesBuffer::new(NonZero::new(self.channels).unwrap(), NonZero::new(self.sample_rate).unwrap(), samples))
    }
}
struct Voice { player: Player, samples: SamplesBuffer, started_at: Instant }
#[derive(Default)]
pub struct GeneratedAudioOutput {
    device_sink: Option<MixerDeviceSink>,
    requested_id: Option<String>,
    actual_id: Option<String>,
    volume: f32,
    voices: Vec<Voice>,
}
impl GeneratedAudioOutput {
    fn ensure_output(&mut self) -> Result<bool, String> {
        let (device, fallback) = resolve_output_device(&rodio::cpal::default_host(), self.requested_id.as_deref())?;
        let actual = device.id().map_err(|e| e.to_string())?.to_string();
        self.voices.retain(|voice| !voice.player.empty());
        if self.device_sink.is_some() && self.actual_id.as_deref() == Some(&actual) { return Ok(fallback); }
        let mut sink = DeviceSinkBuilder::from_device(device).map_err(|e| format!("无法配置音频设备：{e}"))?
            .open_sink_or_fallback().map_err(|e| format!("无法打开音频设备：{e}"))?;
        sink.log_on_drop(false);
        // Recreate the unfinished tails on the new device at their current
        // position; changing hardware does not restart the exercise or bell.
        for voice in &mut self.voices {
            voice.player.stop();
            let player = Player::connect_new(sink.mixer());
            player.set_volume(self.volume);
            player.append(voice.samples.clone().skip_duration(voice.started_at.elapsed()));
            voice.player = player;
        }
        self.device_sink = Some(sink); self.actual_id = Some(actual);
        Ok(fallback)
    }
    pub fn configure(&mut self, output_device_id: Option<String>, volume: f32, active: bool) -> Result<bool, String> {
        self.requested_id = output_device_id;
        self.volume = normalize_volume(volume);
        if !active || self.volume == 0.0 { self.stop(); return Ok(false); }
        for voice in &self.voices { voice.player.set_volume(self.volume); }
        if self.voices.is_empty() { return Ok(false); }
        match self.ensure_output() { Ok(fallback) => Ok(fallback), Err(error) => { self.stop(); Err(error) } }
    }
    pub fn play(&mut self, samples: SamplesBuffer) -> Result<bool, String> {
        let fallback = self.ensure_output()?;
        if self.voices.len() >= 16 { return Err("合成音频并发数量超过限制".into()); }
        let player = Player::connect_new(self.device_sink.as_ref().ok_or("音频设备不可用")?.mixer());
        player.set_volume(self.volume); player.append(samples.clone());
        self.voices.push(Voice { player, samples, started_at: Instant::now() });
        Ok(fallback)
    }
    pub fn stop(&mut self) {
        for voice in &self.voices { voice.player.stop(); }
        self.voices.clear(); self.device_sink = None; self.actual_id = None;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn decodes_interleaved_pcm_with_bounded_rates_channels_and_duration() {
        let bytes = [0_u8, 0, 255, 127, 0, 128, 0, 0];
        let encoded = base64::engine::general_purpose::STANDARD.encode(bytes);
        let samples = PcmAudio { sample_rate: 22050, channels: 2, pcm_base64: encoded.clone() }.decode().unwrap().collect::<Vec<_>>();
        assert_eq!(samples, [0.0, 32767.0 / 32768.0, -1.0, 0.0]);
        assert!(PcmAudio { sample_rate: 0, channels: 2, pcm_base64: encoded.clone() }.decode().is_err());
        assert!(PcmAudio { sample_rate: 22050, channels: 3, pcm_base64: encoded }.decode().is_err());
        assert!(PcmAudio { sample_rate: 22050, channels: 2, pcm_base64: "invalid".into() }.decode().is_err());
        assert!(PcmAudio { sample_rate: 22050, channels: 2, pcm_base64: base64::engine::general_purpose::STANDARD.encode([0_u8; 2]) }.decode().is_err());
        assert!(PcmAudio { sample_rate: 22050, channels: 1, pcm_base64: base64::engine::general_purpose::STANDARD.encode(vec![0_u8; 22050 * 2 * 11]) }.decode().is_err());
    }

    #[test]
    #[ignore = "requires physical audio output devices"]
    fn generated_audio_follows_selected_hardware_and_preserves_unfinished_tails() {
        let devices = super::super::list_audio_output_devices().expect("list output devices");
        assert!(!devices.is_empty(), "at least one audio output device");
        let mut output = GeneratedAudioOutput::default();
        let samples = SamplesBuffer::new(NonZero::new(2).unwrap(), NonZero::new(22050).unwrap(), vec![0.0; 22050 * 2 * 5]);
        for (index, device) in devices.iter().enumerate() {
            eprintln!("generated audio smoke device: {}", device.name);
            assert!(!output.configure(Some(device.id.clone()), 0.4, true).expect("configure selected device"));
            if index == 0 {
                assert!(!output.play(samples.clone()).expect("play generated PCM"));
            }
            assert_eq!(output.actual_id.as_deref(), Some(device.id.as_str()));
            assert_eq!(output.voices.len(), 1, "hardware switching must keep the current tail");
            assert!(!output.voices[0].player.empty());
            let started_at = output.voices[0].started_at;
            assert!(!output.configure(Some(device.id.clone()), 0.6, true).unwrap());
            assert_eq!(output.voices[0].started_at, started_at, "volume changes must not replay a bell");
        }
        let original_start = output.voices[0].started_at;
        assert!(output.configure(Some("missing-device".into()), 0.4, true).expect("fall back to default"));
        assert_eq!(output.actual_id.as_deref(), devices.iter().find(|device| device.is_default).map(|device| device.id.as_str()));
        assert_eq!(output.voices[0].started_at, original_start, "fallback must preserve playback position");
        output.configure(None, 0.4, false).unwrap();
        assert!(output.voices.is_empty());
        assert!(output.device_sink.is_none());
    }
}
