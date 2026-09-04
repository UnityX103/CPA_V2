use crate::extension_packs::{
    pack_is_enabled, replace_file_atomically, InstallState, VIDEO_EDITOR_ID,
};
use futures_util::StreamExt;
use minisign_verify::{PublicKey, Signature};
use rand::distr::{Alphanumeric, SampleString};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::webview::DownloadEvent;
use tauri::{Emitter, Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_dialog::DialogExt;
use tokio::io::AsyncWriteExt;
use zip::ZipArchive;

const LEGACY_INDEX_SCHEMA_VERSION: u32 = 1;
const LAYERED_INDEX_SCHEMA_VERSION: u32 = 2;
const MODULE_CONTRACT_JSON: &str =
    include_str!("../../../video-editor-module/module-contract.json");
const DEFAULT_INDEX_URLS: [&str; 2] = [
    "https://cnb.cool/nanzhaigame-xpy/CPA_V2/-/releases/latest/download/video-editor-module-index.json",
    "https://github.com/UnityX103/CPA_V2/releases/latest/download/video-editor-module-index.json",
];
const MODULE_PROGRESS_EVENT: &str = "video-editor-module-progress";
const MAX_ARCHIVE_BYTES: u64 = 8 * 1024 * 1024 * 1024;
const MAX_EXTRACTED_BYTES: u64 = 16 * 1024 * 1024 * 1024;
const MAX_ARCHIVE_FILES: usize = 100_000;
const MAX_INDEX_BYTES: usize = 1024 * 1024;
const MAX_SIGNATURE_BYTES: usize = 16 * 1024;

#[derive(Default)]
pub struct VideoEditorModuleState {
    child: Mutex<Option<Child>>,
    update_in_progress: Mutex<bool>,
}

struct ModuleUpdatePermit<'a>(&'a VideoEditorModuleState);

