//! Allow-listed host adapter. Exercise code is loaded only from a verified pack.
use crate::extension_packs::{pack_is_enabled, replace_file_atomically, web_pack::KEGEL_ID};
use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, fs, sync::Mutex};
use tauri::{Emitter, Manager};
static DATA_LOCK: Mutex<()> = Mutex::new(());

#[derive(Default)]
struct KegelAudioSession {
    token: u64, epoch: u32, active: bool,
    output: crate::audio::generated::GeneratedAudioOutput,
}
impl KegelAudioSession {
    fn accepts(&self, token: u64, epoch: u32) -> bool { self.token == token && self.epoch == epoch && self.active }
    fn stop(&mut self) { self.token = self.token.wrapping_add(1); self.active = false; self.output.stop(); }
}
#[derive(Default)]
pub struct KegelAudioState(Mutex<KegelAudioSession>);

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct KegelAudioConfiguration {
    token: u64, epoch: u32, active: bool, output_device_id: Option<String>, volume: f32,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct KegelAudioRequest { token: u64, epoch: u32, audio: crate::audio::generated::PcmAudio }
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KegelAudioResult { accepted: bool, fell_back_to_default: bool }

#[tauri::command]
pub fn begin_kegel_module_audio(app: tauri::AppHandle, window: tauri::WebviewWindow) -> Result<u64, String> {
    check_window(&app, &window, true)?;
    let state = app.state::<KegelAudioState>();
    let mut session = state.0.lock().map_err(|_| "音频状态不可用")?;
    session.stop(); session.epoch = 0; Ok(session.token)
}
#[tauri::command]
pub async fn configure_kegel_module_audio(app: tauri::AppHandle, window: tauri::WebviewWindow, request: KegelAudioConfiguration) -> Result<KegelAudioResult, String> {
    check_window(&app, &window, true)?;
    if !request.volume.is_finite() || !(0.0..=1.0).contains(&request.volume)
        || request.output_device_id.as_ref().is_some_and(|id| id.len() > 1024) { return Err("音频配置无效".into()); }
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<KegelAudioState>();
        let mut session = state.0.lock().map_err(|_| "音频状态不可用")?;
        if session.token != request.token || request.epoch < session.epoch {
            return Ok(KegelAudioResult { accepted: false, fell_back_to_default: false });
        }
        session.epoch = request.epoch; session.active = request.active && request.volume > 0.0;
        let active = session.active;
        let fallback = session.output.configure(request.output_device_id, request.volume, active)?;
        Ok(KegelAudioResult { accepted: true, fell_back_to_default: fallback })
    }).await.map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn play_kegel_module_audio(app: tauri::AppHandle, window: tauri::WebviewWindow, request: KegelAudioRequest) -> Result<KegelAudioResult, String> {
    check_window(&app, &window, true)?;
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<KegelAudioState>();
        let mut session = state.0.lock().map_err(|_| "音频状态不可用")?;
        if !session.accepts(request.token, request.epoch) { return Ok(KegelAudioResult { accepted: false, fell_back_to_default: false }); }
        let fallback = session.output.play(request.audio.decode()?)?;
        Ok(KegelAudioResult { accepted: true, fell_back_to_default: fallback })
    }).await.map_err(|e| e.to_string())?
}
#[tauri::command]
pub fn end_kegel_module_audio(app: tauri::AppHandle, window: tauri::WebviewWindow, token: u64) -> Result<(), String> {
    // Closing must remain possible even after the manager disabled the feature.
    if window.label() != "kegel" { return Err("此窗口无权停止模块音频".into()); }
    let state = app.state::<KegelAudioState>();
    let mut session = state.0.lock().map_err(|_| "音频状态不可用")?;
    if session.token == token { session.stop(); }
    Ok(())
}
pub fn stop_audio(app: &tauri::AppHandle) {
    if let Ok(mut session) = app.state::<KegelAudioState>().0.lock() { session.stop(); }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KegelSettings {
    #[serde(default)] pub enabled: bool,
    pub repetitions: u32, pub contract_seconds: u32, pub relax_seconds: u32,
    pub volume: f64, pub muted: bool,
}
impl Default for KegelSettings {
    fn default() -> Self { Self { enabled: true, repetitions: 15, contract_seconds: 3, relax_seconds: 3, volume: 0.5, muted: false } }
}
impl KegelSettings {
    fn validate(&self) -> Result<(), String> {
        if !(1..=99).contains(&self.repetitions) || !(1..=60).contains(&self.contract_seconds)
            || !(1..=60).contains(&self.relax_seconds) || !self.volume.is_finite()
            || !(0.0..=1.0).contains(&self.volume) { return Err("凯格尔参数超出范围".into()); }
        Ok(())
    }
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KegelRecord { pub id: String, pub target_reps: u32, pub reps_by_day: BTreeMap<String, u32>, pub completed_on: Option<String> }
#[derive(Clone, Deserialize, Serialize)]
pub struct KegelPreferences { settings: KegelSettings, history: Vec<KegelRecord> }
fn valid_day(day: &str) -> bool {
    let bytes = day.as_bytes();
    bytes.len() == 10 && bytes[4] == b'-' && bytes[7] == b'-'
        && bytes.iter().enumerate().all(|(i, b)| i == 4 || i == 7 || b.is_ascii_digit())
        && day[5..7].parse::<u32>().is_ok_and(|n| (1..=12).contains(&n))
        && day[8..10].parse::<u32>().is_ok_and(|n| (1..=31).contains(&n))
}
fn validate_history(history: &[KegelRecord]) -> Result<(), String> {
    if history.len() > 100_000 { return Err("运动记录超过数量限制".into()); }
    let mut ids = std::collections::HashSet::new();
    for record in history {
        let total = record.reps_by_day.values().try_fold(0_u32, |sum, n| sum.checked_add(*n)).ok_or("运动记录次数溢出")?;
        if record.id.is_empty() || record.id.len() > 128 || !ids.insert(&record.id)
            || !(1..=99).contains(&record.target_reps) || total > record.target_reps
            || record.reps_by_day.keys().any(|day| !valid_day(day))
            || record.completed_on.as_ref().is_some_and(|day| !valid_day(day) || total != record.target_reps || !record.reps_by_day.contains_key(day)) {
            return Err("运动记录格式无效".into());
        }
    }
    Ok(())
}
fn check_window(app: &tauri::AppHandle, window: &tauri::WebviewWindow, writer: bool) -> Result<(), String> {
    if (writer && window.label() != "kegel") || (!writer && !["settings", "kegel"].contains(&window.label())) {
        return Err("此窗口无权访问凯格尔模块数据".into());
    }
    if !pack_is_enabled(app, KEGEL_ID)? { return Err("凯格尔模块未安装或已停用".into()); }
    Ok(())
}
fn load_value(app: &tauri::AppHandle, file: &str, key: &str) -> Result<Option<serde_json::Value>, String> {
    let path = app.path().app_data_dir().map_err(|e| e.to_string())?.join(file);
    if !path.is_file() { return Ok(None); }
    let value: serde_json::Value = serde_json::from_slice(&fs::read(path).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    Ok(value.get(key).cloned())
}
fn save_value(app: &tauri::AppHandle, file: &str, key: &str, value: serde_json::Value) -> Result<(), String> {
    let root = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    let temporary = root.join(format!(".{file}.tmp"));
    let mut document = serde_json::Map::new(); document.insert(key.into(), value);
    fs::write(&temporary, serde_json::to_vec_pretty(&document).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    replace_file_atomically(&temporary, &root.join(file), "保存凯格尔模块数据")?;
    let _ = app.emit("kegel-module-data-changed", ());
    Ok(())
}
#[tauri::command]
pub fn kegel_module_preferences(app: tauri::AppHandle, window: tauri::WebviewWindow) -> Result<KegelPreferences, String> {
    check_window(&app, &window, false)?;
    let _guard = DATA_LOCK.lock().map_err(|e| e.to_string())?;
    let mut settings: KegelSettings = load_value(&app, "kegel-settings.json", "kegelSettings")?
        .map(serde_json::from_value).transpose().map_err(|e| e.to_string())?.unwrap_or_default();
    settings.enabled = true; settings.validate()?;
    let history: Vec<KegelRecord> = load_value(&app, "kegel-history.json", "history")?
        .map(serde_json::from_value).transpose().map_err(|e| e.to_string())?.unwrap_or_default();
    validate_history(&history)?;
    Ok(KegelPreferences { settings, history })
}
#[tauri::command]
pub fn save_kegel_module_settings(app: tauri::AppHandle, window: tauri::WebviewWindow, mut settings: KegelSettings) -> Result<(), String> {
    check_window(&app, &window, false)?;
    settings.validate()?; settings.enabled = true;
    let _guard = DATA_LOCK.lock().map_err(|e| e.to_string())?;
    save_value(&app, "kegel-settings.json", "kegelSettings", serde_json::to_value(settings).map_err(|e| e.to_string())?)?;
    let _ = app.emit_to("kegel", "kegel-module-settings-changed", ());
    Ok(())
}
#[tauri::command]
pub fn save_kegel_module_history(app: tauri::AppHandle, window: tauri::WebviewWindow, history: Vec<KegelRecord>) -> Result<(), String> {
    check_window(&app, &window, true)?;
    validate_history(&history)?;
    let _guard = DATA_LOCK.lock().map_err(|e| e.to_string())?;
    save_value(&app, "kegel-history.json", "history", serde_json::to_value(history).map_err(|e| e.to_string())?)
}
#[tauri::command]
pub fn control_kegel_break_activity(app: tauri::AppHandle, window: tauri::WebviewWindow, id: String, action: String) -> Result<(), String> {
    check_window(&app, &window, true)?;
    if id.is_empty() || id.len() > 128 || !["toggle", "skip", "finish", "resume-ready"].contains(&action.as_str()) {
        return Err("休息活动指令无效".into());
    }
    app.emit_to("main", "break-activity:control", serde_json::json!({ "ownerId": KEGEL_ID, "id": id, "action": action })).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn stopping_rejects_old_rendered_buffers_and_accepts_only_the_current_epoch() {
        let mut session = KegelAudioSession::default();
        session.stop(); session.epoch = 2; session.active = true;
        assert!(session.accepts(1, 2)); assert!(!session.accepts(1, 1));
        session.stop(); assert!(!session.accepts(1, 2));
        session.active = true; assert!(session.accepts(2, 2));
    }
    #[test] fn settings_and_history_reject_invalid_counts_and_partial_completion() {
        assert!(KegelSettings::default().validate().is_ok());
        assert!(KegelSettings { volume: f64::NAN, ..KegelSettings::default() }.validate().is_err());
        let mut record = KegelRecord { id: "session".into(), target_reps: 15,
            reps_by_day: BTreeMap::from([("2026-10-10".into(), 14)]), completed_on: Some("2026-10-10".into()) };
        assert!(validate_history(&[record.clone()]).is_err());
        record.reps_by_day.insert("2026-10-10".into(), 15);
        assert!(validate_history(&[record.clone()]).is_ok());
        assert!(validate_history(&[record.clone(), record]).is_err());
    }
}
