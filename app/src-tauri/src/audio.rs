use rodio::cpal::traits::{DeviceTrait, HostTrait};
use rodio::{Decoder, DeviceSinkBuilder, MixerDeviceSink, Player};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs::File;
use std::io::{Cursor, Read, Seek};
use std::str::FromStr;
use std::sync::Mutex;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioOutputDevice {
    id: String,
    name: String,
    is_default: bool,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum SoundSource {
    Builtin { id: String },
    Custom { path: String },
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaySoundRequest {
    source: SoundSource,
    output_device_id: Option<String>,
    volume: f32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioPlaybackResult {
    fell_back_to_default: bool,
}

struct ActivePlayback {
    _player: Player,
    _device_sink: MixerDeviceSink,
}

#[derive(Default)]
pub struct AudioPlaybackState(Mutex<Option<ActivePlayback>>);

trait AudioReader: Read + Seek + Send + Sync {}
impl<T: Read + Seek + Send + Sync> AudioReader for T {}

#[tauri::command]
pub fn list_audio_output_devices() -> Result<Vec<AudioOutputDevice>, String> {
    let host = rodio::cpal::default_host();
    let default_id = host
        .default_output_device()
        .and_then(|device| device.id().ok())
        .map(|id| id.to_string());
    let mut seen = HashSet::new();
    let mut devices = host
        .output_devices()
        .map_err(|error| format!("无法读取音频输出设备：{error}"))?
        .filter_map(|device| {
            let id = device.id().ok()?.to_string();
            if !seen.insert(id.clone()) {
                return None;
            }
            Some(AudioOutputDevice {
                is_default: default_id.as_deref() == Some(id.as_str()),
                id,
                name: device
                    .description()
                    .map(|description| description.name().to_string())
                    .unwrap_or_else(|_| "未命名音频设备".to_string()),
            })
        })
        .collect::<Vec<_>>();
    devices.sort_by(|a, b| {
        b.is_default
            .cmp(&a.is_default)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(devices)
}

#[tauri::command]
pub fn play_sound(
    state: tauri::State<'_, AudioPlaybackState>,
    request: PlaySoundRequest,
) -> Result<AudioPlaybackResult, String> {
    let host = rodio::cpal::default_host();
    let requested_device = request
        .output_device_id
        .as_deref()
        .filter(|id| !id.trim().is_empty());
    let (device, fell_back_to_default) = resolve_output_device(&host, requested_device)?;
    let device_sink = DeviceSinkBuilder::from_device(device)
        .map_err(|error| format!("无法配置音频输出设备：{error}"))?
        .open_sink_or_fallback()
        .map_err(|error| format!("无法打开音频输出设备：{error}"))?;
    let reader = sound_reader(request.source)?;
    let decoder = Decoder::builder()
        .with_data(reader)
        .with_hint("mp3")
        .build()
        .map_err(|error| format!("无法解码 MP3 音频：{error}"))?;
    let player = Player::connect_new(device_sink.mixer());
    player.set_volume(normalize_volume(request.volume));
    player.append(decoder);

    let mut active = state
        .0
        .lock()
        .map_err(|_| "音频播放器状态不可用".to_string())?;
    *active = Some(ActivePlayback {
        _player: player,
        _device_sink: device_sink,
    });

    Ok(AudioPlaybackResult {
        fell_back_to_default,
    })
}

fn resolve_output_device(
    host: &rodio::cpal::Host,
    requested_id: Option<&str>,
) -> Result<(rodio::Device, bool), String> {
    if let Some(requested_id) = requested_id {
        if let Ok(device_id) = rodio::cpal::DeviceId::from_str(requested_id) {
            if let Some(device) = host.device_by_id(&device_id) {
                if device.default_output_config().is_ok() {
                    return Ok((device, false));
                }
            }
        }
    }

    host.default_output_device()
        .map(|device| (device, requested_id.is_some()))
        .ok_or_else(|| "系统中没有可用的音频输出设备".to_string())
}

fn sound_reader(source: SoundSource) -> Result<Box<dyn AudioReader>, String> {
    match source {
        SoundSource::Builtin { id } => builtin_sound_bytes(&id)
            .map(|bytes| Box::new(Cursor::new(bytes)) as Box<dyn AudioReader>)
            .ok_or_else(|| format!("未知的内置声音：{id}")),
        SoundSource::Custom { path } => {
            let validation = crate::sound_files::validate_mp3_path(std::path::Path::new(&path));
            if !validation.ok {
                return Err(validation
                    .message
                    .unwrap_or_else(|| "自定义铃声不可用".to_string()));
            }
            File::open(&path)
                .map(|file| Box::new(file) as Box<dyn AudioReader>)
                .map_err(|error| format!("无法读取自定义铃声：{error}"))
        }
    }
}

fn builtin_sound_bytes(id: &str) -> Option<&'static [u8]> {
    match id {
        "clear-success" => Some(include_bytes!(
            "../../public/sounds/pomodoro/focus-clear-success.mp3"
        )),
        "light-success" => Some(include_bytes!(
            "../../public/sounds/pomodoro/focus-light-success.mp3"
        )),
        "glockenspiel-reward" => Some(include_bytes!(
            "../../public/sounds/pomodoro/focus-glockenspiel-reward.mp3"
        )),
        "high-bell-approval" => Some(include_bytes!(
            "../../public/sounds/pomodoro/focus-high-bell-approval.mp3"
        )),
        "triple-ping" => Some(include_bytes!(
            "../../public/sounds/pomodoro/break-triple-ping.mp3"
        )),
        "mid-bass-notice" => Some(include_bytes!(
            "../../public/sounds/pomodoro/break-mid-bass-notice.mp3"
        )),
        "vintage-alarm" => Some(include_bytes!(
            "../../public/sounds/pomodoro/break-vintage-alarm.mp3"
        )),
        _ => None,
    }
}

fn normalize_volume(volume: f32) -> f32 {
    if volume.is_finite() {
        volume.clamp(0.0, 1.0)
    } else {
        1.0
    }
}

#[cfg(test)]
mod tests {
    use super::{builtin_sound_bytes, normalize_volume};

    #[test]
    fn embeds_every_builtin_pomodoro_sound() {
        for id in [
            "clear-success",
            "light-success",
            "glockenspiel-reward",
            "high-bell-approval",
            "triple-ping",
            "mid-bass-notice",
            "vintage-alarm",
        ] {
            assert!(builtin_sound_bytes(id).is_some(), "missing {id}");
        }
        assert!(builtin_sound_bytes("unknown").is_none());
    }

    #[test]
    fn clamps_playback_volume() {
        assert_eq!(normalize_volume(-0.5), 0.0);
        assert_eq!(normalize_volume(0.4), 0.4);
        assert_eq!(normalize_volume(2.0), 1.0);
        assert_eq!(normalize_volume(f32::NAN), 1.0);
    }
}