impl Drop for ModuleUpdatePermit<'_> {
    fn drop(&mut self) {
        if let Ok(mut updating) = self.0.update_in_progress.lock() {
            *updating = false;
        }
    }
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct VideoEditorModuleStatus {
    installed: bool,
    version: Option<String>,
    target: String,
    message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ModuleProgress {
    stage: String,
    downloaded_bytes: u64,
    total_bytes: Option<u64>,
    message: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LegacyModuleIndex {
    schema_version: u32,
    version: String,
    #[serde(default)]
    debug_only: bool,
    packages: HashMap<String, ModulePackage>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LayeredModuleIndex {
    schema_version: u32,
    version: String,
    #[serde(default)]
    debug_only: bool,
    logic: ComponentPackage,
    models: ComponentPackage,
    engines: HashMap<String, ComponentPackage>,
}

#[derive(Debug)]
enum ModuleIndexDocument {
    Legacy(LegacyModuleIndex),
    Layered(Box<LayeredModuleIndex>),
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ModulePackage {
    url: String,
    #[serde(default)]
    mirrors: Vec<String>,
    sha256: String,
    size: u64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ComponentPackage {
    version: String,
    manifest_sha256: String,
    #[serde(default)]
    engine_abi: Option<String>,
    #[serde(default)]
    model_set: Option<String>,
    #[serde(flatten)]
    package: ModulePackage,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct InstalledPointer {
    version: String,
    target: String,
    directory: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ModuleManifest {
    schema_version: u32,
    id: String,
    version: String,
    target: String,
    entry: String,
    capabilities: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct InstalledComponentPointer {
    version: String,
    directory: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct LayeredInstalledPointer {
    schema_version: u32,
    version: String,
    target: String,
    engine: InstalledComponentPointer,
    models: InstalledComponentPointer,
    logic: InstalledComponentPointer,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct VideoCorePointer {
    schema_version: u32,
    target: String,
    engine: InstalledComponentPointer,
    models: InstalledComponentPointer,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct EngineManifest {
    schema_version: u32,
    #[serde(rename = "type")]
    component_type: String,
    version: String,
    target: String,
    engine_abi: String,
    entry: String,
    runtime_root: String,
    files: Vec<ComponentFile>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ModelsManifest {
    schema_version: u32,
    #[serde(rename = "type")]
    component_type: String,
    version: String,
    model_set: String,
    model_root: String,
    files: Vec<ComponentFile>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LogicManifest {
    schema_version: u32,
    #[serde(rename = "type")]
    component_type: String,
    id: String,
    version: String,
    engine_abi: String,
    model_set: String,
    module_root: String,
    capabilities: Vec<String>,
    files: Vec<ComponentFile>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ComponentFile {
    path: String,
    size: u64,
    sha256: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct InstalledArtifact {
    schema_version: u32,
    sha256: String,
    size: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ResolvedVideoEditorModule {
    version: String,
    target: String,
    engine_version: String,
    models_version: String,
    entry: PathBuf,
    working_directory: PathBuf,
    arguments: Vec<String>,
    environment: HashMap<String, String>,
    runtime_root: PathBuf,
}

#[derive(Debug, Clone, Copy)]
enum LayeredComponentKind {
    Engine,
    Models,
    Logic,
}

impl LayeredComponentKind {
    fn label(self) -> &'static str {
        match self {
            Self::Engine => "引擎",
            Self::Models => "模型",
            Self::Logic => "业务",
        }
    }

    fn directory(
        self,
        version: &str,
        target: &str,
        artifact_sha256: &str,
    ) -> Result<String, String> {
        validate_sha256_text(artifact_sha256)?;
        let artifact = &artifact_sha256[..16];
        Ok(match self {
            Self::Engine => format!("engines/{version}-{target}-{artifact}"),
            Self::Models => format!("models/{version}-{artifact}"),
            Self::Logic => format!("logic/{version}-{artifact}"),
        })
    }

    fn manifest_name(self) -> &'static str {
        match self {
            Self::Engine => "engine.json",
            Self::Models => "models.json",
            Self::Logic => "module.json",
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ModuleContract {
    schema_version: u32,
    id: String,
    capabilities: Vec<String>,
}

fn module_contract() -> Result<ModuleContract, String> {
    serde_json::from_str(MODULE_CONTRACT_JSON)
        .map_err(|error| format!("视频编辑模块能力合同无效：{error}"))
}

fn parse_module_index(bytes: &[u8]) -> Result<ModuleIndexDocument, String> {
    let value: serde_json::Value = serde_json::from_slice(bytes)
        .map_err(|error| format!("无法解析视频编辑模块清单：{error}"))?;
    match value
        .get("schemaVersion")
        .and_then(serde_json::Value::as_u64)
    {
        Some(version) if version == LEGACY_INDEX_SCHEMA_VERSION as u64 => {
            serde_json::from_value(value)
                .map(ModuleIndexDocument::Legacy)
                .map_err(|error| format!("无法解析旧版视频编辑模块清单：{error}"))
        }
        Some(version) if version == LAYERED_INDEX_SCHEMA_VERSION as u64 => {
            serde_json::from_value(value)
                .map(Box::new)
                .map(ModuleIndexDocument::Layered)
                .map_err(|error| format!("无法解析分层视频编辑模块清单：{error}"))
        }
        _ => Err("视频编辑模块索引版本不兼容".to_string()),
    }
}

fn runtime_target() -> &'static str {
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    {
        "macos-arm64"
    }
    #[cfg(all(target_os = "macos", target_arch = "x86_64"))]
    {
        "macos-x86_64"
    }
    #[cfg(all(target_os = "windows", target_arch = "x86_64"))]
    {
        "windows-x86_64"
    }
    #[cfg(not(any(
        all(target_os = "macos", target_arch = "aarch64"),
        all(target_os = "macos", target_arch = "x86_64"),
        all(target_os = "windows", target_arch = "x86_64")
    )))]
    {
        "unsupported"
    }
}

fn index_urls() -> Vec<String> {
    #[cfg(debug_assertions)]
    if let Ok(url) = std::env::var("CPA_VIDEO_EDITOR_MODULE_INDEX_URL") {
        if !url.trim().is_empty() {
            return vec![url];
        }
    }
    if let Some(url) = option_env!("CPA_VIDEO_EDITOR_MODULE_INDEX_URL") {
        return vec![url.to_string()];
    }
    DEFAULT_INDEX_URLS
        .iter()
        .map(|url| (*url).to_string())
        .collect()
}

fn module_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|path| path.join("modules").join("video-editor"))
        .map_err(|error| format!("无法打开视频编辑模块目录：{error}"))
}

fn video_editor_download_filename(
    url: &tauri::Url,
    expected_port: u16,
    expected_token: &str,
) -> Option<String> {
    if url.scheme() != "http"
        || url.host_str() != Some("127.0.0.1")
        || url.port() != Some(expected_port)
    {
        return None;
    }
    let job_id = url
        .query_pairs()
        .find_map(|(key, value)| (key == "id").then(|| value.into_owned()))?;
    let token = url
        .query_pairs()
        .find_map(|(key, value)| (key == "token").then(|| value.into_owned()))?;
    if token != expected_token
        || job_id.len() != 32
        || !job_id.bytes().all(|byte| byte.is_ascii_hexdigit())
    {
        return None;
    }
    match url.path() {
        "/api/output" => Some(format!("pet-transparent-{job_id}.webm")),
        "/api/preview" => {
            if !url
                .query_pairs()
                .any(|(key, value)| key == "download" && value == "1")
            {
                return None;
            }
            #[cfg(target_os = "macos")]
            let extension = "mov";
            #[cfg(not(target_os = "macos"))]
            let extension = "webm";
            Some(format!("pet-transparent-preview-{job_id}.{extension}"))
        }
        _ => None,
    }
}

async fn download_video_editor_file(url: tauri::Url, destination: &Path) -> Result<(), String> {
    let response = reqwest::Client::new()
        .get(url.as_str())
        .send()
        .await
        .map_err(|error| format!("下载请求失败：{error}"))?;
    if !response.status().is_success() {
        return Err(format!("下载请求失败：HTTP {}", response.status()));
    }
    let parent = destination
        .parent()
        .ok_or_else(|| "保存路径缺少父目录".to_string())?;
    let file_name = destination
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "保存文件名无效".to_string())?;
    let temporary = parent.join(format!(
        ".{file_name}.{}.{}.part",
        std::process::id(),
        Alphanumeric.sample_string(&mut rand::rng(), 12)
    ));
    let result = async {
        let mut file = tokio::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)
            .await
            .map_err(|error| format!("无法创建临时保存文件：{error}"))?;
        let mut stream = response.bytes_stream();
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|error| format!("下载数据失败：{error}"))?;
            file.write_all(&chunk)
                .await
                .map_err(|error| format!("写入保存文件失败：{error}"))?;
        }
        file.flush()
            .await
            .map_err(|error| format!("保存文件失败：{error}"))?;
        file.sync_all()
            .await
            .map_err(|error| format!("同步保存文件失败：{error}"))?;
        drop(file);
        replace_file_atomically(&temporary, destination, "保存视频")
    }
    .await;
    if result.is_err() {
        let _ = tokio::fs::remove_file(&temporary).await;
    }
    result
}

fn request_video_editor_download(app: tauri::AppHandle, url: tauri::Url, file_name: String) {
    let mut dialog = app
        .dialog()
        .file()
        .set_title("保存视频")
        .set_file_name(&file_name);
    if file_name.ends_with(".webm") {
        dialog = dialog.add_filter("WebM 视频", &["webm"]);
    } else if file_name.ends_with(".mov") {
        dialog = dialog.add_filter("QuickTime 视频", &["mov"]);
    }
    if let Some(window) = app.get_webview_window("video-editor-module") {
        dialog = dialog.set_parent(&window);
    }
    dialog.save_file(move |selection| {
        let Ok(destination) = selection
            .ok_or(())
            .and_then(|path| path.into_path().map_err(|_| ()))
        else {
            return;
        };
        let app_for_result = app.clone();
        tauri::async_runtime::spawn(async move {
            if let Err(error) = download_video_editor_file(url, &destination).await {
                app_for_result
                    .dialog()
                    .message(format!("视频保存失败：{error}"))
                    .show(|_| {});
            }
        });
    });
}

fn pointer_path(root: &Path) -> PathBuf {
    root.join("current.json")
}

fn core_pointer_path(root: &Path) -> PathBuf {
    root.join("core.json")
}

fn write_core_pointer(root: &Path, core: &VideoCorePointer) -> Result<(), String> {
    fs::create_dir_all(root).map_err(|error| format!("无法创建视频通用包目录：{error}"))?;
    let temporary = root.join(format!(".core-{}.tmp", std::process::id()));
    let result = (|| {
        fs::write(
            &temporary,
            serde_json::to_vec_pretty(core)
                .map_err(|error| format!("无法序列化视频通用包状态：{error}"))?,
        )
        .map_err(|error| format!("无法保存视频通用包状态：{error}"))?;
        replace_file_atomically(&temporary, &core_pointer_path(root), "激活视频通用包")
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

fn core_pointer_from_feature(pointer: &LayeredInstalledPointer) -> VideoCorePointer {
    VideoCorePointer {
        schema_version: 1,
        target: pointer.target.clone(),
        engine: pointer.engine.clone(),
        models: pointer.models.clone(),
    }
}

fn split_layered_feature_installation(
    root: &Path,
    pointer: &LayeredInstalledPointer,
) -> Result<(), String> {
    safe_relative_path(&pointer.engine.directory)?;
    safe_relative_path(&pointer.models.directory)?;
    safe_relative_path(&pointer.logic.directory)?;
    write_core_pointer(root, &core_pointer_from_feature(pointer))?;
    let logic_root = root.join("logic");
    if logic_root.exists() {
        fs::remove_dir_all(&logic_root)
            .map_err(|error| format!("无法删除视频编辑业务包：{error}"))?;
    }
    let current = pointer_path(root);
    if current.exists() {
        fs::remove_file(current).map_err(|error| format!("无法移除视频编辑状态：{error}"))?;
    }
    Ok(())
}

fn resolve_video_core(root: &Path) -> Result<Option<VideoCorePointer>, String> {
    let path = core_pointer_path(root);
    let core = if path.is_file() {
        let bytes = fs::read(&path).map_err(|error| format!("无法读取视频通用包状态：{error}"))?;
        serde_json::from_slice::<VideoCorePointer>(&bytes)
            .map_err(|error| format!("视频通用包状态损坏：{error}"))?
    } else {
        let current = pointer_path(root);
        if !current.is_file() {
            return Ok(None);
        }
        let value: serde_json::Value = serde_json::from_slice(
            &fs::read(&current).map_err(|error| format!("无法读取视频编辑模块状态：{error}"))?,
        )
        .map_err(|error| format!("视频编辑模块状态损坏：{error}"))?;
        if value
            .get("schemaVersion")
            .and_then(serde_json::Value::as_u64)
            != Some(LAYERED_INDEX_SCHEMA_VERSION as u64)
        {
            return Ok(None);
        }
        let pointer: LayeredInstalledPointer = serde_json::from_value(value)
            .map_err(|error| format!("分层视频编辑模块状态损坏：{error}"))?;
        resolve_layered_module(root, pointer.clone())?;
        core_pointer_from_feature(&pointer)
    };
    if core.schema_version != 1 || core.target != runtime_target() {
        return Err("视频通用包状态版本或平台不兼容".to_string());
    }
    let engine_directory = resolve_component_directory(
        root,
        &core.engine,
        LayeredComponentKind::Engine,
        &core.target,
    )?;
    let models_directory = resolve_component_directory(
        root,
        &core.models,
        LayeredComponentKind::Models,
        &core.target,
    )?;
    validate_layered_component_directory(
        &engine_directory,
        LayeredComponentKind::Engine,
        &core.engine.version,
        &core.target,
        None,
        true,
    )?;
    validate_layered_component_directory(
        &models_directory,
        LayeredComponentKind::Models,
        &core.models.version,
        &core.target,
        None,
        true,
    )?;
    Ok(Some(core))
}

pub(crate) fn feature_pack_state(app: &tauri::AppHandle) -> InstallState {
    let target = runtime_target().to_string();
    match module_root(app).and_then(|root| resolve_installed_module(&root)) {
        Ok(Some(resolved)) => InstallState {
            installed: true,
            version: Some(resolved.version),
            target,
            message: "视频编辑功能包已安装".to_string(),
            runtime_contribution: None,
        },
        Ok(None) => InstallState {
            installed: false,
            version: None,
            target,
            message: "视频编辑功能包尚未安装".to_string(),
            runtime_contribution: None,
        },
        Err(error) => InstallState {
            installed: false,
            version: None,
            target,
            message: error,
            runtime_contribution: None,
        },
    }
}

pub(crate) fn common_pack_state(app: &tauri::AppHandle) -> InstallState {
    let target = runtime_target().to_string();
    let state = module_root(app).and_then(|root| {
        if let Some(core) = resolve_video_core(&root)? {
            return Ok(Some(format!(
                "engine {} + models {}",
                core.engine.version, core.models.version
            )));
        }
        let legacy = read_installed_manifest(&root)?;
        Ok(legacy.map(|(pointer, _)| pointer.version))
    });
    match state {
        Ok(Some(version)) => InstallState {
            installed: true,
            version: Some(version),
            target,
            message: "视频通用包已安装".to_string(),
            runtime_contribution: None,
        },
        Ok(None) => InstallState {
            installed: false,
            version: None,
            target,
            message: "视频通用包尚未安装".to_string(),
            runtime_contribution: None,
        },
        Err(error) => InstallState {
            installed: false,
            version: None,
            target,
            message: error,
            runtime_contribution: None,
        },
    }
}

fn read_pointer(root: &Path) -> Result<Option<InstalledPointer>, String> {
    let path = pointer_path(root);
    if !path.is_file() {
        return Ok(None);
    }
    let bytes = fs::read(&path).map_err(|error| format!("无法读取视频编辑模块状态：{error}"))?;
    let pointer: InstalledPointer =
        serde_json::from_slice(&bytes).map_err(|error| format!("视频编辑模块状态损坏：{error}"))?;
    Ok(Some(pointer))
}

fn read_installed_manifest(
    root: &Path,
) -> Result<Option<(InstalledPointer, ModuleManifest)>, String> {
    let Some(pointer) = read_pointer(root)? else {
        return Ok(None);
    };
    validate_release_version(&pointer.version)?;
    if pointer.target != runtime_target() {
        return Err("已安装视频编辑模块与当前平台不匹配，请重新下载".to_string());
    }
    let expected_directory = format!("{}-{}", pointer.version, pointer.target);
    if pointer.directory != expected_directory {
        return Err("已安装视频编辑模块目录无效，请重新下载".to_string());
    }
    let directory = root.join(safe_relative_path(&pointer.directory)?);
    let manifest_path = directory.join("module.json");
    if !manifest_path.is_file() {
        return Err("视频编辑模块清单缺失，请重新下载".to_string());
    }
    let manifest: ModuleManifest = serde_json::from_slice(
        &fs::read(&manifest_path).map_err(|error| format!("无法读取视频编辑模块清单：{error}"))?,
    )
    .map_err(|error| format!("视频编辑模块清单损坏：{error}"))?;
    validate_manifest(&manifest, &pointer.version, runtime_target())?;
    let entry = safe_relative_path(&manifest.entry)?;
    if !directory.join(entry).is_file() {
        return Err("视频编辑模块启动文件缺失，请重新下载".to_string());
    }
    ensure_runtime_executables(&directory, &manifest)?;
    Ok(Some((pointer, manifest)))
}

fn resolve_installed_module(root: &Path) -> Result<Option<ResolvedVideoEditorModule>, String> {
    let path = pointer_path(root);
    if !path.is_file() {
        return Ok(None);
    }
    let bytes = fs::read(&path).map_err(|error| format!("无法读取视频编辑模块状态：{error}"))?;
    let value: serde_json::Value =
        serde_json::from_slice(&bytes).map_err(|error| format!("视频编辑模块状态损坏：{error}"))?;
    if value
        .get("schemaVersion")
        .and_then(serde_json::Value::as_u64)
        == Some(LAYERED_INDEX_SCHEMA_VERSION as u64)
    {
        let pointer: LayeredInstalledPointer = serde_json::from_value(value)
            .map_err(|error| format!("分层视频编辑模块状态损坏：{error}"))?;
        return resolve_layered_module(root, pointer).map(Some);
    }

    let Some((pointer, manifest)) = read_installed_manifest(root)? else {
        return Ok(None);
    };
    let working_directory = root.join(safe_relative_path(&pointer.directory)?);
    let entry = working_directory.join(safe_relative_path(&manifest.entry)?);
    Ok(Some(ResolvedVideoEditorModule {
        engine_version: pointer.version.clone(),
        models_version: pointer.version.clone(),
        version: pointer.version,
        target: pointer.target,
        entry,
        runtime_root: working_directory.join("runtime"),
        working_directory,
        arguments: Vec::new(),
        environment: HashMap::new(),
    }))
}

fn resolve_layered_module(
    root: &Path,
    pointer: LayeredInstalledPointer,
) -> Result<ResolvedVideoEditorModule, String> {
    if pointer.schema_version != LAYERED_INDEX_SCHEMA_VERSION {
        return Err("分层视频编辑模块状态版本不兼容".to_string());
    }
    validate_release_version(&pointer.version)?;
    if pointer.target != runtime_target() {
        return Err("已安装视频编辑模块与当前平台不匹配，请重新下载".to_string());
    }
    for version in [
        &pointer.engine.version,
        &pointer.models.version,
        &pointer.logic.version,
    ] {
        validate_release_version(version)?;
    }
    if pointer.version != pointer.logic.version {
        return Err("分层视频编辑模块业务版本不一致".to_string());
    }
    let engine_directory = resolve_component_directory(
        root,
        &pointer.engine,
        LayeredComponentKind::Engine,
        &pointer.target,
    )?;
    let models_directory = resolve_component_directory(
        root,
        &pointer.models,
        LayeredComponentKind::Models,
        &pointer.target,
    )?;
    let logic_directory = resolve_component_directory(
        root,
        &pointer.logic,
        LayeredComponentKind::Logic,
        &pointer.target,
    )?;
    let engine: EngineManifest = read_json_manifest(&engine_directory.join("engine.json"), "引擎")?;
    let models: ModelsManifest = read_json_manifest(&models_directory.join("models.json"), "模型")?;
    let logic: LogicManifest = read_json_manifest(&logic_directory.join("module.json"), "业务")?;
    validate_layered_manifests(&pointer, &engine, &models, &logic)?;

    let entry = join_relative(&engine_directory, &engine.entry)?;
    let runtime_root = join_relative(&engine_directory, &engine.runtime_root)?;
    let model_root = join_relative(&models_directory, &models.model_root)?;
    let module_root = join_relative(&logic_directory, &logic.module_root)?;
    if !entry.is_file() || !runtime_root.is_dir() || !model_root.is_dir() || !module_root.is_dir() {
        return Err("分层视频编辑模块文件不完整，请重新下载".to_string());
    }
    ensure_executable_paths(&entry, &runtime_root)?;
    let mut environment = HashMap::new();
    environment.insert(
        "CPA_VIDEO_EDITOR_RUNTIME_ROOT".to_string(),
        runtime_root.to_string_lossy().into_owned(),
    );
    environment.insert(
        "CPA_VIDEO_EDITOR_MODEL_ROOT".to_string(),
        model_root.to_string_lossy().into_owned(),
    );
    Ok(ResolvedVideoEditorModule {
        version: pointer.version,
        target: pointer.target,
        engine_version: pointer.engine.version,
        models_version: pointer.models.version,
        entry,
        working_directory: engine_directory,
        arguments: vec![
            "--logic-root".to_string(),
            module_root.to_string_lossy().into_owned(),
        ],
        environment,
        runtime_root,
    })
}

fn resolve_component_directory(
    root: &Path,
    pointer: &InstalledComponentPointer,
    kind: LayeredComponentKind,
    target: &str,
) -> Result<PathBuf, String> {
    let directory = root.join(safe_relative_path(&pointer.directory)?);
    let artifact: InstalledArtifact =
        read_json_manifest(&directory.join(".artifact.json"), "来源")?;
    if artifact.schema_version != 1 || artifact.size == 0 {
        return Err("已安装视频编辑组件来源无效".to_string());
    }
    let expected = kind.directory(&pointer.version, target, &artifact.sha256)?;
    if pointer.directory != expected {
        return Err("分层视频编辑模块目录与组件哈希不匹配".to_string());
    }
    Ok(directory)
}

fn read_json_manifest<T: for<'de> Deserialize<'de>>(path: &Path, label: &str) -> Result<T, String> {
    let bytes = fs::read(path).map_err(|error| format!("视频编辑模块{label}清单缺失：{error}"))?;
    serde_json::from_slice(&bytes).map_err(|error| format!("视频编辑模块{label}清单损坏：{error}"))
}

fn validate_layered_manifests(
    pointer: &LayeredInstalledPointer,
    engine: &EngineManifest,
    models: &ModelsManifest,
    logic: &LogicManifest,
) -> Result<(), String> {
    if engine.schema_version != 1
        || models.schema_version != 1
        || logic.schema_version != LAYERED_INDEX_SCHEMA_VERSION
        || engine.component_type != "engine"
        || models.component_type != "models"
        || logic.component_type != "logic"
    {
        return Err("分层视频编辑模块清单版本不兼容".to_string());
    }
    if engine.version != pointer.engine.version
        || models.version != pointer.models.version
        || logic.version != pointer.logic.version
        || engine.target != pointer.target
    {
        return Err("分层视频编辑模块组件版本或平台不匹配".to_string());
    }
    if logic.engine_abi != engine.engine_abi || logic.model_set != models.model_set {
        return Err("视频编辑模块业务、引擎与模型不兼容".to_string());
    }
    let contract = module_contract()?;
    if logic.id != contract.id
        || contract
            .capabilities
            .iter()
            .any(|capability| !logic.capabilities.iter().any(|value| value == capability))
    {
        return Err("视频编辑模块业务包缺少必需能力".to_string());
    }
    safe_relative_path(&engine.entry)?;
    safe_relative_path(&engine.runtime_root)?;
    safe_relative_path(&models.model_root)?;
    safe_relative_path(&logic.module_root)?;
    Ok(())
}

fn activate_layered_installation(
    root: &Path,
    index: &LayeredModuleIndex,
    target: &str,
) -> Result<(), String> {
    if index.schema_version != LAYERED_INDEX_SCHEMA_VERSION {
        return Err("分层视频编辑模块索引版本不兼容".to_string());
    }
    validate_release_version(&index.version)?;
    validate_release_version(&index.logic.version)?;
    validate_release_version(&index.models.version)?;
    if index.version != index.logic.version {
        return Err("分层视频编辑模块索引业务版本不一致".to_string());
    }
    let engine = index
        .engines
        .get(target)
        .ok_or_else(|| format!("当前发布尚未提供 {target} 视频编辑引擎"))?;
    validate_layered_index_compatibility(&index.logic, &index.models, engine)?;
    validate_release_version(&engine.version)?;
    let pointer = LayeredInstalledPointer {
        schema_version: LAYERED_INDEX_SCHEMA_VERSION,
        version: index.version.clone(),
        target: target.to_string(),
        engine: InstalledComponentPointer {
            version: engine.version.clone(),
            directory: LayeredComponentKind::Engine.directory(
                &engine.version,
                target,
                &engine.package.sha256,
            )?,
        },
        models: InstalledComponentPointer {
            version: index.models.version.clone(),
            directory: LayeredComponentKind::Models.directory(
                &index.models.version,
                target,
                &index.models.package.sha256,
            )?,
        },
        logic: InstalledComponentPointer {
            version: index.logic.version.clone(),
            directory: LayeredComponentKind::Logic.directory(
                &index.logic.version,
                target,
                &index.logic.package.sha256,
            )?,
        },
    };
    resolve_layered_module(root, pointer.clone())?;
    let bytes = serde_json::to_vec_pretty(&pointer)
        .map_err(|error| format!("无法序列化模块状态：{error}"))?;
    write_pointer_atomically(root, &bytes)
}

fn write_pointer_atomically(root: &Path, bytes: &[u8]) -> Result<(), String> {
    fs::create_dir_all(root).map_err(|error| format!("无法创建视频编辑模块目录：{error}"))?;
    let temporary = root.join(format!(".current-{}.tmp", std::process::id()));
    let result = (|| {
        let mut file =
            fs::File::create(&temporary).map_err(|error| format!("无法保存模块状态：{error}"))?;
        file.write_all(bytes)
            .map_err(|error| format!("无法保存模块状态：{error}"))?;
        file.sync_all()
            .map_err(|error| format!("无法同步模块状态：{error}"))?;
        drop(file);
        replace_file_atomically(&temporary, &pointer_path(root), "激活视频编辑模块")
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

fn validate_manifest(
    manifest: &ModuleManifest,
    expected_version: &str,
    expected_target: &str,
) -> Result<(), String> {
    let contract = module_contract()?;
    if manifest.schema_version != contract.schema_version {
        return Err("视频编辑模块清单版本不兼容".to_string());
    }
    if manifest.id != contract.id {
        return Err("下载包不是 CPA 视频编辑模块".to_string());
    }
    if manifest.version != expected_version || manifest.target != expected_target {
        return Err("视频编辑模块版本或平台与当前安装包不匹配".to_string());
    }
    if contract.capabilities.iter().any(|capability| {
        !manifest
            .capabilities
            .iter()
            .any(|value| value == capability)
    }) {
        return Err("视频编辑模块缺少必需能力".to_string());
    }
    safe_relative_path(&manifest.entry)?;
    Ok(())
}

fn safe_relative_path(value: &str) -> Result<PathBuf, String> {
    let path = Path::new(value);
    if path.is_absolute()
        || path.components().any(|component| {
            matches!(
                component,
                std::path::Component::ParentDir
                    | std::path::Component::RootDir
                    | std::path::Component::Prefix(_)
            )
        })
    {
        return Err("视频编辑模块包含不安全路径".to_string());
    }
    Ok(path.to_path_buf())
}

fn join_relative(base: &Path, value: &str) -> Result<PathBuf, String> {
    let relative = safe_relative_path(value)?;
    if relative == Path::new(".") {
        return Ok(base.to_path_buf());
    }
    Ok(base.join(relative))
}

fn validate_package_url(value: &str) -> Result<(), String> {
    let url = reqwest::Url::parse(value).map_err(|_| "视频编辑模块下载地址无效".to_string())?;
    let github = url.host_str() == Some("github.com")
        && url
            .path()
            .starts_with("/UnityX103/CPA_V2/releases/download/");
    let cnb = url.host_str() == Some("cnb.cool")
        && url
            .path()
            .starts_with("/nanzhaigame-xpy/CPA_V2/-/releases/download/");
    if url.scheme() == "https" && (github || cnb) {
        return Ok(());
    }
    #[cfg(debug_assertions)]
    if matches!(url.scheme(), "http" | "https") && url.host_str() == Some("127.0.0.1") {
        return Ok(());
    }
    Err("视频编辑模块下载地址不在允许的发布源中".to_string())
}

fn validate_index_url(value: &str) -> Result<(), String> {
    let url = reqwest::Url::parse(value).map_err(|_| "视频编辑模块索引地址无效".to_string())?;
    let github = url.host_str() == Some("github.com")
        && url.path().starts_with("/UnityX103/CPA_V2/releases/");
    let cnb = url.host_str() == Some("cnb.cool")
        && url
            .path()
            .starts_with("/nanzhaigame-xpy/CPA_V2/-/releases/");
    if url.scheme() == "https"
        && (github || cnb)
        && url.path().ends_with("/video-editor-module-index.json")
    {
        return Ok(());
    }
    #[cfg(debug_assertions)]
    if matches!(url.scheme(), "http" | "https") && url.host_str() == Some("127.0.0.1") {
        return Ok(());
    }
    Err("视频编辑模块索引地址不在允许的发布源中".to_string())
}

fn validate_release_version(value: &str) -> Result<(), String> {
    let valid = (1..=64).contains(&value.len())
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'-' | b'+'))
        && value
            .as_bytes()
            .first()
            .is_some_and(u8::is_ascii_alphanumeric)
        && value
            .as_bytes()
            .last()
            .is_some_and(u8::is_ascii_alphanumeric)
        && !value.contains("..");
    if !valid {
        return Err("视频编辑模块版本号无效".to_string());
    }
    Ok(())
}

async fn download_small_document(
    client: &reqwest::Client,
    url: &str,
    maximum: usize,
    label: &str,
) -> Result<Vec<u8>, String> {
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|error| format!("无法获取{label}：{error}"))?;
    if response.status() == reqwest::StatusCode::NOT_FOUND && label == "视频编辑模块索引" {
        return Err("视频编辑模块尚未开放下载：当前没有通过许可与目标平台验收的发布包".to_string());
    }
    let response = response
        .error_for_status()
        .map_err(|error| format!("{label}请求失败：{error}"))?;
    if response
        .content_length()
        .is_some_and(|length| length > maximum as u64)
    {
        return Err(format!("{label}超过大小限制"));
    }
    let mut document = Vec::new();
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|error| format!("{label}下载中断：{error}"))?;
        if document.len().saturating_add(chunk.len()) > maximum {
            return Err(format!("{label}超过大小限制"));
        }
        document.extend_from_slice(&chunk);
    }
    Ok(document)
}

async fn download_verified_index(client: &reqwest::Client) -> Result<Vec<u8>, String> {
    let mut failures = Vec::new();
    for index_url in index_urls() {
        let result = async {
            validate_index_url(&index_url)?;
            let index_bytes =
                download_small_document(client, &index_url, MAX_INDEX_BYTES, "视频编辑模块索引")
                    .await?;
            let signature_bytes = download_small_document(
                client,
                &format!("{index_url}.sig"),
                MAX_SIGNATURE_BYTES,
                "视频编辑模块索引签名",
            )
            .await?;
            verify_index_signature(&index_bytes, &signature_bytes)?;
            Ok::<Vec<u8>, String>(index_bytes)
        }
        .await;
        match result {
            Ok(index) => return Ok(index),
            Err(error) => failures.push(error),
        }
    }
    Err(format!(
        "无法从发布镜像获取视频编辑模块：{}",
        failures.join("；")
    ))
}

async fn download_package_archive(
    client: &reqwest::Client,
    app: &tauri::AppHandle,
    package: &ModulePackage,
    archive_path: &Path,
) -> Result<(u64, Option<u64>), String> {
    let mut failures = Vec::new();
    let urls = std::iter::once(&package.url).chain(package.mirrors.iter());
    for (position, url) in urls.enumerate() {
        if let Err(error) = validate_package_url(url) {
            failures.push(error);
            continue;
        }
        if position > 0 {
            emit_progress(app, "download", 0, Some(package.size), "正在切换备用下载源");
        }
        let result = async {
            let response = client
                .get(url)
                .send()
                .await
                .map_err(|error| format!("视频编辑模块下载失败：{error}"))?
                .error_for_status()
                .map_err(|error| format!("视频编辑模块下载请求失败：{error}"))?;
            let content_length = response.content_length().or(Some(package.size));
            if content_length.is_some_and(|length| length > package.size) {
                return Err("视频编辑模块响应大小超过清单大小".to_string());
            }
            let mut stream = response.bytes_stream();
            let mut file = tokio::fs::File::create(archive_path)
                .await
                .map_err(|error| format!("无法创建视频编辑模块下载文件：{error}"))?;
            let mut hasher = Sha256::new();
            let mut downloaded = 0_u64;
            while let Some(chunk) = stream.next().await {
                let chunk = chunk.map_err(|error| format!("视频编辑模块下载中断：{error}"))?;
                downloaded = downloaded
                    .checked_add(chunk.len() as u64)
                    .ok_or_else(|| "视频编辑模块下载大小溢出".to_string())?;
                if downloaded > MAX_ARCHIVE_BYTES || downloaded > package.size {
                    return Err("视频编辑模块下载超过清单大小".to_string());
                }
                hasher.update(&chunk);
                file.write_all(&chunk)
                    .await
                    .map_err(|error| format!("无法保存视频编辑模块：{error}"))?;
                emit_progress(
                    app,
                    "download",
                    downloaded,
                    content_length,
                    "正在下载视频编辑模块",
                );
            }
            file.flush()
                .await
                .map_err(|error| format!("无法写入视频编辑模块：{error}"))?;
            drop(file);
            if downloaded != package.size {
                return Err("视频编辑模块下载大小与清单不一致".to_string());
            }
            let actual_hash = format!("{:x}", hasher.finalize());
            if actual_hash != package.sha256.to_ascii_lowercase() {
                return Err("视频编辑模块 SHA-256 校验失败".to_string());
            }
            Ok::<(u64, Option<u64>), String>((downloaded, content_length))
        }
        .await;
        match result {
            Ok(download) => return Ok(download),
            Err(error) => {
                let _ = tokio::fs::remove_file(archive_path).await;
                failures.push(error);
            }
        }
    }
    Err(format!(
        "所有视频编辑模块下载源均不可用：{}",
        failures.join("；")
    ))
}

fn module_public_key() -> Result<PublicKey, String> {
    use base64::Engine;

    let config: serde_json::Value = serde_json::from_str(include_str!("../tauri.conf.json"))
        .map_err(|error| format!("应用签名配置无效：{error}"))?;
    let encoded_key = config
        .pointer("/plugins/updater/pubkey")
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| "应用缺少模块签名公钥".to_string())?;
    let decoded_key = base64::engine::general_purpose::STANDARD
        .decode(encoded_key)
        .map_err(|error| format!("模块签名公钥编码无效：{error}"))?;
    let key_text = std::str::from_utf8(&decoded_key)
        .map_err(|error| format!("模块签名公钥文本无效：{error}"))?;
    PublicKey::decode(key_text).map_err(|error| format!("无法读取模块签名公钥：{error}"))
}

fn verify_index_signature(document: &[u8], encoded_signature: &[u8]) -> Result<(), String> {
    use base64::Engine;

    let encoded_text = std::str::from_utf8(encoded_signature)
        .map_err(|error| format!("模块索引签名编码无效：{error}"))?;
    let decoded_signature = base64::engine::general_purpose::STANDARD
        .decode(encoded_text.trim())
        .map_err(|error| format!("模块索引签名 Base64 无效：{error}"))?;
    let signature_text = std::str::from_utf8(&decoded_signature)
        .map_err(|error| format!("模块索引签名文本无效：{error}"))?;
    let public_key = module_public_key()?;
    let signature = Signature::decode(signature_text)
        .map_err(|error| format!("无法读取模块索引签名：{error}"))?;
    public_key
        .verify(document, &signature, false)
        .map_err(|error| format!("视频编辑模块索引签名校验失败：{error}"))
}

fn emit_progress(
    app: &tauri::AppHandle,
    stage: &str,
    downloaded_bytes: u64,
    total_bytes: Option<u64>,
    message: &str,
) {
    let _ = app.emit(
        MODULE_PROGRESS_EVENT,
        ModuleProgress {
            stage: stage.to_string(),
            downloaded_bytes,
            total_bytes,
            message: message.to_string(),
        },
    );
}

#[tauri::command]
pub fn video_editor_module_status(app: tauri::AppHandle) -> VideoEditorModuleStatus {
    let target = runtime_target().to_string();
    let result = module_root(&app).and_then(|root| resolve_installed_module(&root));
    match result {
        Ok(Some(resolved)) => VideoEditorModuleStatus {
            installed: true,
            version: Some(resolved.version),
            target,
            message: "视频编辑模块已下载".to_string(),
        },
        Ok(None) => VideoEditorModuleStatus {
            installed: false,
            version: None,
            target,
            message: "视频编辑模块尚未下载".to_string(),
        },
        Err(error) => VideoEditorModuleStatus {
            installed: false,
            version: None,
            target,
            message: error,
        },
    }
}

pub async fn download_video_editor_module(
    app: tauri::AppHandle,
    state: tauri::State<'_, VideoEditorModuleState>,
) -> Result<VideoEditorModuleStatus, String> {
    let target = runtime_target();
    if target == "unsupported" {
        return Err("当前平台不支持视频编辑模块".to_string());
    }
    let _update_permit = begin_module_update(&state)?;
    emit_progress(&app, "index", 0, None, "正在检查视频编辑模块版本");
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::limited(5))
        .timeout(Duration::from_secs(60 * 60))
        .build()
        .map_err(|error| format!("无法创建下载客户端：{error}"))?;
    let index_bytes = download_verified_index(&client).await?;
    match parse_module_index(&index_bytes)? {
        ModuleIndexDocument::Legacy(index) => {
            download_legacy_module(&app, &state, &client, index, target).await
        }
        ModuleIndexDocument::Layered(index) => {
            download_layered_module(&app, &state, &client, *index, target).await
        }
    }
}

pub(crate) async fn install_common_pack(
    app: &tauri::AppHandle,
    state: &VideoEditorModuleState,
) -> Result<(), String> {
    let target = runtime_target();
    if target == "unsupported" {
        return Err("当前平台不支持视频通用包".to_string());
    }
    let _update_permit = begin_module_update(state)?;
    ensure_module_idle_for_update(state)?;
    emit_progress(app, "index", 0, None, "正在检查视频通用包版本");
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::limited(5))
        .timeout(Duration::from_secs(60 * 60))
        .build()
        .map_err(|error| format!("无法创建下载客户端：{error}"))?;
    let index_bytes = download_verified_index(&client).await?;
    let ModuleIndexDocument::Layered(index) = parse_module_index(&index_bytes)? else {
        return Err("当前发布仍是旧版整包，无法单独安装视频通用包".to_string());
    };
    let index = *index;
    if index.debug_only && !cfg!(debug_assertions) {
        return Err("正式应用不能安装内部测试视频通用包".to_string());
    }
    let engine = index
        .engines
        .get(target)
        .cloned()
        .ok_or_else(|| format!("当前发布尚未提供 {target} 视频编辑引擎"))?;
    validate_layered_index_compatibility(&index.logic, &index.models, &engine)?;
    for component in [&engine, &index.models] {
        validate_release_version(&component.version)?;
        validate_sha256_text(&component.manifest_sha256)?;
        validate_package(&component.package)?;
    }
    let root = module_root(app)?;
    fs::create_dir_all(&root).map_err(|error| format!("无法创建视频通用包目录：{error}"))?;
    let mut downloaded = 0_u64;
    downloaded += ensure_layered_component(
        app,
        state,
        &client,
        &root,
        LayeredComponentKind::Engine,
        &engine,
        target,
    )
    .await?;
    downloaded += ensure_layered_component(
        app,
        state,
        &client,
        &root,
        LayeredComponentKind::Models,
        &index.models,
        target,
    )
    .await?;
    write_core_pointer(
        &root,
        &VideoCorePointer {
            schema_version: 1,
            target: target.to_string(),
            engine: InstalledComponentPointer {
                version: engine.version.clone(),
                directory: LayeredComponentKind::Engine.directory(
                    &engine.version,
                    target,
                    &engine.package.sha256,
                )?,
            },
            models: InstalledComponentPointer {
                version: index.models.version.clone(),
                directory: LayeredComponentKind::Models.directory(
                    &index.models.version,
                    target,
                    &index.models.package.sha256,
                )?,
            },
        },
    )?;
    emit_progress(app, "complete", downloaded, None, "视频通用包安装完成");
    Ok(())
}

async fn download_legacy_module(
    app: &tauri::AppHandle,
    state: &VideoEditorModuleState,
    client: &reqwest::Client,
    index: LegacyModuleIndex,
    target: &'static str,
) -> Result<VideoEditorModuleStatus, String> {
    if index.schema_version != LEGACY_INDEX_SCHEMA_VERSION {
        return Err("视频编辑模块索引版本不兼容".to_string());
    }
    if index.debug_only && !cfg!(debug_assertions) {
        return Err("正式应用不能安装内部测试视频编辑模块".to_string());
    }
    validate_release_version(&index.version)?;
    let root = module_root(app)?;
    if let Ok(Some(resolved)) = resolve_installed_module(&root) {
        if resolved.version == index.version {
            return Ok(VideoEditorModuleStatus {
                installed: true,
                version: Some(resolved.version),
                target: target.to_string(),
                message: "视频编辑模块已是最新版本".to_string(),
            });
        }
    }
    ensure_module_idle_for_update(state)?;
    if let Some(window) = app.get_webview_window("video-editor-module") {
        window
            .close()
            .map_err(|error| format!("无法关闭正在打开的视频编辑窗口：{error}"))?;
    }
    let package = index
        .packages
        .get(target)
        .cloned()
        .ok_or_else(|| format!("当前发布尚未提供 {target} 视频编辑模块"))?;
    validate_package_url(&package.url)?;
    for mirror in &package.mirrors {
        validate_package_url(mirror)?;
    }
    if package.size == 0 || package.size > MAX_ARCHIVE_BYTES {
        return Err("视频编辑模块下载大小无效".to_string());
    }
    validate_sha256_text(&package.sha256)?;

    fs::create_dir_all(&root).map_err(|error| format!("无法创建视频编辑模块目录：{error}"))?;
    let archive_path = root.join(format!(".download-{}-{target}.zip", index.version));
    let (downloaded, content_length) =
        download_package_archive(client, app, &package, &archive_path).await?;

    if let Err(error) = ensure_module_idle_for_update(state) {
        let _ = tokio::fs::remove_file(&archive_path).await;
        return Err(error);
    }

    emit_progress(
        app,
        "install",
        downloaded,
        content_length,
        "正在安装视频编辑模块",
    );
    let version = index.version.clone();
    let archive_for_install = archive_path.clone();
    let root_for_install = root.clone();
    tauri::async_runtime::spawn_blocking(move || {
        install_archive(&root_for_install, &archive_for_install, &version, target)
    })
    .await
    .map_err(|error| format!("视频编辑模块安装任务异常结束：{error}"))??;
    let _ = tokio::fs::remove_file(&archive_path).await;
    emit_progress(
        app,
        "complete",
        downloaded,
        content_length,
        "视频编辑模块下载完成",
    );
    Ok(video_editor_module_status(app.clone()))
}

async fn download_layered_module(
    app: &tauri::AppHandle,
    state: &VideoEditorModuleState,
    client: &reqwest::Client,
    index: LayeredModuleIndex,
    target: &'static str,
) -> Result<VideoEditorModuleStatus, String> {
    if index.schema_version != LAYERED_INDEX_SCHEMA_VERSION {
        return Err("分层视频编辑模块索引版本不兼容".to_string());
    }
    if index.debug_only && !cfg!(debug_assertions) {
        return Err("正式应用不能安装内部测试视频编辑模块".to_string());
    }
    validate_release_version(&index.version)?;
    if index.version != index.logic.version {
        return Err("分层视频编辑模块索引业务版本不一致".to_string());
    }
    let engine = index
        .engines
        .get(target)
        .cloned()
        .ok_or_else(|| format!("当前发布尚未提供 {target} 视频编辑引擎"))?;
    validate_layered_index_compatibility(&index.logic, &index.models, &engine)?;
    for component in [&engine, &index.models, &index.logic] {
        validate_release_version(&component.version)?;
        validate_sha256_text(&component.manifest_sha256)?;
        validate_package(&component.package)?;
    }
    let root = module_root(app)?;
    if layered_installation_matches_index(&root, &index, &engine, target)? {
        return Ok(VideoEditorModuleStatus {
            installed: true,
            version: Some(index.version.clone()),
            target: target.to_string(),
            message: "视频编辑模块已是最新版本".to_string(),
        });
    }
    ensure_module_idle_for_update(state)?;
    if let Some(window) = app.get_webview_window("video-editor-module") {
        window
            .close()
            .map_err(|error| format!("无法关闭正在打开的视频编辑窗口：{error}"))?;
    }
    fs::create_dir_all(&root).map_err(|error| format!("无法创建视频编辑模块目录：{error}"))?;
    let mut downloaded = 0_u64;
    downloaded += ensure_layered_component(
        app,
        state,
        client,
        &root,
        LayeredComponentKind::Engine,
        &engine,
        target,
    )
    .await?;
    downloaded += ensure_layered_component(
        app,
        state,
        client,
        &root,
        LayeredComponentKind::Models,
        &index.models,
        target,
    )
    .await?;
    downloaded += ensure_layered_component(
        app,
        state,
        client,
        &root,
        LayeredComponentKind::Logic,
        &index.logic,
        target,
    )
    .await?;
    ensure_module_idle_for_update(state)?;
    let root_for_activation = root.clone();
    let version = index.version.clone();
    tauri::async_runtime::spawn_blocking(move || {
        activate_layered_installation(&root_for_activation, &index, target)
    })
    .await
    .map_err(|error| format!("视频编辑模块激活任务异常结束：{error}"))??;
    let pointer: LayeredInstalledPointer = serde_json::from_slice(
        &fs::read(pointer_path(&root))
            .map_err(|error| format!("无法读取视频编辑模块状态：{error}"))?,
    )
    .map_err(|error| format!("分层视频编辑模块状态损坏：{error}"))?;
    write_core_pointer(&root, &core_pointer_from_feature(&pointer))?;
    emit_progress(
        app,
        "complete",
        downloaded,
        None,
        &format!("视频编辑模块 {version} 下载完成"),
    );
    Ok(video_editor_module_status(app.clone()))
}

fn layered_installation_matches_index(
    root: &Path,
    index: &LayeredModuleIndex,
    engine: &ComponentPackage,
    target: &str,
) -> Result<bool, String> {
    let resolved = match resolve_installed_module(root) {
        Ok(Some(value)) => value,
        Ok(None) | Err(_) => return Ok(false),
    };
    if resolved.version != index.logic.version
        || resolved.engine_version != engine.version
        || resolved.models_version != index.models.version
    {
        return Ok(false);
    }
    for (kind, component) in [
        (LayeredComponentKind::Engine, engine),
        (LayeredComponentKind::Models, &index.models),
        (LayeredComponentKind::Logic, &index.logic),
    ] {
        let directory = root.join(safe_relative_path(&kind.directory(
            &component.version,
            target,
            &component.package.sha256,
        )?)?);
        if validate_layered_component_directory(
            &directory,
            kind,
            &component.version,
            target,
            Some(component),
            true,
        )
        .is_err()
        {
            return Ok(false);
        }
    }
    Ok(true)
}

fn validate_layered_index_compatibility(
    logic: &ComponentPackage,
    models: &ComponentPackage,
    engine: &ComponentPackage,
) -> Result<(), String> {
    for component in [logic, models, engine] {
        validate_sha256_text(&component.manifest_sha256)?;
        validate_sha256_text(&component.package.sha256)?;
        if component.package.size == 0 {
            return Err("视频编辑组件索引大小无效".to_string());
        }
    }
    let logic_engine_abi = logic
        .engine_abi
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "视频编辑业务索引缺少 engineAbi".to_string())?;
    let logic_model_set = logic
        .model_set
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "视频编辑业务索引缺少 modelSet".to_string())?;
    if engine.engine_abi.as_deref() != Some(logic_engine_abi) {
        return Err("视频编辑业务与当前平台引擎 ABI 不兼容".to_string());
    }
    if models.model_set.as_deref() != Some(logic_model_set) {
        return Err("视频编辑业务与模型集不兼容".to_string());
    }
    Ok(())
}

async fn ensure_layered_component(
    app: &tauri::AppHandle,
    state: &VideoEditorModuleState,
    client: &reqwest::Client,
    root: &Path,
    kind: LayeredComponentKind,
    component: &ComponentPackage,
    target: &'static str,
) -> Result<u64, String> {
    let installed = root.join(safe_relative_path(&kind.directory(
        &component.version,
        target,
        &component.package.sha256,
    )?)?);
    if validate_layered_component_directory(
        &installed,
        kind,
        &component.version,
        target,
        Some(component),
        true,
    )
    .is_ok()
    {
        emit_progress(
            app,
            "install",
            0,
            Some(component.package.size),
            &format!("{}组件已存在，跳过下载", kind.label()),
        );
        return Ok(0);
    }
    let archive_path = root.join(format!(
        ".download-{}-{}-{target}.zip",
        kind.label(),
        component.version
    ));
    emit_progress(
        app,
        "download",
        0,
        Some(component.package.size),
        &format!("正在下载视频编辑{}组件", kind.label()),
    );
    let download = download_package_archive(client, app, &component.package, &archive_path).await;
    let (downloaded, content_length) = match download {
        Ok(value) => value,
        Err(error) => {
            let _ = tokio::fs::remove_file(&archive_path).await;
            return Err(error);
        }
    };
    if let Err(error) = ensure_module_idle_for_update(state) {
        let _ = tokio::fs::remove_file(&archive_path).await;
        return Err(error);
    }
    emit_progress(
        app,
        "install",
        downloaded,
        content_length,
        &format!("正在安装视频编辑{}组件", kind.label()),
    );
    let root_for_install = root.to_path_buf();
    let archive_for_install = archive_path.clone();
    let version = component.version.clone();
    let package = component.package.clone();
    let install_result = tauri::async_runtime::spawn_blocking(move || {
        install_layered_component(
            &root_for_install,
            &archive_for_install,
            kind,
            &version,
            target,
            &package,
        )
    })
    .await
    .map_err(|error| format!("视频编辑组件安装任务异常结束：{error}"));
    let _ = tokio::fs::remove_file(&archive_path).await;
    install_result??;
    Ok(downloaded)
}

fn validate_package(package: &ModulePackage) -> Result<(), String> {
    validate_package_url(&package.url)?;
    for mirror in &package.mirrors {
        validate_package_url(mirror)?;
    }
    if package.size == 0 || package.size > MAX_ARCHIVE_BYTES {
        return Err("视频编辑模块下载大小无效".to_string());
    }
    validate_sha256_text(&package.sha256)
}

fn validate_sha256_text(value: &str) -> Result<(), String> {
    if value.len() != 64 || !value.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err("视频编辑模块 SHA-256 清单无效".to_string());
    }
    Ok(())
}

fn install_archive(
    root: &Path,
    archive_path: &Path,
    version: &str,
    target: &str,
) -> Result<(), String> {
    let staging = root.join(format!(".staging-{version}-{target}"));
    if staging.exists() {
        fs::remove_dir_all(&staging).map_err(|error| format!("无法清理模块暂存目录：{error}"))?;
    }
    fs::create_dir_all(&staging).map_err(|error| format!("无法创建模块暂存目录：{error}"))?;
    let result = (|| {
        extract_archive_to(archive_path, &staging)?;
        let manifest: ModuleManifest = read_json_manifest(&staging.join("module.json"), "")?;
        validate_manifest(&manifest, version, target)?;
        let entry = join_relative(&staging, &manifest.entry)?;
        if !entry.is_file() {
            return Err("模块启动文件缺失".to_string());
        }
        ensure_executable_paths(&entry, &staging.join("runtime"))?;
        let directory = format!("{version}-{target}");
        let installed_dir = root.join(&directory);
        if installed_dir.exists() {
            fs::remove_dir_all(&installed_dir)
                .map_err(|error| format!("无法替换旧视频编辑模块：{error}"))?;
        }
        fs::rename(&staging, &installed_dir)
            .map_err(|error| format!("无法完成视频编辑模块安装：{error}"))?;
        let pointer = InstalledPointer {
            version: version.to_string(),
            target: target.to_string(),
            directory,
        };
        let bytes = serde_json::to_vec_pretty(&pointer)
            .map_err(|error| format!("无法序列化模块状态：{error}"))?;
        write_pointer_atomically(root, &bytes)
    })();
    if result.is_err() && staging.exists() {
        let _ = fs::remove_dir_all(&staging);
    }
    result
}

fn install_layered_component(
    root: &Path,
    archive_path: &Path,
    kind: LayeredComponentKind,
    version: &str,
    target: &str,
    package: &ModulePackage,
) -> Result<(), String> {
    validate_release_version(version)?;
    let staging = root.join(format!(".staging-{}-{version}-{target}", kind.label()));
    if staging.exists() {
        fs::remove_dir_all(&staging).map_err(|error| format!("无法清理组件暂存目录：{error}"))?;
    }
    fs::create_dir_all(&staging).map_err(|error| format!("无法创建组件暂存目录：{error}"))?;
    let result = (|| {
        extract_archive_to(archive_path, &staging)?;
        validate_layered_component_directory(&staging, kind, version, target, None, true)?;
        validate_sha256_text(&package.sha256)?;
        let artifact = InstalledArtifact {
            schema_version: 1,
            sha256: package.sha256.to_ascii_lowercase(),
            size: package.size,
        };
        fs::write(
            staging.join(".artifact.json"),
            serde_json::to_vec_pretty(&artifact)
                .map_err(|error| format!("无法序列化组件来源：{error}"))?,
        )
        .map_err(|error| format!("无法保存组件来源：{error}"))?;
        let installed = root.join(safe_relative_path(&kind.directory(
            version,
            target,
            &package.sha256,
        )?)?);
        if let Some(parent) = installed.parent() {
            fs::create_dir_all(parent).map_err(|error| format!("无法创建组件安装目录：{error}"))?;
        }
        if installed.exists() {
            fs::remove_dir_all(&installed)
                .map_err(|error| format!("无法替换旧视频编辑组件：{error}"))?;
        }
        fs::rename(&staging, &installed)
            .map_err(|error| format!("无法完成视频编辑组件安装：{error}"))?;
        Ok(())
    })();
    if result.is_err() && staging.exists() {
        let _ = fs::remove_dir_all(&staging);
    }
    result
}

fn extract_archive_to(archive_path: &Path, staging: &Path) -> Result<(), String> {
    let archive_file = fs::File::open(archive_path)
        .map_err(|error| format!("无法打开视频编辑模块压缩包：{error}"))?;
    let mut archive = ZipArchive::new(archive_file)
        .map_err(|error| format!("视频编辑模块压缩包损坏：{error}"))?;
    if archive.len() > MAX_ARCHIVE_FILES {
        return Err("视频编辑模块文件数量超过限制".to_string());
    }
    let mut extracted = 0_u64;
    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|error| format!("无法读取模块压缩包条目：{error}"))?;
        let enclosed = entry
            .enclosed_name()
            .ok_or_else(|| "视频编辑模块压缩包包含不安全路径".to_string())?
            .to_path_buf();
        if entry
            .unix_mode()
            .is_some_and(|mode| mode & 0o170000 == 0o120000)
        {
            return Err("视频编辑模块压缩包不允许符号链接".to_string());
        }
        extracted = extracted
            .checked_add(entry.size())
            .ok_or_else(|| "视频编辑模块解压大小溢出".to_string())?;
        if extracted > MAX_EXTRACTED_BYTES {
            return Err("视频编辑模块解压大小超过限制".to_string());
        }
        let output = staging.join(enclosed);
        if entry.is_dir() {
            fs::create_dir_all(&output).map_err(|error| format!("无法创建模块目录：{error}"))?;
            continue;
        }
        if let Some(parent) = output.parent() {
            fs::create_dir_all(parent).map_err(|error| format!("无法创建模块目录：{error}"))?;
        }
        let mut target_file =
            fs::File::create(&output).map_err(|error| format!("无法写入模块文件：{error}"))?;
        std::io::copy(&mut entry, &mut target_file)
            .map_err(|error| format!("无法解压模块文件：{error}"))?;
        drop(target_file);
        restore_archive_permissions(&output, entry.unix_mode())?;
    }
    Ok(())
}

