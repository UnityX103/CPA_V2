use crate::{cockroach_module, video_editor_module};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use tauri::{Emitter, Manager};

#[cfg(target_os = "macos")]
#[path = "extension_packs/macos.rs"]
mod platform;
#[cfg(target_os = "windows")]
#[path = "extension_packs/windows.rs"]
mod platform;
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
#[path = "extension_packs/unsupported.rs"]
mod platform;

pub const VIDEO_CORE_ID: &str = "video.core";
pub const VIDEO_EDITOR_ID: &str = "video.editor";
pub const PET_CORE_ID: &str = "pet.core";
pub const COCKROACH_ID: &str = "pet.cockroach-invasion";

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionPackStatus {
    pub id: String,
    pub installed: bool,
    pub enabled: bool,
    pub version: Option<String>,
    pub target: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub runtime_contribution: Option<ExtensionRuntimeContribution>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionRuntimeContribution {
    pub event_contract: String,
    pub activation_phase: String,
    pub delay_ms: u64,
    pub requires_presence: bool,
    pub settings_gate: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub event_rules: Option<ExtensionEventRules>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
pub struct ExtensionEventRules {
    pub events: Vec<String>,
    pub actions: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ExtensionPackStatusChanged {
    pack_id: String,
    statuses: Vec<ExtensionPackStatus>,
}

#[derive(Debug, Clone)]
pub(crate) struct InstallState {
    pub installed: bool,
    pub version: Option<String>,
    pub target: String,
    pub message: String,
    pub runtime_contribution: Option<ExtensionRuntimeContribution>,
}

#[derive(Debug, Clone, Copy)]
enum ProtectedTransition {
    Disable,
    Uninstall,
}

pub(crate) fn replace_file_atomically(
    temporary: &std::path::Path,
    destination: &std::path::Path,
    action: &str,
) -> Result<(), String> {
    platform::replace_file_atomically(temporary, destination, action)
}

const STATE_SCHEMA_VERSION: u32 = 1;
const STATUS_CHANGED_EVENT: &str = "extension-pack-status-changed";

#[derive(Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ExtensionPackPreferences {
    schema_version: u32,
    #[serde(default)]
    enabled: HashMap<String, bool>,
}

fn state_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|path| path.join("modules").join("extension-state.json"))
        .map_err(|error| format!("无法打开扩展包状态目录：{error}"))
}

fn read_preferences(app: &tauri::AppHandle) -> Result<ExtensionPackPreferences, String> {
    let path = state_path(app)?;
    if !path.is_file() {
        return Ok(ExtensionPackPreferences {
            schema_version: STATE_SCHEMA_VERSION,
            enabled: HashMap::new(),
        });
    }
    let preferences: ExtensionPackPreferences = serde_json::from_slice(
        &fs::read(path).map_err(|error| format!("无法读取扩展包状态：{error}"))?,
    )
    .map_err(|error| format!("扩展包状态损坏：{error}"))?;
    if preferences.schema_version != STATE_SCHEMA_VERSION {
        return Err("扩展包状态版本不兼容".to_string());
    }
    Ok(preferences)
}

fn write_preferences(
    app: &tauri::AppHandle,
    preferences: &ExtensionPackPreferences,
) -> Result<(), String> {
    let path = state_path(app)?;
    let parent = path
        .parent()
        .ok_or_else(|| "扩展包状态路径缺少父目录".to_string())?;
    fs::create_dir_all(parent).map_err(|error| format!("无法创建扩展包状态目录：{error}"))?;
    let temporary = parent.join(format!(".extension-state-{}.tmp", std::process::id()));
    fs::write(
        &temporary,
        serde_json::to_vec_pretty(preferences)
            .map_err(|error| format!("无法序列化扩展包状态：{error}"))?,
    )
    .map_err(|error| format!("无法保存扩展包状态：{error}"))?;
    let result = replace_file_atomically(&temporary, &path, "激活扩展包状态");
    if result.is_err() {
        let _ = fs::remove_file(temporary);
    }
    result
}

fn status_from_install(
    id: &str,
    install: InstallState,
    preferences: &ExtensionPackPreferences,
) -> ExtensionPackStatus {
    let enabled = install.installed && preferences.enabled.get(id).copied().unwrap_or(true);
    ExtensionPackStatus {
        id: id.to_string(),
        installed: install.installed,
        enabled,
        version: install.version,
        target: install.target,
        message: install.message,
        runtime_contribution: install.runtime_contribution,
    }
}

fn statuses_internal(app: &tauri::AppHandle) -> Result<Vec<ExtensionPackStatus>, String> {
    let preferences = read_preferences(app)?;
    Ok(vec![
        status_from_install(
            VIDEO_CORE_ID,
            video_editor_module::common_pack_state(app),
            &preferences,
        ),
        status_from_install(
            VIDEO_EDITOR_ID,
            video_editor_module::feature_pack_state(app),
            &preferences,
        ),
        status_from_install(
            PET_CORE_ID,
            cockroach_module::common_pack_state(app),
            &preferences,
        ),
        status_from_install(
            COCKROACH_ID,
            cockroach_module::feature_pack_state(app),
            &preferences,
        ),
    ])
}