fn validate_layered_component_directory(
    directory: &Path,
    kind: LayeredComponentKind,
    expected_version: &str,
    target: &str,
    expected_component: Option<&ComponentPackage>,
    verify_files: bool,
) -> Result<(), String> {
    if let Some(component) = expected_component {
        let artifact: InstalledArtifact =
            read_json_manifest(&directory.join(".artifact.json"), "来源")?;
        if artifact.schema_version != 1
            || artifact.sha256 != component.package.sha256.to_ascii_lowercase()
            || artifact.size != component.package.size
        {
            return Err("已安装视频编辑组件与签名索引哈希不一致".to_string());
        }
        validate_sha256_text(&component.manifest_sha256)?;
        let manifest_hash = sha256_file(&directory.join(kind.manifest_name()))?;
        if manifest_hash != component.manifest_sha256.to_ascii_lowercase() {
            return Err("已安装视频编辑组件清单与签名索引哈希不一致".to_string());
        }
    }
    match kind {
        LayeredComponentKind::Engine => {
            let manifest: EngineManifest =
                read_json_manifest(&directory.join("engine.json"), "引擎")?;
            if manifest.schema_version != 1
                || manifest.component_type != "engine"
                || manifest.version != expected_version
                || manifest.target != target
                || manifest.engine_abi.trim().is_empty()
            {
                return Err("视频编辑引擎清单与安装目标不匹配".to_string());
            }
            let entry = join_relative(directory, &manifest.entry)?;
            let runtime_root = join_relative(directory, &manifest.runtime_root)?;
            if !entry.is_file() || !runtime_root.is_dir() {
                return Err("视频编辑引擎文件不完整".to_string());
            }
            if verify_files {
                verify_component_files(directory, &manifest.files)?;
            }
            ensure_executable_paths(&entry, &runtime_root)
        }
        LayeredComponentKind::Models => {
            let manifest: ModelsManifest =
                read_json_manifest(&directory.join("models.json"), "模型")?;
            if manifest.schema_version != 1
                || manifest.component_type != "models"
                || manifest.version != expected_version
                || manifest.model_set.trim().is_empty()
            {
                return Err("视频编辑模型清单与安装目标不匹配".to_string());
            }
            if !join_relative(directory, &manifest.model_root)?.is_dir() {
                return Err("视频编辑模型文件不完整".to_string());
            }
            if verify_files {
                verify_component_files(directory, &manifest.files)?;
            }
            Ok(())
        }
        LayeredComponentKind::Logic => {
            let manifest: LogicManifest =
                read_json_manifest(&directory.join("module.json"), "业务")?;
            let contract = module_contract()?;
            if manifest.schema_version != LAYERED_INDEX_SCHEMA_VERSION
                || manifest.component_type != "logic"
                || manifest.id != contract.id
                || manifest.version != expected_version
                || manifest.engine_abi.trim().is_empty()
                || manifest.model_set.trim().is_empty()
                || contract.capabilities.iter().any(|capability| {
                    !manifest
                        .capabilities
                        .iter()
                        .any(|value| value == capability)
                })
            {
                return Err("视频编辑业务清单与安装目标不匹配".to_string());
            }
            let module_root = join_relative(directory, &manifest.module_root)?;
            if !module_root
                .join("video_editor_module/__main__.py")
                .is_file()
            {
                return Err("视频编辑业务代码不完整".to_string());
            }
            if verify_files {
                verify_component_files(directory, &manifest.files)?;
            }
            Ok(())
        }
    }
}

fn sha256_file(path: &Path) -> Result<String, String> {
    let mut source =
        fs::File::open(path).map_err(|error| format!("无法打开视频编辑组件校验文件：{error}"))?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0_u8; 1024 * 1024];
    loop {
        let read = source
            .read(&mut buffer)
            .map_err(|error| format!("无法读取视频编辑组件校验文件：{error}"))?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

fn verify_component_files(directory: &Path, files: &[ComponentFile]) -> Result<(), String> {
    if files.is_empty() || files.len() > MAX_ARCHIVE_FILES {
        return Err("视频编辑组件文件哈希清单为空或过大".to_string());
    }
    let mut seen = HashSet::with_capacity(files.len());
    let mut buffer = vec![0_u8; 1024 * 1024];
    for item in files {
        validate_sha256_text(&item.sha256)?;
        let relative = safe_relative_path(&item.path)?;
        if relative == Path::new(".") || !seen.insert(relative.clone()) {
            return Err("视频编辑组件文件哈希清单包含重复或无效路径".to_string());
        }
        let path = directory.join(relative);
        let metadata = fs::symlink_metadata(&path)
            .map_err(|error| format!("视频编辑组件文件缺失：{error}"))?;
        if !metadata.file_type().is_file() || metadata.len() != item.size {
            return Err(format!("视频编辑组件文件大小不匹配：{}", item.path));
        }
        let mut source =
            fs::File::open(&path).map_err(|error| format!("无法校验视频编辑组件文件：{error}"))?;
        let mut hasher = Sha256::new();
        loop {
            let read = source
                .read(&mut buffer)
                .map_err(|error| format!("无法校验视频编辑组件文件：{error}"))?;
            if read == 0 {
                break;
            }
            hasher.update(&buffer[..read]);
        }
        if format!("{:x}", hasher.finalize()) != item.sha256.to_ascii_lowercase() {
            return Err(format!("视频编辑组件文件 SHA-256 不匹配：{}", item.path));
        }
    }
    Ok(())
}

#[cfg(unix)]
fn restore_archive_permissions(path: &Path, archived_mode: Option<u32>) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;

    let Some(mode) = archived_mode else {
        return Ok(());
    };
    fs::set_permissions(path, fs::Permissions::from_mode(mode & 0o777))
        .map_err(|error| format!("无法恢复模块文件权限：{error}"))
}