pub(crate) fn pack_is_enabled(app: &tauri::AppHandle, pack_id: &str) -> Result<bool, String> {
    Ok(status_for(&statuses_internal(app)?, pack_id)?.enabled)
}

fn emit_statuses(
    app: &tauri::AppHandle,
    pack_id: &str,
    statuses: Vec<ExtensionPackStatus>,
) -> Vec<ExtensionPackStatus> {
    let _ = app.emit(
        STATUS_CHANGED_EVENT,
        ExtensionPackStatusChanged {
            pack_id: pack_id.to_string(),
            statuses: statuses.clone(),
        },
    );
    statuses
}

fn status_for<'a>(
    statuses: &'a [ExtensionPackStatus],
    pack_id: &str,
) -> Result<&'a ExtensionPackStatus, String> {
    statuses
        .iter()
        .find(|status| status.id == pack_id)
        .ok_or_else(|| format!("未知扩展包：{pack_id}"))
}

fn remove_preference(preferences: &mut ExtensionPackPreferences, pack_id: &str) {
    preferences.enabled.remove(pack_id);
}

#[tauri::command]
pub fn extension_pack_statuses(app: tauri::AppHandle) -> Result<Vec<ExtensionPackStatus>, String> {
    statuses_internal(&app)
}

#[tauri::command]
pub async fn install_extension_pack(
    app: tauri::AppHandle,
    video_state: tauri::State<'_, video_editor_module::VideoEditorModuleState>,
    cockroach_state: tauri::State<'_, cockroach_module::CockroachModuleState>,
    pack_id: String,
) -> Result<Vec<ExtensionPackStatus>, String> {
    let before = statuses_internal(&app)?;
    status_for(&before, &pack_id)?;
    match pack_id.as_str() {
        VIDEO_CORE_ID if status_for(&before, VIDEO_EDITOR_ID)?.installed => {
            video_editor_module::download_video_editor_module(app.clone(), video_state).await?;
        }
        VIDEO_CORE_ID => video_editor_module::install_common_pack(&app, &video_state).await?,
        VIDEO_EDITOR_ID => {
            video_editor_module::download_video_editor_module(app.clone(), video_state).await?;
        }
        PET_CORE_ID if status_for(&before, COCKROACH_ID)?.installed => {
            cockroach_module::download_cockroach_module(app.clone(), cockroach_state).await?;
        }
        PET_CORE_ID => cockroach_module::install_common_pack(&app).await?,
        COCKROACH_ID => {
            cockroach_module::download_cockroach_module(app.clone(), cockroach_state).await?;
        }
        _ => unreachable!("pack id validated above"),
    }

    let mut preferences = read_preferences(&app)?;
    if !status_for(&before, &pack_id)?.installed {
        preferences.enabled.insert(pack_id.clone(), true);
    }
    if pack_id == VIDEO_EDITOR_ID && !status_for(&before, VIDEO_EDITOR_ID)?.installed {
        preferences.enabled.insert(VIDEO_CORE_ID.to_string(), true);
    }
    if pack_id == COCKROACH_ID && !status_for(&before, COCKROACH_ID)?.installed {
        preferences.enabled.insert(PET_CORE_ID.to_string(), true);
    }
    write_preferences(&app, &preferences)?;
    Ok(emit_statuses(&app, &pack_id, statuses_internal(&app)?))
}

#[tauri::command]
pub fn set_extension_pack_enabled(
    app: tauri::AppHandle,
    video_state: tauri::State<'_, video_editor_module::VideoEditorModuleState>,
    cockroach_state: tauri::State<'_, cockroach_module::CockroachModuleState>,
    pack_id: String,
    enabled: bool,
) -> Result<Vec<ExtensionPackStatus>, String> {
    let statuses = statuses_internal(&app)?;
    let current = status_for(&statuses, &pack_id)?;
    if !current.installed {
        return Err("请先安装扩展包".to_string());
    }
    if !enabled {
        validate_transition(&pack_id, ProtectedTransition::Disable, &statuses)?;
    }
    let mut preferences = read_preferences(&app)?;
    preferences.enabled.insert(pack_id.clone(), enabled);
    if enabled && pack_id == VIDEO_EDITOR_ID {
        if !status_for(&statuses, VIDEO_CORE_ID)?.installed {
            return Err("视频通用包缺失，请先重新安装视频编辑功能包".to_string());
        }
        preferences.enabled.insert(VIDEO_CORE_ID.to_string(), true);
    }
    if enabled && pack_id == COCKROACH_ID {
        if !status_for(&statuses, PET_CORE_ID)?.installed {
            return Err("宠物通用包缺失，请先重新安装蟑螂入侵功能包".to_string());
        }
        preferences.enabled.insert(PET_CORE_ID.to_string(), true);
    }
    if !enabled && pack_id == VIDEO_EDITOR_ID {
        video_editor_module::stop_feature(&app, &video_state)?;
    }
    if !enabled && pack_id == COCKROACH_ID {
        cockroach_module::stop_feature(&app, &cockroach_state)?;
    }
    write_preferences(&app, &preferences)?;
    Ok(emit_statuses(&app, &pack_id, statuses_internal(&app)?))
}