#[cfg(not(unix))]
fn restore_archive_permissions(_path: &Path, _archived_mode: Option<u32>) -> Result<(), String> {
    Ok(())
}

#[cfg(unix)]
fn ensure_runtime_executables(
    installed_directory: &Path,
    manifest: &ModuleManifest,
) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;

    let entry = safe_relative_path(&manifest.entry)?;
    for relative in [
        entry,
        PathBuf::from("runtime/bin/ffmpeg"),
        PathBuf::from("runtime/bin/ffprobe"),
    ] {
        let path = installed_directory.join(relative);
        if !path.is_file() {
            continue;
        }
        let permissions = fs::metadata(&path)
            .map_err(|error| format!("无法读取模块程序权限：{error}"))?
            .permissions();
        let mode = permissions.mode();
        if mode & 0o111 == 0 {
            fs::set_permissions(&path, fs::Permissions::from_mode(mode | 0o111))
                .map_err(|error| format!("无法修复模块程序权限：{error}"))?;
        }
    }
    Ok(())
}

#[cfg(unix)]
fn ensure_executable_paths(entry: &Path, runtime_root: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;

    for path in [
        entry.to_path_buf(),
        runtime_root.join("bin/ffmpeg"),
        runtime_root.join("bin/ffprobe"),
    ] {
        if !path.is_file() {
            continue;
        }
        let permissions = fs::metadata(&path)
            .map_err(|error| format!("无法读取模块程序权限：{error}"))?
            .permissions();
        let mode = permissions.mode();
        if mode & 0o111 == 0 {
            fs::set_permissions(&path, fs::Permissions::from_mode(mode | 0o111))
                .map_err(|error| format!("无法修复模块程序权限：{error}"))?;
        }
    }
    Ok(())
}