#[tauri::command]
pub fn uninstall_extension_pack(
    app: tauri::AppHandle,
    video_state: tauri::State<'_, video_editor_module::VideoEditorModuleState>,
    cockroach_state: tauri::State<'_, cockroach_module::CockroachModuleState>,
    pack_id: String,
) -> Result<Vec<ExtensionPackStatus>, String> {
    let statuses = statuses_internal(&app)?;
    status_for(&statuses, &pack_id)?;
    validate_transition(&pack_id, ProtectedTransition::Uninstall, &statuses)?;
    match pack_id.as_str() {
        VIDEO_CORE_ID => video_editor_module::uninstall_common_pack(&app)?,
        VIDEO_EDITOR_ID => video_editor_module::uninstall_feature_pack(&app, &video_state)?,
        PET_CORE_ID => cockroach_module::uninstall_common_pack(&app)?,
        COCKROACH_ID => cockroach_module::uninstall_feature_pack(&app, &cockroach_state)?,
        _ => unreachable!("pack id validated above"),
    }
    let mut preferences = read_preferences(&app)?;
    remove_preference(&mut preferences, &pack_id);
    write_preferences(&app, &preferences)?;
    Ok(emit_statuses(&app, &pack_id, statuses_internal(&app)?))
}

#[tauri::command]
pub fn set_extension_pack_active(
    app: tauri::AppHandle,
    cockroach_state: tauri::State<'_, cockroach_module::CockroachModuleState>,
    pack_id: String,
    active: bool,
) -> Result<(), String> {
    match pack_id.as_str() {
        COCKROACH_ID if active => {
            cockroach_module::launch_cockroach_module(app, cockroach_state, None)?;
            Ok(())
        }
        COCKROACH_ID => cockroach_module::stop_feature(&app, &cockroach_state),
        _ => Err(format!("扩展包不支持活动状态控制：{pack_id}")),
    }
}

#[tauri::command]
pub async fn execute_extension_pack_action(
    app: tauri::AppHandle,
    pack_id: String,
    action: cockroach_module::automation::CockroachAction,
) -> Result<(), String> {
    if pack_id != COCKROACH_ID { return Err("扩展包不支持此操作".into()); }
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<cockroach_module::CockroachModuleState>();
        cockroach_module::automation::execute_action(&app, &state, action)
    }).await.map_err(|error| error.to_string())?
}

fn dependent_id(pack_id: &str) -> Option<&'static str> {
    match pack_id {
        VIDEO_CORE_ID => Some(VIDEO_EDITOR_ID),
        PET_CORE_ID => Some(COCKROACH_ID),
        _ => None,
    }
}

fn validate_transition(
    pack_id: &str,
    operation: ProtectedTransition,
    statuses: &[ExtensionPackStatus],
) -> Result<(), String> {
    let Some(dependent_id) = dependent_id(pack_id) else {
        return Ok(());
    };
    let dependent = statuses.iter().find(|status| status.id == dependent_id);
    let blocked = match operation {
        ProtectedTransition::Disable => {
            dependent.is_some_and(|status| status.installed && status.enabled)
        }
        ProtectedTransition::Uninstall => dependent.is_some_and(|status| status.installed),
    };
    if blocked {
        return Err(format!(
            "{} 仍依赖此通用包，请先{}功能包",
            dependent_id,
            match operation {
                ProtectedTransition::Disable => "禁用",
                ProtectedTransition::Uninstall => "卸载",
            }
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        validate_transition, ExtensionPackStatus, ProtectedTransition, COCKROACH_ID, PET_CORE_ID,
        VIDEO_CORE_ID, VIDEO_EDITOR_ID,
    };

    fn status(id: &str, installed: bool, enabled: bool) -> ExtensionPackStatus {
        ExtensionPackStatus {
            id: id.to_string(),
            installed,
            enabled,
            version: installed.then(|| "1.0.0".to_string()),
            target: "macos-arm64".to_string(),
            message: String::new(),
            runtime_contribution: None,
        }
    }

    #[test]
    fn common_pack_transitions_are_guarded_by_feature_dependents() {
        let statuses = vec![
            status(VIDEO_CORE_ID, true, true),
            status(VIDEO_EDITOR_ID, true, true),
            status(PET_CORE_ID, true, true),
            status(COCKROACH_ID, true, false),
        ];

        assert!(
            validate_transition(VIDEO_CORE_ID, ProtectedTransition::Disable, &statuses).is_err()
        );
        assert!(validate_transition(PET_CORE_ID, ProtectedTransition::Disable, &statuses).is_ok());
        assert!(
            validate_transition(PET_CORE_ID, ProtectedTransition::Uninstall, &statuses).is_err()
        );
    }
}