#[cfg(not(unix))]
fn ensure_runtime_executables(
    _installed_directory: &Path,
    _manifest: &ModuleManifest,
) -> Result<(), String> {
    Ok(())
}

#[cfg(not(unix))]
fn ensure_executable_paths(_entry: &Path, _runtime_root: &Path) -> Result<(), String> {
    Ok(())
}

#[tauri::command]
pub async fn launch_video_editor_module(
    app: tauri::AppHandle,
    state: tauri::State<'_, VideoEditorModuleState>,
) -> Result<(), String> {
    if !pack_is_enabled(&app, VIDEO_EDITOR_ID)? {
        return Err("视频编辑功能包已禁用，请先在扩展包设置中启用".to_string());
    }
    if let Some(window) = app.get_webview_window("video-editor-module") {
        window.show().map_err(|error| error.to_string())?;
        window.set_focus().map_err(|error| error.to_string())?;
        return Ok(());
    }
    let root = module_root(&app)?;
    let Some(resolved) = resolve_installed_module(&root)? else {
        return Err("请先下载视频编辑模块".to_string());
    };
    stop_child(&state);
    let port = TcpListener::bind(("127.0.0.1", 0))
        .and_then(|listener| listener.local_addr())
        .map_err(|error| format!("无法分配视频编辑模块端口：{error}"))?
        .port();
    let token = Alphanumeric.sample_string(&mut rand::rng(), 48);
    let mut command = Command::new(&resolved.entry);
    command
        .current_dir(&resolved.working_directory)
        .args(&resolved.arguments)
        .arg("--serve")
        .arg("--host")
        .arg("127.0.0.1")
        .arg("--port")
        .arg(port.to_string())
        .arg("--token")
        .arg(&token)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    command.envs(&resolved.environment);
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let child = command
        .spawn()
        .map_err(|error| format!("无法启动视频编辑模块：{error}"))?;
    *state
        .child
        .lock()
        .expect("video editor module state poisoned") = Some(child);

    let health_url = format!("http://127.0.0.1:{port}/api/health?token={token}");
    let client = reqwest::Client::new();
    let started = Instant::now();
    loop {
        if let Ok(response) = client.get(&health_url).send().await {
            if response.status().is_success() {
                break;
            }
        }
        if started.elapsed() > Duration::from_secs(30) {
            stop_child(&state);
            return Err("视频编辑模块启动超时".to_string());
        }
        tokio::time::sleep(Duration::from_millis(150)).await;
    }

    let url: tauri::Url = format!("http://127.0.0.1:{port}/?token={token}")
        .parse()
        .map_err(|error| format!("视频编辑模块地址无效：{error}"))?;
    let app_for_window = app.clone();
    let download_token = token.clone();
    let (tx, rx) = std::sync::mpsc::channel();
    app.run_on_main_thread(move || {
        let app_for_download = app_for_window.clone();
        let result = WebviewWindowBuilder::new(
            &app_for_window,
            "video-editor-module",
            WebviewUrl::External(url),
        )
        .on_download(move |_webview, event| match event {
            DownloadEvent::Requested { url, .. } => {
                if let Some(file_name) = video_editor_download_filename(&url, port, &download_token)
                {
                    request_video_editor_download(app_for_download.clone(), url, file_name);
                }
                false
            }
            _ => true,
        })
        .title("AI 视频编辑器")
        .inner_size(1100.0, 760.0)
        .min_inner_size(860.0, 620.0)
        .resizable(true)
        .center()
        .build()
        .map_err(|error| error.to_string());
        let _ = tx.send(result);
    })
    .map_err(|error| error.to_string())?;
    let window = rx
        .recv()
        .map_err(|error| format!("视频编辑窗口创建结果丢失：{error}"))??;
    let app_for_close = app.clone();
    window.on_window_event(move |event| {
        if matches!(event, tauri::WindowEvent::Destroyed) {
            let state = app_for_close.state::<VideoEditorModuleState>();
            let _ = stop_child_checked(&state);
        }
    });
    Ok(())
}

pub(crate) fn stop_feature(
    app: &tauri::AppHandle,
    state: &VideoEditorModuleState,
) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("video-editor-module") {
        window
            .close()
            .map_err(|error| format!("无法关闭视频编辑窗口：{error}"))?;
    }
    stop_child_checked(state)
}

pub(crate) fn uninstall_feature_pack(
    app: &tauri::AppHandle,
    state: &VideoEditorModuleState,
) -> Result<(), String> {
    let root = module_root(app)?;
    if !root.exists() {
        return Ok(());
    }
    let current = pointer_path(&root);
    if !current.is_file() {
        return Ok(());
    }
    let value: serde_json::Value = serde_json::from_slice(
        &fs::read(&current).map_err(|error| format!("无法读取视频编辑模块状态：{error}"))?,
    )
    .map_err(|error| format!("视频编辑模块状态损坏：{error}"))?;
    if value
        .get("schemaVersion")
        .and_then(serde_json::Value::as_u64)
        == Some(LAYERED_INDEX_SCHEMA_VERSION as u64)
    {
        let pointer: LayeredInstalledPointer = serde_json::from_value(value)
            .map_err(|error| format!("分层视频编辑模块状态损坏：{error}"))?;
        stop_feature(app, state)?;
        return split_layered_feature_installation(&root, &pointer);
    }
    Err("旧版视频编辑整包无法安全拆分，请先升级到分层扩展包再卸载".to_string())
}

pub(crate) fn uninstall_common_pack(app: &tauri::AppHandle) -> Result<(), String> {
    let root = module_root(app)?;
    if pointer_path(&root).exists() {
        return Err("视频编辑功能包仍依赖视频通用包，请先卸载功能包".to_string());
    }
    for name in ["engines", "models"] {
        let path = root.join(name);
        if path.exists() {
            fs::remove_dir_all(&path)
                .map_err(|error| format!("无法删除视频通用包{name}：{error}"))?;
        }
    }
    let pointer = core_pointer_path(&root);
    if pointer.exists() {
        fs::remove_file(pointer).map_err(|error| format!("无法删除视频通用包状态：{error}"))?;
    }
    Ok(())
}

fn stop_child(state: &VideoEditorModuleState) {
    if let Ok(mut guard) = state.child.lock() {
        if let Some(mut child) = guard.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

fn stop_child_checked(state: &VideoEditorModuleState) -> Result<(), String> {
    let mut guard = state
        .child
        .lock()
        .map_err(|_| "视频编辑模块进程状态不可用".to_string())?;
    let Some(child) = guard.as_mut() else {
        return Ok(());
    };
    if child
        .try_wait()
        .map_err(|error| format!("无法检查视频编辑进程：{error}"))?
        .is_none()
    {
        child
            .kill()
            .map_err(|error| format!("无法停止视频编辑进程：{error}"))?;
    }
    child
        .wait()
        .map_err(|error| format!("无法等待视频编辑进程退出：{error}"))?;
    guard.take();
    Ok(())
}

fn child_is_running(state: &VideoEditorModuleState) -> bool {
    let Ok(mut guard) = state.child.lock() else {
        return true;
    };
    let Some(child) = guard.as_mut() else {
        return false;
    };
    match child.try_wait() {
        Ok(None) => true,
        Ok(Some(_)) => {
            guard.take();
            false
        }
        Err(_) => true,
    }
}

fn ensure_module_idle_for_update(state: &VideoEditorModuleState) -> Result<(), String> {
    if child_is_running(state) {
        return Err("请先关闭视频编辑器并等待当前处理任务结束，再更新模板".to_string());
    }
    Ok(())
}

fn begin_module_update(state: &VideoEditorModuleState) -> Result<ModuleUpdatePermit<'_>, String> {
    let mut updating = state
        .update_in_progress
        .lock()
        .map_err(|_| "视频编辑模块更新状态不可用".to_string())?;
    if *updating {
        return Err("视频编辑模块正在下载或安装，请稍候".to_string());
    }
    *updating = true;
    drop(updating);
    Ok(ModuleUpdatePermit(state))
}

pub fn stop_for_exit(app: &tauri::AppHandle) {
    let state = app.state::<VideoEditorModuleState>();
    stop_child(&state);
}

pub fn bundled_tool_path(app: &tauri::AppHandle, tool: &str) -> Option<PathBuf> {
    if !matches!(tool, "ffmpeg" | "ffprobe") {
        return None;
    }
    let root = module_root(app).ok()?;
    let resolved = resolve_installed_module(&root).ok()??;
    let suffix = if cfg!(target_os = "windows") {
        ".exe"
    } else {
        ""
    };
    let path = resolved
        .runtime_root
        .join("bin")
        .join(format!("{tool}{suffix}"));
    path.is_file().then_some(path)
}

#[cfg(test)]
mod tests {
    use super::{
        activate_layered_installation, download_video_editor_file, ensure_module_idle_for_update,
        index_urls, install_archive, install_layered_component, module_contract, module_public_key,
        parse_module_index, read_installed_manifest, resolve_installed_module, runtime_target,
        safe_relative_path, split_layered_feature_installation, stop_child, validate_index_url,
        validate_layered_component_directory, validate_layered_index_compatibility,
        validate_manifest, validate_package_url, validate_release_version, validate_sha256_text,
        verify_index_signature, video_editor_download_filename, ComponentPackage,
        InstalledComponentPointer, LayeredComponentKind, LayeredInstalledPointer,
        ModuleIndexDocument, ModuleManifest, ModulePackage, VideoEditorModuleState,
    };

    fn sha256_bytes(bytes: &[u8]) -> String {
        use sha2::{Digest, Sha256};

        format!("{:x}", Sha256::digest(bytes))
    }

    fn write_artifact(directory: &std::path::Path, sha256: &str, size: u64) {
        std::fs::write(
            directory.join(".artifact.json"),
            serde_json::to_vec(&serde_json::json!({
                "schemaVersion": 1,
                "sha256": sha256,
                "size": size
            }))
            .unwrap(),
        )
        .unwrap();
    }

    fn manifest() -> ModuleManifest {
        let contract = module_contract().expect("read module contract");
        ModuleManifest {
            schema_version: contract.schema_version,
            id: contract.id,
            version: "1.0.0".to_string(),
            target: runtime_target().to_string(),
            entry: "runtime/video-editor-module".to_string(),
            capabilities: contract.capabilities,
        }
    }

    #[test]
    fn layered_feature_uninstall_preserves_the_video_common_pack() {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "cpa-video-split-uninstall-{}-{unique}",
            std::process::id()
        ));
        for directory in [
            "engines/1.0.0-macos-arm64-aaaaaaaaaaaaaaaa",
            "models/1.0.0-bbbbbbbbbbbbbbbb",
            "logic/1.2.0-cccccccccccccccc",
        ] {
            std::fs::create_dir_all(root.join(directory)).unwrap();
        }
        let pointer = LayeredInstalledPointer {
            schema_version: 2,
            version: "1.2.0".to_string(),
            target: "macos-arm64".to_string(),
            engine: InstalledComponentPointer {
                version: "1.0.0".to_string(),
                directory: "engines/1.0.0-macos-arm64-aaaaaaaaaaaaaaaa".to_string(),
            },
            models: InstalledComponentPointer {
                version: "1.0.0".to_string(),
                directory: "models/1.0.0-bbbbbbbbbbbbbbbb".to_string(),
            },
            logic: InstalledComponentPointer {
                version: "1.2.0".to_string(),
                directory: "logic/1.2.0-cccccccccccccccc".to_string(),
            },
        };
        std::fs::write(
            root.join("current.json"),
            serde_json::to_vec_pretty(&pointer).unwrap(),
        )
        .unwrap();

        split_layered_feature_installation(&root, &pointer).unwrap();

        assert!(!root.join("current.json").exists());
        assert!(!root.join("logic").exists());
        assert!(root.join(&pointer.engine.directory).exists());
        assert!(root.join(&pointer.models.directory).exists());
        let common: serde_json::Value =
            serde_json::from_slice(&std::fs::read(root.join("core.json")).unwrap()).unwrap();
        assert_eq!(common["engine"]["directory"], pointer.engine.directory);
        assert_eq!(common["models"]["directory"], pointer.models.directory);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn accepts_the_expected_module_contract() {
        validate_manifest(&manifest(), "1.0.0", runtime_target()).unwrap();
    }

    #[test]
    fn layered_installation_resolves_to_the_same_launch_interface() {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("clock after epoch")
            .as_nanos();
        let fixture = std::env::temp_dir().join(format!(
            "cpa-video-editor-layered-{}-{unique}",
            std::process::id()
        ));
        std::fs::create_dir_all(&fixture).expect("create layered fixture");
        let root = fixture.as_path();
        let target = runtime_target();
        let executable = if cfg!(target_os = "windows") {
            "video-editor-host.exe"
        } else {
            "video-editor-host"
        };
        let engine_sha = "c".repeat(64);
        let models_sha = "b".repeat(64);
        let logic_sha = "a".repeat(64);
        let engine = root.join(
            LayeredComponentKind::Engine
                .directory("1.0.0", target, &engine_sha)
                .unwrap(),
        );
        let models = root.join(
            LayeredComponentKind::Models
                .directory("1.0.0", target, &models_sha)
                .unwrap(),
        );
        let logic = root.join(
            LayeredComponentKind::Logic
                .directory("1.1.0", target, &logic_sha)
                .unwrap(),
        );
        std::fs::create_dir_all(engine.join("runtime/bin")).unwrap();
        std::fs::create_dir_all(models.join("models/sam2")).unwrap();
        std::fs::create_dir_all(logic.join("video_editor_module/static")).unwrap();
        write_artifact(&engine, &engine_sha, 1);
        write_artifact(&models, &models_sha, 1);
        write_artifact(&logic, &logic_sha, 1);
        std::fs::write(engine.join("runtime").join(executable), b"host").unwrap();
        std::fs::write(engine.join("runtime/bin/ffmpeg"), b"ffmpeg").unwrap();
        std::fs::write(models.join("models/sam2/checkpoint.pt"), b"model").unwrap();
        std::fs::write(logic.join("video_editor_module/__main__.py"), b"logic").unwrap();
        std::fs::write(
            engine.join("engine.json"),
            serde_json::to_vec(&serde_json::json!({
                "schemaVersion": 1,
                "type": "engine",
                "version": "1.0.0",
                "target": target,
                "engineAbi": "cpa-video-engine-1",
                "entry": format!("runtime/{executable}"),
                "runtimeRoot": "runtime",
                "files": [
                    {"path": format!("runtime/{executable}"), "size": 4, "sha256": sha256_bytes(b"host")},
                    {"path": "runtime/bin/ffmpeg", "size": 6, "sha256": sha256_bytes(b"ffmpeg")}
                ]
            }))
            .unwrap(),
        )
        .unwrap();
        std::fs::write(
            models.join("models.json"),
            serde_json::to_vec(&serde_json::json!({
                "schemaVersion": 1,
                "type": "models",
                "version": "1.0.0",
                "modelSet": "sam2-baseplus-birefnet-1",
                "modelRoot": "models",
                "files": [
                    {"path": "models/sam2/checkpoint.pt", "size": 5, "sha256": sha256_bytes(b"model")}
                ]
            }))
            .unwrap(),
        )
        .unwrap();
        let contract = module_contract().unwrap();
        std::fs::write(
            logic.join("module.json"),
            serde_json::to_vec(&serde_json::json!({
                "schemaVersion": 2,
                "type": "logic",
                "id": contract.id,
                "version": "1.1.0",
                "engineAbi": "cpa-video-engine-1",
                "modelSet": "sam2-baseplus-birefnet-1",
                "moduleRoot": ".",
                "capabilities": contract.capabilities,
                "files": [
                    {"path": "video_editor_module/__main__.py", "size": 5, "sha256": sha256_bytes(b"logic")}
                ]
            }))
            .unwrap(),
        )
        .unwrap();
        let layered_index = serde_json::json!({
            "schemaVersion": 2,
            "version": "1.1.0",
            "logic": {"version": "1.1.0", "engineAbi": "cpa-video-engine-1", "modelSet": "sam2-baseplus-birefnet-1", "manifestSha256": "d".repeat(64), "url": "https://github.com/UnityX103/CPA_V2/releases/download/v2/logic.zip", "sha256": logic_sha, "size": 1},
            "models": {"version": "1.0.0", "modelSet": "sam2-baseplus-birefnet-1", "manifestSha256": "e".repeat(64), "url": "https://github.com/UnityX103/CPA_V2/releases/download/v2/models.zip", "sha256": models_sha, "size": 1},
            "engines": {
                target: {"version": "1.0.0", "engineAbi": "cpa-video-engine-1", "manifestSha256": "f".repeat(64), "url": "https://github.com/UnityX103/CPA_V2/releases/download/v2/engine.zip", "sha256": engine_sha, "size": 1}
            }
        });
        let ModuleIndexDocument::Layered(layered_index) =
            parse_module_index(&serde_json::to_vec(&layered_index).unwrap()).unwrap()
        else {
            panic!("expected layered index");
        };
        activate_layered_installation(root, &layered_index, target)
            .expect("activate compatible layered installation");

        let resolved = resolve_installed_module(root)
            .expect("resolve layered installation")
            .expect("layered module is installed");
        assert_eq!(resolved.version, "1.1.0");
        assert_eq!(resolved.entry, engine.join("runtime").join(executable));
        assert_eq!(resolved.working_directory, engine);
        assert_eq!(
            resolved.arguments,
            vec![
                "--logic-root".to_string(),
                logic.to_string_lossy().into_owned()
            ]
        );
        assert_eq!(
            resolved.environment.get("CPA_VIDEO_EDITOR_RUNTIME_ROOT"),
            Some(&engine.join("runtime").to_string_lossy().into_owned())
        );
        assert_eq!(
            resolved.environment.get("CPA_VIDEO_EDITOR_MODEL_ROOT"),
            Some(&models.join("models").to_string_lossy().into_owned())
        );

        let current_before_failure = std::fs::read(root.join("current.json")).unwrap();
        std::fs::write(
            logic.join("module.json"),
            serde_json::to_vec(&serde_json::json!({
                "schemaVersion": 2,
                "type": "logic",
                "id": contract.id,
                "version": "1.1.0",
                "engineAbi": "incompatible-engine",
                "modelSet": "sam2-baseplus-birefnet-1",
                "moduleRoot": ".",
                "capabilities": contract.capabilities,
                "files": [
                    {"path": "video_editor_module/__main__.py", "size": 5, "sha256": sha256_bytes(b"logic")}
                ]
            }))
            .unwrap(),
        )
        .unwrap();
        assert!(activate_layered_installation(root, &layered_index, target).is_err());
        assert_eq!(
            std::fs::read(root.join("current.json")).unwrap(),
            current_before_failure,
            "failed activation replaced the working pointer"
        );
        std::fs::remove_dir_all(&fixture).expect("remove layered fixture");
    }

    #[test]
    fn module_index_accepts_legacy_and_layered_documents() {
        assert_ne!(
            LayeredComponentKind::Logic
                .directory("1.1.0", runtime_target(), &"a".repeat(64))
                .unwrap(),
            LayeredComponentKind::Logic
                .directory("1.1.0", runtime_target(), &"b".repeat(64))
                .unwrap(),
            "same-version artifacts must not replace one another in place"
        );
        let legacy = serde_json::json!({
            "schemaVersion": 1,
            "version": "1.0.0",
            "packages": {
                runtime_target(): {
                    "url": "https://github.com/UnityX103/CPA_V2/releases/download/v1/module.zip",
                    "sha256": "a".repeat(64),
                    "size": 1
                }
            }
        });
        assert!(matches!(
            parse_module_index(&serde_json::to_vec(&legacy).unwrap()).unwrap(),
            ModuleIndexDocument::Legacy(_)
        ));

        let layered = serde_json::json!({
            "schemaVersion": 2,
            "version": "1.1.0",
            "logic": {"version": "1.1.0", "engineAbi": "cpa-video-engine-1", "modelSet": "sam2-baseplus-birefnet-1", "manifestSha256": "d".repeat(64), "url": "https://github.com/UnityX103/CPA_V2/releases/download/v2/logic.zip", "sha256": "a".repeat(64), "size": 1},
            "models": {"version": "1.0.0", "modelSet": "sam2-baseplus-birefnet-1", "manifestSha256": "e".repeat(64), "url": "https://github.com/UnityX103/CPA_V2/releases/download/v2/models.zip", "sha256": "b".repeat(64), "size": 1},
            "engines": {
                runtime_target(): {"version": "1.0.0", "engineAbi": "cpa-video-engine-1", "manifestSha256": "f".repeat(64), "url": "https://github.com/UnityX103/CPA_V2/releases/download/v2/engine.zip", "sha256": "c".repeat(64), "size": 1}
            }
        });
        assert!(matches!(
            parse_module_index(&serde_json::to_vec(&layered).unwrap()).unwrap(),
            ModuleIndexDocument::Layered(_)
        ));
        let ModuleIndexDocument::Layered(mut parsed) =
            parse_module_index(&serde_json::to_vec(&layered).unwrap()).unwrap()
        else {
            unreachable!();
        };
        let engine = parsed.engines.get_mut(runtime_target()).unwrap();
        engine.engine_abi = Some("cpa-video-engine-2".to_string());
        assert!(
            validate_layered_index_compatibility(&parsed.logic, &parsed.models, engine).is_err()
        );
    }

    #[test]
    fn layered_component_archive_installs_without_changing_current_pointer() {
        use std::io::Write;
        use zip::write::SimpleFileOptions;

        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let fixture = std::env::temp_dir().join(format!(
            "cpa-video-editor-engine-{}-{unique}",
            std::process::id()
        ));
        let root = fixture.join("modules");
        let archive_path = fixture.join("engine.zip");
        std::fs::create_dir_all(&fixture).unwrap();
        let file = std::fs::File::create(&archive_path).unwrap();
        let mut archive = zip::ZipWriter::new(file);
        let executable = if cfg!(target_os = "windows") {
            "video-editor-host.exe"
        } else {
            "video-editor-host"
        };
        archive
            .start_file(
                format!("runtime/{executable}"),
                SimpleFileOptions::default().unix_permissions(0o755),
            )
            .unwrap();
        archive.write_all(b"host").unwrap();
        archive
            .start_file("engine.json", SimpleFileOptions::default())
            .unwrap();
        archive
            .write_all(
                serde_json::to_string(&serde_json::json!({
                    "schemaVersion": 1,
                    "type": "engine",
                    "version": "1.0.0",
                    "target": runtime_target(),
                    "engineAbi": "cpa-video-engine-1",
                    "entry": format!("runtime/{executable}"),
                    "runtimeRoot": "runtime",
                    "files": [
                        {"path": format!("runtime/{executable}"), "size": 4, "sha256": sha256_bytes(b"host")}
                    ]
                }))
                .unwrap()
                .as_bytes(),
            )
            .unwrap();
        archive.finish().unwrap();
        let package = ModulePackage {
            url: "https://github.com/UnityX103/CPA_V2/releases/download/v2/engine.zip".to_string(),
            mirrors: Vec::new(),
            sha256: "a".repeat(64),
            size: std::fs::metadata(&archive_path).unwrap().len(),
        };

        install_layered_component(
            &root,
            &archive_path,
            LayeredComponentKind::Engine,
            "1.0.0",
            runtime_target(),
            &package,
        )
        .expect("install engine component");
        let installed = root.join(
            LayeredComponentKind::Engine
                .directory("1.0.0", runtime_target(), &package.sha256)
                .unwrap(),
        );
        let component = ComponentPackage {
            version: "1.0.0".to_string(),
            manifest_sha256: sha256_bytes(&std::fs::read(installed.join("engine.json")).unwrap()),
            engine_abi: Some("cpa-video-engine-1".to_string()),
            model_set: None,
            package,
        };
        let installed_entry = installed.join(format!("runtime/{executable}"));
        assert!(installed_entry.is_file());
        std::fs::write(&installed_entry, b"tampered").unwrap();
        assert!(validate_layered_component_directory(
            &installed,
            LayeredComponentKind::Engine,
            "1.0.0",
            runtime_target(),
            Some(&component),
            true,
        )
        .is_err());
        assert!(!root.join("current.json").exists());
        std::fs::remove_dir_all(&fixture).unwrap();
    }

    #[test]
    fn download_urls_are_limited_to_the_active_local_module() {
        let token = "local-module-token";
        let output: tauri::Url = format!(
            "http://127.0.0.1:18771/api/output?id=0123456789abcdef0123456789abcdef&token={token}"
        )
        .parse()
        .unwrap();
        assert_eq!(
            video_editor_download_filename(&output, 18771, token).as_deref(),
            Some("pet-transparent-0123456789abcdef0123456789abcdef.webm")
        );

        let wrong_token: tauri::Url =
            "http://127.0.0.1:18771/api/output?id=0123456789abcdef0123456789abcdef&token=wrong"
                .parse()
                .unwrap();
        assert!(video_editor_download_filename(&wrong_token, 18771, token).is_none());

        let external: tauri::Url = format!(
            "https://example.com/api/output?id=0123456789abcdef0123456789abcdef&token={token}"
        )
        .parse()
        .unwrap();
        assert!(video_editor_download_filename(&external, 18771, token).is_none());

        let inline_preview: tauri::Url = format!(
            "http://127.0.0.1:18771/api/preview?id=0123456789abcdef0123456789abcdef&token={token}"
        )
        .parse()
        .unwrap();
        assert!(video_editor_download_filename(&inline_preview, 18771, token).is_none());
        let preview_download: tauri::Url = format!(
            "http://127.0.0.1:18771/api/preview?id=0123456789abcdef0123456789abcdef&token={token}&download=1"
        )
        .parse()
        .unwrap();
        assert!(video_editor_download_filename(&preview_download, 18771, token).is_some());
    }

    #[test]
    fn interrupted_video_download_keeps_an_existing_destination() {
        use std::io::{Read, Write};

        let listener = std::net::TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = [0_u8; 1024];
            let _ = stream.read(&mut request);
            stream
                .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 100\r\n\r\npartial")
                .unwrap();
        });
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let fixture = std::env::temp_dir().join(format!(
            "cpa-video-download-{}-{unique}",
            std::process::id()
        ));
        std::fs::create_dir_all(&fixture).unwrap();
        let destination = fixture.join("existing.webm");
        std::fs::write(&destination, b"original-video").unwrap();
        let url: tauri::Url = format!("http://127.0.0.1:{port}/video.webm")
            .parse()
            .unwrap();

        let result = tauri::async_runtime::block_on(download_video_editor_file(url, &destination));
        server.join().unwrap();
        assert!(result.is_err());
        assert_eq!(std::fs::read(&destination).unwrap(), b"original-video");
        std::fs::remove_dir_all(&fixture).unwrap();
    }

    #[test]
    fn update_requires_the_video_worker_to_be_closed() {
        let state = VideoEditorModuleState::default();
        #[cfg(unix)]
        let child = std::process::Command::new("sh")
            .args(["-c", "sleep 5"])
            .spawn()
            .expect("spawn test worker");
        #[cfg(windows)]
        let child = std::process::Command::new("cmd")
            .args(["/C", "ping -n 6 127.0.0.1 >NUL"])
            .spawn()
            .expect("spawn test worker");
        *state.child.lock().expect("lock child state") = Some(child);

        assert!(ensure_module_idle_for_update(&state).is_err());
        stop_child(&state);
        assert!(ensure_module_idle_for_update(&state).is_ok());
    }

    #[cfg(unix)]
    #[test]
    fn install_archive_preserves_ffmpeg_tool_execution_permissions() {
        use std::io::Write;
        use std::os::unix::fs::PermissionsExt;
        use std::time::{SystemTime, UNIX_EPOCH};
        use zip::write::SimpleFileOptions;

        let contract = module_contract().expect("read module contract");

        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock after epoch")
            .as_nanos();
        let fixture = std::env::temp_dir().join(format!(
            "cpa-video-editor-permissions-{}-{unique}",
            std::process::id()
        ));
        let root = fixture.join("modules");
        let archive_path = fixture.join("module.zip");
        std::fs::create_dir_all(&fixture).expect("create fixture root");
        let archive_file = std::fs::File::create(&archive_path).expect("create fixture archive");
        let mut archive = zip::ZipWriter::new(archive_file);
        let file_options = SimpleFileOptions::default().unix_permissions(0o755);
        archive
            .start_file("runtime/video-editor-module", file_options)
            .expect("add module entry");
        archive.write_all(b"module").expect("write module entry");
        archive
            .start_file("runtime/bin/ffmpeg", file_options)
            .expect("add ffmpeg");
        archive.write_all(b"ffmpeg").expect("write ffmpeg");
        archive
            .start_file("runtime/bin/ffprobe", file_options)
            .expect("add ffprobe");
        archive.write_all(b"ffprobe").expect("write ffprobe");
        archive
            .start_file(
                "module.json",
                SimpleFileOptions::default().unix_permissions(0o644),
            )
            .expect("add manifest");
        archive
            .write_all(
                serde_json::to_string(&serde_json::json!({
                    "schemaVersion": contract.schema_version,
                    "id": contract.id,
                    "version": "1.0.0",
                    "target": runtime_target(),
                    "entry": "runtime/video-editor-module",
                    "capabilities": contract.capabilities,
                }))
                .expect("serialize manifest")
                .as_bytes(),
            )
            .expect("write manifest");
        archive.finish().expect("finish fixture archive");

        install_archive(&root, &archive_path, "1.0.0", runtime_target())
            .expect("install fixture archive");
        let installed = root.join(format!("1.0.0-{}", runtime_target()));
        let resolved = resolve_installed_module(&root)
            .expect("resolve legacy installation")
            .expect("legacy module is installed");
        assert_eq!(
            resolved.entry,
            installed.join("runtime/video-editor-module")
        );
        assert!(resolved.arguments.is_empty());
        assert!(resolved.environment.is_empty());
        for tool in ["ffmpeg", "ffprobe"] {
            let mode = std::fs::metadata(installed.join("runtime/bin").join(tool))
                .expect("read installed tool")
                .permissions()
                .mode();
            assert_ne!(mode & 0o111, 0, "{tool} lost its executable mode");
        }

        let entry = installed.join("runtime/video-editor-module");
        let ffmpeg = installed.join("runtime/bin/ffmpeg");
        let ffprobe = installed.join("runtime/bin/ffprobe");
        for executable in [&entry, &ffmpeg, &ffprobe] {
            std::fs::set_permissions(executable, std::fs::Permissions::from_mode(0o644))
                .expect("simulate legacy broken install");
        }
        read_installed_manifest(&root)
            .expect("repair legacy install")
            .expect("installed module remains available");
        for executable in [&entry, &ffmpeg, &ffprobe] {
            let mode = std::fs::metadata(executable)
                .expect("read repaired executable")
                .permissions()
                .mode();
            assert_ne!(mode & 0o111, 0, "legacy executable was not repaired");
        }

        std::fs::remove_dir_all(&fixture).expect("remove fixture root");
    }

    #[test]
    fn rejects_missing_capabilities_and_path_traversal() {
        let mut value = manifest();
        value
            .capabilities
            .retain(|capability| capability != "screenshot");
        assert!(validate_manifest(&value, "1.0.0", runtime_target()).is_err());
        assert!(safe_relative_path("../outside").is_err());
        assert!(safe_relative_path("/outside").is_err());
    }

    #[test]
    fn package_urls_are_restricted_to_the_release_repository() {
        assert!(validate_package_url(
            "https://github.com/UnityX103/CPA_V2/releases/download/video-editor-v1/module.zip"
        )
        .is_ok());
        assert!(validate_package_url(
            "https://cnb.cool/nanzhaigame-xpy/CPA_V2/-/releases/download/v0.1.23/module.zip"
        )
        .is_ok());
        assert!(validate_package_url(
            "https://cnb.cool/another/repo/-/releases/download/v0.1.23/module.zip"
        )
        .is_err());
        assert!(validate_package_url("https://example.com/module.zip").is_err());
    }

    #[test]
    fn module_index_prefers_cnb_and_allows_github_fallback() {
        let urls = index_urls();
        assert!(urls
            .first()
            .is_some_and(|url| url.starts_with("https://cnb.cool/")));
        assert!(validate_index_url(&urls[0]).is_ok());
        assert!(validate_index_url(
            "https://github.com/UnityX103/CPA_V2/releases/latest/download/video-editor-module-index.json"
        )
        .is_ok());
        assert!(validate_index_url(
            "https://cnb.cool/another/repo/-/releases/latest/download/video-editor-module-index.json"
        )
        .is_err());
    }

    #[test]
    fn validates_sha256_shape() {
        assert!(validate_sha256_text(&"a".repeat(64)).is_ok());
        assert!(validate_sha256_text("not-a-hash").is_err());
    }

    #[test]
    fn rejects_versions_that_can_escape_the_module_root() {
        for value in ["../victim", "/tmp", "1/../../victim", ".hidden", "1..2", ""] {
            assert!(
                validate_release_version(value).is_err(),
                "accepted {value:?}"
            );
        }
        for value in ["1.0.0", "1.0.0-beta.2", "2026.08.31+arm64"] {
            assert!(
                validate_release_version(value).is_ok(),
                "rejected {value:?}"
            );
        }
    }

    #[test]
    fn module_index_uses_the_configured_updater_public_key() {
        assert!(module_public_key().is_ok());
    }

    #[test]
    fn accepts_the_base64_wrapped_signature_emitted_by_tauri_signer() {
        let fixture = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../release-updates-arm64/stable/0.1.11/app-aarch64.tar.gz");
        let document = std::fs::read(&fixture).expect("read signed updater fixture");
        let signature = std::fs::read(fixture.with_extension("gz.sig"))
            .expect("read updater signature fixture");
        verify_index_signature(&document, &signature).expect("verify updater-format signature");
    }
}
