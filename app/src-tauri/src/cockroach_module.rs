use futures_util::StreamExt;
use minisign_verify::{PublicKey, Signature};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{Emitter, Manager};
use tokio::io::AsyncWriteExt;
use zip::ZipArchive;

#[cfg(target_os = "macos")]
#[path = "cockroach_module/macos.rs"]
mod platform;
#[cfg(target_os = "windows")]
#[path = "cockroach_module/windows.rs"]
mod platform;
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
#[path = "cockroach_module/unsupported.rs"]
mod platform;

const MODULE_ID: &str = "cpa-cockroach-electron";
const MODULE_SCHEMA_VERSION: u32 = 1;
const LEGACY_INDEX_SCHEMA_VERSION: u32 = 1;
const LAYERED_INDEX_SCHEMA_VERSION: u32 = 2;
const NONCOMMERCIAL_DISTRIBUTION: &str = "noncommercial-open-source";
const DEFAULT_INDEX_URLS: [&str; 2] = [
    "https://cnb.cool/nanzhaigame-xpy/CPA_V2/-/releases/latest/download/cockroach-module-index.json",
    "https://github.com/UnityX103/CPA_V2/releases/latest/download/cockroach-module-index.json",
];
const MODULE_PROGRESS_EVENT: &str = "cockroach-module-progress";
const MAX_ARCHIVE_BYTES: u64 = 1024 * 1024 * 1024;
const MAX_EXTRACTED_BYTES: u64 = 2 * 1024 * 1024 * 1024;
const MAX_ARCHIVE_FILES: usize = 50_000;
const MAX_INDEX_BYTES: usize = 1024 * 1024;
const MAX_SIGNATURE_BYTES: usize = 16 * 1024;

pub struct CockroachModuleState {
    child: Mutex<Option<Child>>,
    next_control_nonce: AtomicU64,
}

impl Default for CockroachModuleState {
    fn default() -> Self {
        Self {
            child: Mutex::new(None),
            next_control_nonce: AtomicU64::new(1),
        }
    }
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CockroachModuleStatus {
    installed: bool,
    running: bool,
    version: Option<String>,
    target: String,
    message: String,
    settings: CockroachModuleSettings,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CockroachModuleSettings {
    max_count: u32,
    baby_growth_minutes: u32,
}

impl Default for CockroachModuleSettings {
    fn default() -> Self {
        Self {
            max_count: 30,
            baby_growth_minutes: 10,
        }
    }
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
    distribution: String,
    logic: ComponentPackage,
    dependencies: ComponentPackage,
    runtimes: HashMap<String, ComponentPackage>,
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
    runtime_abi: String,
    #[serde(default)]
    dependency_set: Option<String>,
    #[serde(default)]
    platform_signature: Option<String>,
    #[serde(default)]
    acceptance_receipt_sha256: Option<String>,
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
    runtime: InstalledComponentPointer,
    dependencies: InstalledComponentPointer,
    logic: InstalledComponentPointer,
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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeManifest {
    schema_version: u32,
    #[serde(rename = "type")]
    component_type: String,
    version: String,
    target: String,
    runtime_abi: String,
    entry: String,
    runtime_root: String,
    distribution: String,
    platform_signature: String,
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
    runtime_abi: String,
    dependency_set: String,
    module_root: String,
    distribution: String,
    capabilities: Vec<String>,
    files: Vec<ComponentFile>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DependenciesManifest {
    schema_version: u32,
    #[serde(rename = "type")]
    component_type: String,
    version: String,
    dependency_set: String,
    dependency_root: String,
    distribution: String,
    files: Vec<ComponentFile>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ComponentFile {
    path: String,
    size: u64,
    sha256: String,
    #[serde(default)]
    link_target: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct InstalledArtifact {
    schema_version: u32,
    sha256: String,
    size: u64,
}

#[derive(Debug, Clone)]
struct ResolvedCockroachModule {
    version: String,
    target: String,
    runtime_version: String,
    dependencies_version: String,
    entry: PathBuf,
    working_directory: PathBuf,
    arguments: Vec<String>,
    environment: HashMap<String, String>,
}

#[derive(Debug, Clone, Copy)]
enum LayeredComponentKind {
    Runtime,
    Dependencies,
    Logic,
}

impl LayeredComponentKind {
    fn label(self) -> &'static str {
        match self {
            Self::Runtime => "基础运行时",
            Self::Dependencies => "通用依赖",
            Self::Logic => "业务逻辑",
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
            Self::Runtime => format!("runtimes/{version}-{target}-{artifact}"),
            Self::Dependencies => format!("dependencies/{version}-{artifact}"),
            Self::Logic => format!("logic/{version}-{artifact}"),
        })
    }

    fn manifest_name(self) -> &'static str {
        match self {
            Self::Runtime => "runtime.json",
            Self::Dependencies => "dependencies.json",
            Self::Logic => "module.json",
        }
    }
}

fn runtime_target() -> &'static str {
    platform::runtime_target()
}

fn parse_module_index(bytes: &[u8]) -> Result<ModuleIndexDocument, String> {
    let value: serde_json::Value =
        serde_json::from_slice(bytes).map_err(|error| format!("无法解析蟑螂模块清单：{error}"))?;
    match value
        .get("schemaVersion")
        .and_then(serde_json::Value::as_u64)
    {
        Some(version) if version == LEGACY_INDEX_SCHEMA_VERSION as u64 => {
            serde_json::from_value(value)
                .map(ModuleIndexDocument::Legacy)
                .map_err(|error| format!("无法解析旧版蟑螂模块清单：{error}"))
        }
        Some(version) if version == LAYERED_INDEX_SCHEMA_VERSION as u64 => {
            serde_json::from_value(value)
                .map(Box::new)
                .map(ModuleIndexDocument::Layered)
                .map_err(|error| format!("无法解析分层蟑螂模块清单：{error}"))
        }
        _ => Err("蟑螂模块索引版本不兼容".to_string()),
    }
}

fn index_urls() -> Vec<String> {
    #[cfg(debug_assertions)]
    if let Ok(url) = std::env::var("CPA_COCKROACH_MODULE_INDEX_URL") {
        if !url.trim().is_empty() {
            return vec![url];
        }
    }
    if let Some(url) = option_env!("CPA_COCKROACH_MODULE_INDEX_URL") {
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
        .map(|path| path.join("modules").join("cockroach-electron"))
        .map_err(|error| format!("无法打开蟑螂模块目录：{error}"))
}

fn pointer_path(root: &Path) -> PathBuf {
    root.join("current.json")
}

fn read_pointer(root: &Path) -> Result<Option<InstalledPointer>, String> {
    let path = pointer_path(root);
    if !path.is_file() {
        return Ok(None);
    }
    let bytes = fs::read(&path).map_err(|error| format!("无法读取蟑螂模块状态：{error}"))?;
    let pointer: InstalledPointer =
        serde_json::from_slice(&bytes).map_err(|error| format!("蟑螂模块状态损坏：{error}"))?;
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
        return Err("已安装蟑螂模块与当前平台不匹配，请重新下载".to_string());
    }
    let expected_directory = format!("{}-{}", pointer.version, pointer.target);
    if pointer.directory != expected_directory {
        return Err("已安装蟑螂模块目录无效，请重新下载".to_string());
    }
    let directory = root.join(safe_relative_path(&pointer.directory)?);
    let manifest_path = directory.join("module.json");
    if !manifest_path.is_file() {
        return Err("蟑螂模块清单缺失，请重新下载".to_string());
    }
    let manifest: ModuleManifest = serde_json::from_slice(
        &fs::read(&manifest_path).map_err(|error| format!("无法读取蟑螂模块清单：{error}"))?,
    )
    .map_err(|error| format!("蟑螂模块清单损坏：{error}"))?;
    validate_manifest(&manifest, &pointer.version, runtime_target())?;
    let entry = safe_relative_path(&manifest.entry)?;
    if !directory.join(entry).is_file() {
        return Err("蟑螂模块启动文件缺失，请重新下载".to_string());
    }
    Ok(Some((pointer, manifest)))
}

fn resolve_installed_module(root: &Path) -> Result<Option<ResolvedCockroachModule>, String> {
    let path = pointer_path(root);
    if !path.is_file() {
        return Ok(None);
    }
    let bytes = fs::read(&path).map_err(|error| format!("无法读取蟑螂模块状态：{error}"))?;
    let value: serde_json::Value =
        serde_json::from_slice(&bytes).map_err(|error| format!("蟑螂模块状态损坏：{error}"))?;
    if value
        .get("schemaVersion")
        .and_then(serde_json::Value::as_u64)
        == Some(LAYERED_INDEX_SCHEMA_VERSION as u64)
    {
        let pointer: LayeredInstalledPointer = serde_json::from_value(value)
            .map_err(|error| format!("分层蟑螂模块状态损坏：{error}"))?;
        return resolve_layered_module(root, pointer).map(Some);
    }
    let Some((pointer, manifest)) = read_installed_manifest(root)? else {
        return Ok(None);
    };
    let working_directory = root.join(safe_relative_path(&pointer.directory)?);
    let entry = working_directory.join(safe_relative_path(&manifest.entry)?);
    Ok(Some(ResolvedCockroachModule {
        version: pointer.version.clone(),
        target: pointer.target,
        runtime_version: pointer.version,
        dependencies_version: manifest.version.clone(),
        entry,
        working_directory,
        arguments: Vec::new(),
        environment: HashMap::new(),
    }))
}

fn resolve_layered_module(
    root: &Path,
    pointer: LayeredInstalledPointer,
) -> Result<ResolvedCockroachModule, String> {
    if pointer.schema_version != LAYERED_INDEX_SCHEMA_VERSION {
        return Err("分层蟑螂模块状态版本不兼容".to_string());
    }
    validate_release_version(&pointer.version)?;
    validate_release_version(&pointer.runtime.version)?;
    validate_release_version(&pointer.dependencies.version)?;
    validate_release_version(&pointer.logic.version)?;
    if pointer.target != runtime_target() {
        return Err("已安装蟑螂模块与当前平台不匹配，请重新下载".to_string());
    }
    if pointer.version != pointer.logic.version {
        return Err("分层蟑螂模块业务版本不一致".to_string());
    }
    let runtime_directory = resolve_component_directory(
        root,
        &pointer.runtime,
        LayeredComponentKind::Runtime,
        &pointer.target,
    )?;
    let logic_directory = resolve_component_directory(
        root,
        &pointer.logic,
        LayeredComponentKind::Logic,
        &pointer.target,
    )?;
    let dependencies_directory = resolve_component_directory(
        root,
        &pointer.dependencies,
        LayeredComponentKind::Dependencies,
        &pointer.target,
    )?;
    let runtime: RuntimeManifest =
        read_json_manifest(&runtime_directory.join("runtime.json"), "基础运行时")?;
    let logic: LogicManifest =
        read_json_manifest(&logic_directory.join("module.json"), "业务逻辑")?;
    let dependencies: DependenciesManifest = read_json_manifest(
        &dependencies_directory.join("dependencies.json"),
        "通用依赖",
    )?;
    validate_layered_manifests(&pointer, &runtime, &dependencies, &logic)?;
    let entry = join_relative(&runtime_directory, &runtime.entry)?;
    let runtime_root = join_relative(&runtime_directory, &runtime.runtime_root)?;
    let module_root = join_relative(&logic_directory, &logic.module_root)?;
    let dependency_root = join_relative(&dependencies_directory, &dependencies.dependency_root)?;
    if !entry.is_file()
        || !runtime_root.is_dir()
        || !dependency_root.is_dir()
        || !module_root.join("main.js").is_file()
    {
        return Err("分层蟑螂模块文件不完整，请重新下载".to_string());
    }
    platform::ensure_entry_executable(&entry)?;
    let mut environment = HashMap::new();
    environment.insert(
        "CPA_COCKROACH_DEPENDENCY_ROOT".to_string(),
        dependency_root.to_string_lossy().into_owned(),
    );
    Ok(ResolvedCockroachModule {
        version: pointer.version,
        target: pointer.target,
        runtime_version: pointer.runtime.version,
        dependencies_version: pointer.dependencies.version,
        entry,
        working_directory: module_root.clone(),
        arguments: vec![module_root.to_string_lossy().into_owned()],
        environment,
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
        read_json_manifest(&directory.join(".artifact.json"), "组件来源")?;
    if artifact.schema_version != 1 || artifact.size == 0 {
        return Err("已安装蟑螂组件来源无效".to_string());
    }
    let expected = kind.directory(&pointer.version, target, &artifact.sha256)?;
    if pointer.directory != expected {
        return Err("分层蟑螂模块目录与组件哈希不匹配".to_string());
    }
    Ok(directory)
}

fn read_json_manifest<T: for<'de> Deserialize<'de>>(path: &Path, label: &str) -> Result<T, String> {
    let bytes = fs::read(path).map_err(|error| format!("蟑螂模块{label}清单缺失：{error}"))?;
    serde_json::from_slice(&bytes).map_err(|error| format!("蟑螂模块{label}清单损坏：{error}"))
}

fn validate_layered_manifests(
    pointer: &LayeredInstalledPointer,
    runtime: &RuntimeManifest,
    dependencies: &DependenciesManifest,
    logic: &LogicManifest,
) -> Result<(), String> {
    if runtime.schema_version != 1
        || dependencies.schema_version != 1
        || logic.schema_version != LAYERED_INDEX_SCHEMA_VERSION
        || runtime.component_type != "runtime"
        || dependencies.component_type != "dependencies"
        || logic.component_type != "logic"
        || runtime.distribution != NONCOMMERCIAL_DISTRIBUTION
        || dependencies.distribution != NONCOMMERCIAL_DISTRIBUTION
        || logic.distribution != NONCOMMERCIAL_DISTRIBUTION
    {
        return Err("分层蟑螂模块清单版本或分发许可不兼容".to_string());
    }
    if runtime.version != pointer.runtime.version
        || dependencies.version != pointer.dependencies.version
        || logic.version != pointer.logic.version
        || runtime.target != pointer.target
        || runtime.runtime_abi != logic.runtime_abi
        || dependencies.dependency_set != logic.dependency_set
    {
        return Err("分层蟑螂模块组件版本、平台或 ABI 不匹配".to_string());
    }
    if logic.id != MODULE_ID || missing_capabilities(&logic.capabilities) {
        return Err("蟑螂模块业务包缺少必需能力".to_string());
    }
    safe_relative_path(&runtime.entry)?;
    safe_relative_path(&runtime.runtime_root)?;
    safe_relative_path(&dependencies.dependency_root)?;
    safe_relative_path(&logic.module_root)?;
    Ok(())
}

fn missing_capabilities(capabilities: &[String]) -> bool {
    [
        "electron-vector-cockroach-v1",
        "max-count",
        "baby-growth-minutes",
        "process-lifecycle",
        "process-control-file-v1",
    ]
    .iter()
    .any(|required| !capabilities.iter().any(|value| value == required))
}

fn join_relative(root: &Path, value: &str) -> Result<PathBuf, String> {
    Ok(root.join(safe_relative_path(value)?))
}

fn validate_manifest(
    manifest: &ModuleManifest,
    expected_version: &str,
    expected_target: &str,
) -> Result<(), String> {
    if manifest.schema_version != MODULE_SCHEMA_VERSION {
        return Err("蟑螂模块清单版本不兼容".to_string());
    }
    if manifest.id != MODULE_ID {
        return Err("下载包不是 CPA 蟑螂模块".to_string());
    }
    if manifest.version != expected_version || manifest.target != expected_target {
        return Err("蟑螂模块版本或平台与当前安装包不匹配".to_string());
    }
    if missing_capabilities(&manifest.capabilities) {
        return Err("蟑螂模块缺少必需能力".to_string());
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
        return Err("蟑螂模块包含不安全路径".to_string());
    }
    Ok(path.to_path_buf())
}

fn safe_symlink_target(value: &str) -> Result<PathBuf, String> {
    let path = Path::new(value);
    if value.is_empty()
        || value.len() > 4096
        || path.is_absolute()
        || path.components().any(|component| {
            matches!(
                component,
                std::path::Component::ParentDir
                    | std::path::Component::RootDir
                    | std::path::Component::Prefix(_)
            )
        })
    {
        return Err("蟑螂组件包含不安全符号链接".to_string());
    }
    Ok(path.to_path_buf())
}

fn validate_package_url(value: &str) -> Result<(), String> {
    let url = reqwest::Url::parse(value).map_err(|_| "蟑螂模块下载地址无效".to_string())?;
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
    Err("蟑螂模块下载地址不在允许的发布源中".to_string())
}

fn validate_index_url(value: &str) -> Result<(), String> {
    let url = reqwest::Url::parse(value).map_err(|_| "蟑螂模块索引地址无效".to_string())?;
    let github = url.host_str() == Some("github.com")
        && url.path().starts_with("/UnityX103/CPA_V2/releases/");
    let cnb = url.host_str() == Some("cnb.cool")
        && url
            .path()
            .starts_with("/nanzhaigame-xpy/CPA_V2/-/releases/");
    if url.scheme() == "https"
        && (github || cnb)
        && url.path().ends_with("/cockroach-module-index.json")
    {
        return Ok(());
    }
    #[cfg(debug_assertions)]
    if matches!(url.scheme(), "http" | "https") && url.host_str() == Some("127.0.0.1") {
        return Ok(());
    }
    Err("蟑螂模块索引地址不在允许的发布源中".to_string())
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
        return Err("蟑螂模块版本号无效".to_string());
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
    if response.status() == reqwest::StatusCode::NOT_FOUND && label == "蟑螂模块索引" {
        return Err("蟑螂模块尚未开放下载：当前没有通过许可与目标平台验收的发布包".to_string());
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
            let index =
                download_small_document(client, &index_url, MAX_INDEX_BYTES, "蟑螂模块索引")
                    .await?;
            let signature = download_small_document(
                client,
                &format!("{index_url}.sig"),
                MAX_SIGNATURE_BYTES,
                "蟑螂模块索引签名",
            )
            .await?;
            verify_index_signature(&index, &signature)?;
            Ok::<Vec<u8>, String>(index)
        }
        .await;
        match result {
            Ok(index) => return Ok(index),
            Err(error) => failures.push(error),
        }
    }
    Err(format!(
        "无法从发布镜像获取蟑螂模块：{}",
        failures.join("；")
    ))
}

async fn download_package_archive(
    client: &reqwest::Client,
    app: &tauri::AppHandle,
    package: &ModulePackage,
    archive_path: &Path,
    message: &str,
) -> Result<(u64, Option<u64>), String> {
    let mut failures = Vec::new();
    for (position, url) in std::iter::once(&package.url)
        .chain(package.mirrors.iter())
        .enumerate()
    {
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
                .map_err(|error| format!("蟑螂模块下载失败：{error}"))?
                .error_for_status()
                .map_err(|error| format!("蟑螂模块下载请求失败：{error}"))?;
            let content_length = response.content_length().or(Some(package.size));
            if content_length.is_some_and(|length| length > package.size) {
                return Err("蟑螂模块响应大小超过清单大小".to_string());
            }
            let mut stream = response.bytes_stream();
            let mut file = tokio::fs::File::create(archive_path)
                .await
                .map_err(|error| format!("无法创建蟑螂模块下载文件：{error}"))?;
            let mut hasher = Sha256::new();
            let mut downloaded = 0_u64;
            while let Some(chunk) = stream.next().await {
                let chunk = chunk.map_err(|error| format!("蟑螂模块下载中断：{error}"))?;
                downloaded = downloaded
                    .checked_add(chunk.len() as u64)
                    .ok_or_else(|| "蟑螂模块下载大小溢出".to_string())?;
                if downloaded > MAX_ARCHIVE_BYTES || downloaded > package.size {
                    return Err("蟑螂模块下载超过清单大小".to_string());
                }
                hasher.update(&chunk);
                file.write_all(&chunk)
                    .await
                    .map_err(|error| format!("无法保存蟑螂模块：{error}"))?;
                emit_progress(app, "download", downloaded, content_length, message);
            }
            file.flush()
                .await
                .map_err(|error| format!("无法写入蟑螂模块：{error}"))?;
            drop(file);
            if downloaded != package.size {
                return Err("蟑螂模块下载大小与清单不一致".to_string());
            }
            if format!("{:x}", hasher.finalize()) != package.sha256.to_ascii_lowercase() {
                return Err("蟑螂模块 SHA-256 校验失败".to_string());
            }
            Ok::<(u64, Option<u64>), String>((downloaded, content_length))
        }
        .await;
        match result {
            Ok(value) => return Ok(value),
            Err(error) => {
                let _ = tokio::fs::remove_file(archive_path).await;
                failures.push(error);
            }
        }
    }
    Err(format!(
        "所有蟑螂模块下载源均不可用：{}",
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
        .map_err(|error| format!("蟑螂模块索引签名校验失败：{error}"))
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

fn validate_settings(settings: &CockroachModuleSettings) -> Result<(), String> {
    if !(1..=99).contains(&settings.max_count) {
        return Err("最大蟑螂数量必须在 1 到 99 之间".to_string());
    }
    if !(1..=60).contains(&settings.baby_growth_minutes) {
        return Err("幼虫成长时间必须在 1 到 60 分钟之间".to_string());
    }
    Ok(())
}

fn module_data_dir(root: &Path) -> PathBuf {
    root.join("data")
}

fn upstream_config_path(root: &Path) -> PathBuf {
    module_data_dir(root).join("config.json")
}

fn control_file_path(root: &Path) -> PathBuf {
    module_data_dir(root).join("cpa-control.json")
}

fn control_ack_path(root: &Path) -> PathBuf {
    module_data_dir(root).join("cpa-control.ack.json")
}

fn read_settings(root: &Path) -> CockroachModuleSettings {
    let Ok(bytes) = fs::read(upstream_config_path(root)) else {
        return CockroachModuleSettings::default();
    };
    serde_json::from_slice::<serde_json::Value>(&bytes)
        .ok()
        .and_then(|value| value.get("settings").cloned())
        .and_then(|value| serde_json::from_value(value).ok())
        .filter(|settings| validate_settings(settings).is_ok())
        .unwrap_or_default()
}

fn write_upstream_config(
    root: &Path,
    settings: &CockroachModuleSettings,
    clear_cockroaches: bool,
) -> Result<(), String> {
    validate_settings(settings)?;
    let data_dir = module_data_dir(root);
    fs::create_dir_all(&data_dir).map_err(|error| format!("无法创建蟑螂模块数据目录：{error}"))?;
    let path = upstream_config_path(root);
    let mut value = fs::read(&path)
        .ok()
        .and_then(|bytes| serde_json::from_slice::<serde_json::Value>(&bytes).ok())
        .filter(serde_json::Value::is_object)
        .unwrap_or_else(|| serde_json::json!({}));
    let object = value.as_object_mut().expect("object checked above");
    if clear_cockroaches || !object.contains_key("cockroaches") {
        object.insert("cockroaches".to_string(), serde_json::json!([]));
    }
    object.insert(
        "settings".to_string(),
        serde_json::to_value(settings).map_err(|error| error.to_string())?,
    );
    let temporary = data_dir.join(".config.json.tmp");
    fs::write(
        &temporary,
        serde_json::to_vec_pretty(&value).map_err(|error| error.to_string())?,
    )
    .map_err(|error| format!("无法保存蟑螂模块设置：{error}"))?;
    fs::rename(&temporary, &path).map_err(|error| format!("无法激活蟑螂模块设置：{error}"))?;
    Ok(())
}

fn child_is_running(state: &CockroachModuleState) -> bool {
    let Ok(mut guard) = state.child.lock() else {
        return false;
    };
    let exited = guard
        .as_mut()
        .and_then(|child| child.try_wait().ok())
        .flatten()
        .is_some();
    if exited {
        guard.take();
    }
    guard.is_some()
}

#[tauri::command]
pub fn cockroach_module_status(
    app: tauri::AppHandle,
    state: tauri::State<'_, CockroachModuleState>,
) -> CockroachModuleStatus {
    let target = runtime_target().to_string();
    let root = module_root(&app);
    let settings = root
        .as_ref()
        .map(|root| read_settings(root))
        .unwrap_or_default();
    let running = child_is_running(&state);
    let result = root.and_then(|root| resolve_installed_module(&root));
    match result {
        Ok(Some(resolved)) => CockroachModuleStatus {
            installed: true,
            running,
            version: Some(resolved.version),
            target,
            message: "蟑螂模块已下载".to_string(),
            settings,
        },
        Ok(None) => CockroachModuleStatus {
            installed: false,
            running: false,
            version: None,
            target,
            message: "蟑螂模块尚未下载".to_string(),
            settings,
        },
        Err(error) => CockroachModuleStatus {
            installed: false,
            running: false,
            version: None,
            target,
            message: error,
            settings,
        },
    }
}

#[tauri::command]
pub async fn download_cockroach_module(
    app: tauri::AppHandle,
    state: tauri::State<'_, CockroachModuleState>,
) -> Result<CockroachModuleStatus, String> {
    let target = runtime_target();
    if target == "unsupported" {
        return Err("当前平台不支持蟑螂模块".to_string());
    }
    emit_progress(&app, "index", 0, None, "正在检查蟑螂模块版本");
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::limited(5))
        .timeout(Duration::from_secs(60 * 60))
        .build()
        .map_err(|error| format!("无法创建下载客户端：{error}"))?;
    let index = download_verified_index(&client).await?;
    match parse_module_index(&index)? {
        ModuleIndexDocument::Legacy(index) => {
            download_legacy_module(&app, &state, &client, index, target).await
        }
        ModuleIndexDocument::Layered(index) => {
            download_layered_module(&app, &state, &client, *index, target).await
        }
    }
}

async fn download_legacy_module(
    app: &tauri::AppHandle,
    state: &CockroachModuleState,
    client: &reqwest::Client,
    index: LegacyModuleIndex,
    target: &'static str,
) -> Result<CockroachModuleStatus, String> {
    if index.schema_version != LEGACY_INDEX_SCHEMA_VERSION {
        return Err("蟑螂模块索引版本不兼容".to_string());
    }
    if index.debug_only && !cfg!(debug_assertions) {
        return Err("正式应用不能安装内部测试蟑螂模块".to_string());
    }
    validate_release_version(&index.version)?;
    let root = module_root(app)?;
    if let Ok(Some(resolved)) = resolve_installed_module(&root) {
        if resolved.version == index.version {
            return Ok(CockroachModuleStatus {
                installed: true,
                running: child_is_running(state),
                version: Some(resolved.version),
                target: target.to_string(),
                message: "蟑螂模块已是最新版本".to_string(),
                settings: read_settings(&root),
            });
        }
    }
    let package = index
        .packages
        .get(target)
        .cloned()
        .ok_or_else(|| format!("当前发布尚未提供 {target} 蟑螂模块"))?;
    validate_package(&package)?;
    stop_child(state);
    fs::create_dir_all(&root).map_err(|error| format!("无法创建蟑螂模块目录：{error}"))?;
    let archive_path = root.join(format!(".download-{}-{target}.zip", index.version));
    let (downloaded, content_length) =
        download_package_archive(client, app, &package, &archive_path, "正在下载蟑螂模块").await?;

    emit_progress(
        app,
        "install",
        downloaded,
        content_length,
        "正在安装蟑螂模块",
    );
    let version = index.version.clone();
    let archive_for_install = archive_path.clone();
    let root_for_install = root.clone();
    tauri::async_runtime::spawn_blocking(move || {
        install_archive(&root_for_install, &archive_for_install, &version, target)
    })
    .await
    .map_err(|error| format!("蟑螂模块安装任务异常结束：{error}"))??;
    let _ = tokio::fs::remove_file(&archive_path).await;
    emit_progress(
        app,
        "complete",
        downloaded,
        content_length,
        "蟑螂模块下载完成",
    );
    Ok(cockroach_module_status(app.clone(), app.state()))
}

fn validate_layered_index(
    index: &LayeredModuleIndex,
    target: &str,
) -> Result<ComponentPackage, String> {
    if index.schema_version != LAYERED_INDEX_SCHEMA_VERSION {
        return Err("分层蟑螂模块索引版本不兼容".to_string());
    }
    if index.distribution != NONCOMMERCIAL_DISTRIBUTION {
        return Err("蟑螂模块发布必须采用非商业开源学习许可".to_string());
    }
    validate_release_version(&index.version)?;
    validate_release_version(&index.logic.version)?;
    validate_release_version(&index.dependencies.version)?;
    if index.version != index.logic.version {
        return Err("分层蟑螂模块索引业务版本不一致".to_string());
    }
    let runtime = index
        .runtimes
        .get(target)
        .cloned()
        .ok_or_else(|| format!("当前发布尚未提供 {target} 蟑螂基础运行时"))?;
    for component in [&index.logic, &index.dependencies, &runtime] {
        validate_release_version(&component.version)?;
        validate_sha256_text(&component.manifest_sha256)?;
        validate_package(&component.package)?;
    }
    if index.logic.runtime_abi.trim().is_empty() || index.logic.runtime_abi != runtime.runtime_abi {
        return Err("蟑螂业务逻辑与基础运行时 ABI 不兼容".to_string());
    }
    let logic_dependencies = index
        .logic
        .dependency_set
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "蟑螂业务逻辑索引缺少 dependencySet".to_string())?;
    if index.dependencies.dependency_set.as_deref() != Some(logic_dependencies) {
        return Err("蟑螂业务逻辑与通用依赖版本不兼容".to_string());
    }
    if runtime
        .platform_signature
        .as_deref()
        .is_none_or(|value| value.trim().is_empty())
    {
        return Err("蟑螂基础运行时缺少平台验收信息".to_string());
    }
    let receipt = runtime
        .acceptance_receipt_sha256
        .as_deref()
        .ok_or_else(|| "蟑螂基础运行时缺少目标平台验收回执".to_string())?;
    validate_sha256_text(receipt)?;
    Ok(runtime)
}

async fn download_layered_module(
    app: &tauri::AppHandle,
    state: &CockroachModuleState,
    client: &reqwest::Client,
    index: LayeredModuleIndex,
    target: &'static str,
) -> Result<CockroachModuleStatus, String> {
    if index.debug_only && !cfg!(debug_assertions) {
        return Err("正式应用不能安装内部测试蟑螂模块".to_string());
    }
    let runtime = validate_layered_index(&index, target)?;
    let root = module_root(app)?;
    if layered_installation_matches_index(&root, &index, &runtime, target)? {
        return Ok(CockroachModuleStatus {
            installed: true,
            running: child_is_running(state),
            version: Some(index.version.clone()),
            target: target.to_string(),
            message: "蟑螂模块已是最新版本".to_string(),
            settings: read_settings(&root),
        });
    }
    stop_child(state);
    fs::create_dir_all(&root).map_err(|error| format!("无法创建蟑螂模块目录：{error}"))?;
    let mut downloaded = 0_u64;
    downloaded += ensure_layered_component(
        app,
        client,
        &root,
        LayeredComponentKind::Runtime,
        &runtime,
        target,
    )
    .await?;
    downloaded += ensure_layered_component(
        app,
        client,
        &root,
        LayeredComponentKind::Dependencies,
        &index.dependencies,
        target,
    )
    .await?;
    downloaded += ensure_layered_component(
        app,
        client,
        &root,
        LayeredComponentKind::Logic,
        &index.logic,
        target,
    )
    .await?;
    let version = index.version.clone();
    let root_for_activation = root.clone();
    tauri::async_runtime::spawn_blocking(move || {
        activate_layered_installation(&root_for_activation, &index, target)
    })
    .await
    .map_err(|error| format!("蟑螂模块激活任务异常结束：{error}"))??;
    emit_progress(
        app,
        "complete",
        downloaded,
        None,
        &format!("蟑螂模块 {version} 下载完成"),
    );
    Ok(cockroach_module_status(app.clone(), app.state()))
}

fn validate_package(package: &ModulePackage) -> Result<(), String> {
    validate_package_url(&package.url)?;
    for mirror in &package.mirrors {
        validate_package_url(mirror)?;
    }
    if package.size == 0 || package.size > MAX_ARCHIVE_BYTES {
        return Err("蟑螂模块下载大小无效".to_string());
    }
    validate_sha256_text(&package.sha256)
}

fn layered_installation_matches_index(
    root: &Path,
    index: &LayeredModuleIndex,
    runtime: &ComponentPackage,
    target: &str,
) -> Result<bool, String> {
    let resolved = match resolve_installed_module(root) {
        Ok(Some(value)) => value,
        Ok(None) | Err(_) => return Ok(false),
    };
    if resolved.version != index.logic.version
        || resolved.runtime_version != runtime.version
        || resolved.dependencies_version != index.dependencies.version
        || resolved.target != target
    {
        return Ok(false);
    }
    for (kind, component) in [
        (LayeredComponentKind::Runtime, runtime),
        (LayeredComponentKind::Dependencies, &index.dependencies),
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

async fn ensure_layered_component(
    app: &tauri::AppHandle,
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
            &format!("蟑螂{}已存在，跳过下载", kind.label()),
        );
        return Ok(0);
    }
    let archive_path = root.join(format!(
        ".download-{}-{}-{target}.zip",
        match kind {
            LayeredComponentKind::Runtime => "runtime",
            LayeredComponentKind::Dependencies => "dependencies",
            LayeredComponentKind::Logic => "logic",
        },
        component.version
    ));
    emit_progress(
        app,
        "download",
        0,
        Some(component.package.size),
        &format!("正在下载蟑螂{}", kind.label()),
    );
    let (downloaded, content_length) = download_package_archive(
        client,
        app,
        &component.package,
        &archive_path,
        &format!("正在下载蟑螂{}", kind.label()),
    )
    .await?;
    emit_progress(
        app,
        "install",
        downloaded,
        content_length,
        &format!("正在安装蟑螂{}", kind.label()),
    );
    let root_for_install = root.to_path_buf();
    let archive_for_install = archive_path.clone();
    let version = component.version.clone();
    let package = component.package.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
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
    .map_err(|error| format!("蟑螂组件安装任务异常结束：{error}"));
    let _ = tokio::fs::remove_file(&archive_path).await;
    result??;
    Ok(downloaded)
}

fn activate_layered_installation(
    root: &Path,
    index: &LayeredModuleIndex,
    target: &str,
) -> Result<(), String> {
    let runtime = validate_layered_index(index, target)?;
    let pointer = LayeredInstalledPointer {
        schema_version: LAYERED_INDEX_SCHEMA_VERSION,
        version: index.version.clone(),
        target: target.to_string(),
        runtime: InstalledComponentPointer {
            version: runtime.version.clone(),
            directory: LayeredComponentKind::Runtime.directory(
                &runtime.version,
                target,
                &runtime.package.sha256,
            )?,
        },
        dependencies: InstalledComponentPointer {
            version: index.dependencies.version.clone(),
            directory: LayeredComponentKind::Dependencies.directory(
                &index.dependencies.version,
                target,
                &index.dependencies.package.sha256,
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
    write_pointer_atomically(
        root,
        &serde_json::to_vec_pretty(&pointer)
            .map_err(|error| format!("无法序列化蟑螂模块状态：{error}"))?,
    )
}

fn write_pointer_atomically(root: &Path, bytes: &[u8]) -> Result<(), String> {
    fs::create_dir_all(root).map_err(|error| format!("无法创建蟑螂模块目录：{error}"))?;
    let temporary = root.join(format!(".current-{}.tmp", std::process::id()));
    let result = (|| {
        let mut file =
            fs::File::create(&temporary).map_err(|error| format!("无法保存模块状态：{error}"))?;
        file.write_all(bytes)
            .map_err(|error| format!("无法保存模块状态：{error}"))?;
        file.sync_all()
            .map_err(|error| format!("无法同步模块状态：{error}"))?;
        drop(file);
        fs::rename(&temporary, pointer_path(root))
            .map_err(|error| format!("无法激活蟑螂模块：{error}"))
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

fn validate_sha256_text(value: &str) -> Result<(), String> {
    if value.len() != 64 || !value.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err("蟑螂模块 SHA-256 清单无效".to_string());
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
    let archive_file =
        fs::File::open(archive_path).map_err(|error| format!("无法打开蟑螂模块压缩包：{error}"))?;
    let mut archive =
        ZipArchive::new(archive_file).map_err(|error| format!("蟑螂模块压缩包损坏：{error}"))?;
    if archive.len() > MAX_ARCHIVE_FILES {
        return Err("蟑螂模块文件数量超过限制".to_string());
    }
    let mut extracted = 0_u64;
    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|error| format!("无法读取模块压缩包条目：{error}"))?;
        let enclosed = entry
            .enclosed_name()
            .ok_or_else(|| "蟑螂模块压缩包包含不安全路径".to_string())?
            .to_path_buf();
        if entry
            .unix_mode()
            .is_some_and(|mode| mode & 0o170000 == 0o120000)
        {
            return Err("蟑螂模块压缩包不允许符号链接".to_string());
        }
        extracted = extracted
            .checked_add(entry.size())
            .ok_or_else(|| "蟑螂模块解压大小溢出".to_string())?;
        if extracted > MAX_EXTRACTED_BYTES {
            return Err("蟑螂模块解压大小超过限制".to_string());
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
        platform::restore_archive_permissions(&output, entry.unix_mode())?;
    }
    let manifest: ModuleManifest = serde_json::from_slice(
        &fs::read(staging.join("module.json")).map_err(|error| format!("模块清单缺失：{error}"))?,
    )
    .map_err(|error| format!("模块清单无效：{error}"))?;
    validate_manifest(&manifest, version, target)?;
    let entry = staging.join(safe_relative_path(&manifest.entry)?);
    if !entry.is_file() {
        return Err("模块启动文件缺失".to_string());
    }
    platform::ensure_entry_executable(&entry)?;
    let directory = format!("{version}-{target}");
    let installed_dir = root.join(&directory);
    if installed_dir.exists() {
        fs::remove_dir_all(&installed_dir)
            .map_err(|error| format!("无法替换旧蟑螂模块：{error}"))?;
    }
    fs::rename(&staging, &installed_dir)
        .map_err(|error| format!("无法完成蟑螂模块安装：{error}"))?;
    let pointer = InstalledPointer {
        version: version.to_string(),
        target: target.to_string(),
        directory,
    };
    let temporary_pointer = root.join(".current.json.tmp");
    fs::write(
        &temporary_pointer,
        serde_json::to_vec_pretty(&pointer).map_err(|error| error.to_string())?,
    )
    .map_err(|error| format!("无法保存模块状态：{error}"))?;
    fs::rename(&temporary_pointer, pointer_path(root))
        .map_err(|error| format!("无法激活蟑螂模块：{error}"))?;
    Ok(())
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
    let staging = root.join(format!(
        ".staging-{}-{version}-{target}",
        match kind {
            LayeredComponentKind::Runtime => "runtime",
            LayeredComponentKind::Dependencies => "dependencies",
            LayeredComponentKind::Logic => "logic",
        }
    ));
    if staging.exists() {
        fs::remove_dir_all(&staging).map_err(|error| format!("无法清理组件暂存目录：{error}"))?;
    }
    fs::create_dir_all(&staging).map_err(|error| format!("无法创建组件暂存目录：{error}"))?;
    let result = (|| {
        extract_archive_to(archive_path, &staging)?;
        validate_layered_component_directory(&staging, kind, version, target, None, true)?;
        validate_sha256_text(&package.sha256)?;
        fs::write(
            staging.join(".artifact.json"),
            serde_json::to_vec_pretty(&InstalledArtifact {
                schema_version: 1,
                sha256: package.sha256.to_ascii_lowercase(),
                size: package.size,
            })
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
                .map_err(|error| format!("无法替换旧蟑螂组件：{error}"))?;
        }
        fs::rename(&staging, &installed).map_err(|error| format!("无法完成蟑螂组件安装：{error}"))
    })();
    if result.is_err() && staging.exists() {
        let _ = fs::remove_dir_all(&staging);
    }
    result
}

fn extract_archive_to(archive_path: &Path, staging: &Path) -> Result<(), String> {
    let archive_file =
        fs::File::open(archive_path).map_err(|error| format!("无法打开蟑螂组件压缩包：{error}"))?;
    let mut archive =
        ZipArchive::new(archive_file).map_err(|error| format!("蟑螂组件压缩包损坏：{error}"))?;
    if archive.len() > MAX_ARCHIVE_FILES {
        return Err("蟑螂组件文件数量超过限制".to_string());
    }
    let mut extracted = 0_u64;
    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|error| format!("无法读取蟑螂组件压缩包条目：{error}"))?;
        let enclosed = entry
            .enclosed_name()
            .ok_or_else(|| "蟑螂组件压缩包包含不安全路径".to_string())?
            .to_path_buf();
        let is_symlink = entry
            .unix_mode()
            .is_some_and(|mode| mode & 0o170000 == 0o120000);
        extracted = extracted
            .checked_add(entry.size())
            .ok_or_else(|| "蟑螂组件解压大小溢出".to_string())?;
        if extracted > MAX_EXTRACTED_BYTES {
            return Err("蟑螂组件解压大小超过限制".to_string());
        }
        let output = staging.join(enclosed);
        if is_symlink {
            if entry.size() > 4096 {
                return Err("蟑螂组件符号链接目标过长".to_string());
            }
            let mut target = String::new();
            entry
                .read_to_string(&mut target)
                .map_err(|error| format!("无法读取组件符号链接：{error}"))?;
            let target = safe_symlink_target(&target)?;
            if let Some(parent) = output.parent() {
                fs::create_dir_all(parent).map_err(|error| format!("无法创建组件目录：{error}"))?;
            }
            platform::restore_archive_symlink(&target, &output)?;
            continue;
        }
        if entry.is_dir() {
            fs::create_dir_all(&output).map_err(|error| format!("无法创建组件目录：{error}"))?;
            continue;
        }
        if let Some(parent) = output.parent() {
            fs::create_dir_all(parent).map_err(|error| format!("无法创建组件目录：{error}"))?;
        }
        let mut target_file =
            fs::File::create(&output).map_err(|error| format!("无法写入组件文件：{error}"))?;
        std::io::copy(&mut entry, &mut target_file)
            .map_err(|error| format!("无法解压组件文件：{error}"))?;
        drop(target_file);
        platform::restore_archive_permissions(&output, entry.unix_mode())?;
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
            read_json_manifest(&directory.join(".artifact.json"), "组件来源")?;
        if artifact.schema_version != 1
            || artifact.sha256 != component.package.sha256.to_ascii_lowercase()
            || artifact.size != component.package.size
        {
            return Err("已安装蟑螂组件与签名索引哈希不一致".to_string());
        }
        validate_sha256_text(&component.manifest_sha256)?;
        if sha256_file(&directory.join(kind.manifest_name()))?
            != component.manifest_sha256.to_ascii_lowercase()
        {
            return Err("已安装蟑螂组件清单与签名索引哈希不一致".to_string());
        }
    }
    match kind {
        LayeredComponentKind::Runtime => {
            let manifest: RuntimeManifest =
                read_json_manifest(&directory.join("runtime.json"), "基础运行时")?;
            if manifest.schema_version != 1
                || manifest.component_type != "runtime"
                || manifest.version != expected_version
                || manifest.target != target
                || manifest.runtime_abi.trim().is_empty()
                || manifest.distribution != NONCOMMERCIAL_DISTRIBUTION
                || manifest.platform_signature.trim().is_empty()
            {
                return Err("蟑螂基础运行时清单与安装目标不匹配".to_string());
            }
            let entry = join_relative(directory, &manifest.entry)?;
            let runtime_root = join_relative(directory, &manifest.runtime_root)?;
            if !entry.is_file() || !runtime_root.is_dir() {
                return Err("蟑螂基础运行时文件不完整".to_string());
            }
            if verify_files {
                verify_component_files(directory, &manifest.files)?;
            }
            platform::ensure_entry_executable(&entry)
        }
        LayeredComponentKind::Dependencies => {
            let manifest: DependenciesManifest =
                read_json_manifest(&directory.join("dependencies.json"), "通用依赖")?;
            if manifest.schema_version != 1
                || manifest.component_type != "dependencies"
                || manifest.version != expected_version
                || manifest.dependency_set.trim().is_empty()
                || manifest.distribution != NONCOMMERCIAL_DISTRIBUTION
            {
                return Err("蟑螂通用依赖清单与安装目标不匹配".to_string());
            }
            if !join_relative(directory, &manifest.dependency_root)?.is_dir() {
                return Err("蟑螂通用依赖文件不完整".to_string());
            }
            if verify_files {
                verify_component_files(directory, &manifest.files)?;
            }
            Ok(())
        }
        LayeredComponentKind::Logic => {
            let manifest: LogicManifest =
                read_json_manifest(&directory.join("module.json"), "业务逻辑")?;
            if manifest.schema_version != LAYERED_INDEX_SCHEMA_VERSION
                || manifest.component_type != "logic"
                || manifest.id != MODULE_ID
                || manifest.version != expected_version
                || manifest.runtime_abi.trim().is_empty()
                || manifest.distribution != NONCOMMERCIAL_DISTRIBUTION
                || missing_capabilities(&manifest.capabilities)
            {
                return Err("蟑螂业务逻辑清单与安装目标不匹配".to_string());
            }
            if !join_relative(directory, &manifest.module_root)?
                .join("main.js")
                .is_file()
            {
                return Err("蟑螂业务逻辑代码不完整".to_string());
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
        fs::File::open(path).map_err(|error| format!("无法打开蟑螂组件校验文件：{error}"))?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0_u8; 1024 * 1024];
    loop {
        let read = source
            .read(&mut buffer)
            .map_err(|error| format!("无法读取蟑螂组件校验文件：{error}"))?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

fn verify_component_files(directory: &Path, files: &[ComponentFile]) -> Result<(), String> {
    if files.is_empty() || files.len() > MAX_ARCHIVE_FILES {
        return Err("蟑螂组件文件哈希清单为空或过大".to_string());
    }
    let mut seen = HashSet::with_capacity(files.len());
    let mut buffer = vec![0_u8; 1024 * 1024];
    for item in files {
        validate_sha256_text(&item.sha256)?;
        let relative = safe_relative_path(&item.path)?;
        if relative == Path::new(".") || !seen.insert(relative.clone()) {
            return Err("蟑螂组件文件哈希清单包含重复或无效路径".to_string());
        }
        let path = directory.join(relative);
        let metadata =
            fs::symlink_metadata(&path).map_err(|error| format!("蟑螂组件文件缺失：{error}"))?;
        if let Some(expected_target) = &item.link_target {
            let expected_target = safe_symlink_target(expected_target)?;
            if !metadata.file_type().is_symlink() {
                return Err(format!("蟑螂组件符号链接类型不匹配：{}", item.path));
            }
            let actual_target = fs::read_link(&path)
                .map_err(|error| format!("无法校验蟑螂组件符号链接：{error}"))?;
            if actual_target != expected_target {
                return Err(format!("蟑螂组件符号链接目标不匹配：{}", item.path));
            }
            let bytes = expected_target.to_string_lossy();
            if item.size != bytes.len() as u64
                || format!("{:x}", Sha256::digest(bytes.as_bytes()))
                    != item.sha256.to_ascii_lowercase()
            {
                return Err(format!("蟑螂组件符号链接哈希不匹配：{}", item.path));
            }
            continue;
        }
        if !metadata.file_type().is_file() || metadata.len() != item.size {
            return Err(format!("蟑螂组件文件大小不匹配：{}", item.path));
        }
        let mut source =
            fs::File::open(&path).map_err(|error| format!("无法校验蟑螂组件文件：{error}"))?;
        let mut hasher = Sha256::new();
        loop {
            let read = source
                .read(&mut buffer)
                .map_err(|error| format!("无法校验蟑螂组件文件：{error}"))?;
            if read == 0 {
                break;
            }
            hasher.update(&buffer[..read]);
        }
        if format!("{:x}", hasher.finalize()) != item.sha256.to_ascii_lowercase() {
            return Err(format!("蟑螂组件文件 SHA-256 不匹配：{}", item.path));
        }
    }
    Ok(())
}

#[tauri::command]
pub fn launch_cockroach_module(
    app: tauri::AppHandle,
    state: tauri::State<'_, CockroachModuleState>,
    settings: Option<CockroachModuleSettings>,
) -> Result<CockroachModuleStatus, String> {
    let root = module_root(&app)?;
    let Some(resolved) = resolve_installed_module(&root)? else {
        return Err("请先下载蟑螂模块".to_string());
    };
    let settings = settings.unwrap_or_else(|| read_settings(&root));
    validate_settings(&settings)?;
    stop_child(&state);
    write_upstream_config(&root, &settings, true)?;
    start_child(&root, &resolved, &state)?;
    Ok(cockroach_module_status(app, state))
}

fn start_child(
    root: &Path,
    resolved: &ResolvedCockroachModule,
    state: &CockroachModuleState,
) -> Result<(), String> {
    let control_file = control_file_path(root);
    let _ = fs::remove_file(&control_file);
    let _ = fs::remove_file(control_ack_path(root));
    let mut command = Command::new(&resolved.entry);
    command
        .current_dir(&resolved.working_directory)
        .args(&resolved.arguments)
        .envs(&resolved.environment)
        .arg(format!(
            "--user-data-dir={}",
            module_data_dir(root).display()
        ))
        .arg(format!("--cpa-control-file={}", control_file.display()))
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    platform::configure_child_command(&mut command);
    let child = command
        .spawn()
        .map_err(|error| format!("无法启动蟑螂模块：{error}"))?;
    *state
        .child
        .lock()
        .map_err(|_| "蟑螂模块进程状态不可用".to_string())? = Some(child);
    Ok(())
}

#[tauri::command]
pub fn save_cockroach_module_settings(
    app: tauri::AppHandle,
    state: tauri::State<'_, CockroachModuleState>,
    settings: CockroachModuleSettings,
) -> Result<CockroachModuleStatus, String> {
    let root = module_root(&app)?;
    let was_running = child_is_running(&state);
    if was_running {
        stop_child(&state);
    }
    write_upstream_config(&root, &settings, was_running)?;
    if was_running {
        let Some(resolved) = resolve_installed_module(&root)? else {
            return Err("请先下载蟑螂模块".to_string());
        };
        start_child(&root, &resolved, &state)?;
    }
    Ok(cockroach_module_status(app, state))
}

#[tauri::command]
pub fn kill_all_cockroaches(
    app: tauri::AppHandle,
    state: tauri::State<'_, CockroachModuleState>,
) -> Result<CockroachModuleStatus, String> {
    if !child_is_running(&state) {
        return Ok(cockroach_module_status(app, state));
    }
    let root = module_root(&app)?;
    send_kill_all_command(&root, &state)?;
    Ok(cockroach_module_status(app, state))
}

fn send_kill_all_command(root: &Path, state: &CockroachModuleState) -> Result<(), String> {
    let counter = state.next_control_nonce.fetch_add(1, Ordering::Relaxed);
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let nonce = format!("{}-{counter}-{timestamp}", std::process::id());
    let command_path = control_file_path(root);
    let ack_path = control_ack_path(root);
    let temporary = command_path.with_extension("json.tmp");
    let _ = fs::remove_file(&ack_path);
    fs::write(
        &temporary,
        serde_json::to_vec(&serde_json::json!({
            "v": 1,
            "nonce": nonce,
            "command": "kill-all",
        }))
        .map_err(|error| error.to_string())?,
    )
    .map_err(|error| format!("无法发送杀死所有命令：{error}"))?;
    let _ = fs::remove_file(&command_path);
    fs::rename(&temporary, &command_path)
        .map_err(|error| format!("无法激活杀死所有命令：{error}"))?;

    let started = Instant::now();
    while started.elapsed() < Duration::from_secs(2) {
        if let Ok(bytes) = fs::read(&ack_path) {
            if let Ok(ack) = serde_json::from_slice::<serde_json::Value>(&bytes) {
                if ack.get("v").and_then(serde_json::Value::as_u64) == Some(1)
                    && ack.get("nonce").and_then(serde_json::Value::as_str) == Some(nonce.as_str())
                    && ack.get("ok").and_then(serde_json::Value::as_bool) == Some(true)
                {
                    return Ok(());
                }
            }
        }
        std::thread::sleep(Duration::from_millis(25));
    }
    Err("蟑螂程序没有确认杀死所有命令".to_string())
}

#[tauri::command]
pub fn stop_cockroach_module(
    app: tauri::AppHandle,
    state: tauri::State<'_, CockroachModuleState>,
) -> Result<CockroachModuleStatus, String> {
    stop_child(&state);
    let root = module_root(&app)?;
    if !root.exists() {
        return Ok(cockroach_module_status(app, state));
    }
    let settings = read_settings(&root);
    write_upstream_config(&root, &settings, true)?;
    Ok(cockroach_module_status(app, state))
}

#[tauri::command]
pub fn uninstall_cockroach_module(
    app: tauri::AppHandle,
    state: tauri::State<'_, CockroachModuleState>,
) -> Result<CockroachModuleStatus, String> {
    stop_child(&state);
    if let Some(window) = app.get_webview_window("cockroach-module") {
        let _ = window.close();
    }
    let root = module_root(&app)?;
    if root.exists() {
        fs::remove_dir_all(&root).map_err(|error| format!("无法删除蟑螂模块：{error}"))?;
    }
    Ok(cockroach_module_status(app, state))
}

fn stop_child(state: &CockroachModuleState) {
    if let Ok(mut guard) = state.child.lock() {
        if let Some(mut child) = guard.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

pub fn stop_for_exit(app: &tauri::AppHandle) {
    let state = app.state::<CockroachModuleState>();
    stop_child(&state);
}

#[cfg(test)]
mod tests {
    use super::{
        extract_archive_to, index_urls, module_public_key, parse_module_index, runtime_target,
        safe_relative_path, send_kill_all_command, sha256_file, validate_index_url,
        validate_layered_component_directory, validate_layered_index, validate_manifest,
        validate_package_url, validate_release_version, validate_settings, validate_sha256_text,
        verify_index_signature, write_upstream_config, CockroachModuleSettings,
        CockroachModuleState, ComponentPackage, InstalledArtifact, LayeredComponentKind,
        ModuleIndexDocument, ModuleManifest, ModulePackage, MODULE_ID, MODULE_SCHEMA_VERSION,
    };

    fn manifest() -> ModuleManifest {
        ModuleManifest {
            schema_version: MODULE_SCHEMA_VERSION,
            id: MODULE_ID.to_string(),
            version: "1.0.0".to_string(),
            target: runtime_target().to_string(),
            entry: "runtime/cockroach-module".to_string(),
            capabilities: vec![
                "electron-vector-cockroach-v1".to_string(),
                "max-count".to_string(),
                "baby-growth-minutes".to_string(),
                "process-lifecycle".to_string(),
                "process-control-file-v1".to_string(),
            ],
        }
    }

    #[test]
    fn accepts_the_expected_module_contract() {
        validate_manifest(&manifest(), "1.0.0", runtime_target()).unwrap();
    }

    #[test]
    fn rejects_missing_capabilities_and_path_traversal() {
        let mut value = manifest();
        value
            .capabilities
            .retain(|capability| capability != "max-count");
        assert!(validate_manifest(&value, "1.0.0", runtime_target()).is_err());
        assert!(safe_relative_path("../outside").is_err());
        assert!(safe_relative_path("/outside").is_err());
    }

    #[test]
    fn package_urls_are_restricted_to_the_release_repository() {
        assert!(validate_package_url(
            "https://github.com/UnityX103/CPA_V2/releases/download/cockroach-v1/module.zip"
        )
        .is_ok());
        assert!(validate_package_url(
            "https://cnb.cool/nanzhaigame-xpy/CPA_V2/-/releases/download/v0.1.25/module.zip"
        )
        .is_ok());
        assert!(validate_package_url("https://example.com/module.zip").is_err());
    }

    #[test]
    fn module_index_prefers_cnb_and_allows_github_fallback() {
        let urls = index_urls();
        assert!(urls[0].starts_with("https://cnb.cool/"));
        assert!(urls[1].starts_with("https://github.com/"));
        assert!(urls.iter().all(|url| validate_index_url(url).is_ok()));
    }

    #[test]
    fn accepts_noncommercial_layered_runtime_and_logic_index() {
        let value = serde_json::json!({
            "schemaVersion": 2,
            "version": "1.1.0-noncommercial.1",
            "distribution": "noncommercial-open-source",
            "logic": {
                "version": "1.1.0-noncommercial.1",
                "runtimeAbi": "cpa-cockroach-electron-40-control-v1",
                "dependencySet": "cockroach-js-0000000000000000",
                "manifestSha256": "a".repeat(64),
                "url": "https://github.com/UnityX103/CPA_V2/releases/download/v0.1.25/cockroach-logic.zip",
                "sha256": "b".repeat(64),
                "size": 42
            },
            "dependencies": {
                "version": "electron-store-8.2.0-lock-1",
                "runtimeAbi": "cpa-cockroach-electron-40-control-v1",
                "dependencySet": "cockroach-js-0000000000000000",
                "manifestSha256": "e".repeat(64),
                "url": "https://github.com/UnityX103/CPA_V2/releases/download/v0.1.24/cockroach-dependencies.zip",
                "sha256": "f".repeat(64),
                "size": 21
            },
            "runtimes": {
                runtime_target(): {
                    "version": "40.8.0",
                    "runtimeAbi": "cpa-cockroach-electron-40-control-v1",
                    "manifestSha256": "c".repeat(64),
                    "url": "https://github.com/UnityX103/CPA_V2/releases/download/v0.1.24/cockroach-runtime.zip",
                    "sha256": "d".repeat(64),
                    "size": 84,
                    "platformSignature": "verified-test-runtime",
                    "acceptanceReceiptSha256": "9".repeat(64)
                }
            }
        });
        let document = parse_module_index(&serde_json::to_vec(&value).unwrap()).unwrap();
        let ModuleIndexDocument::Layered(index) = document else {
            panic!("expected layered index");
        };
        let runtime = validate_layered_index(&index, runtime_target()).unwrap();
        assert_eq!(runtime.version, "40.8.0");
        assert_eq!(index.logic.version, "1.1.0-noncommercial.1");
        assert!(LayeredComponentKind::Runtime
            .directory(&runtime.version, runtime_target(), &runtime.package.sha256)
            .unwrap()
            .starts_with("runtimes/40.8.0-"));
    }

    #[test]
    fn rejects_layered_cockroach_packages_without_noncommercial_distribution() {
        let value = serde_json::json!({
            "schemaVersion": 2,
            "version": "1.1.0",
            "distribution": "commercial",
            "logic": {
                "version": "1.1.0",
                "runtimeAbi": "abi",
                "dependencySet": "cockroach-js-0000000000000000",
                "manifestSha256": "a".repeat(64),
                "url": "https://github.com/UnityX103/CPA_V2/releases/download/v0.1.25/logic.zip",
                "sha256": "b".repeat(64),
                "size": 1
            },
            "dependencies": {
                "version": "deps-1",
                "runtimeAbi": "abi",
                "dependencySet": "cockroach-js-0000000000000000",
                "manifestSha256": "e".repeat(64),
                "url": "https://github.com/UnityX103/CPA_V2/releases/download/v0.1.25/dependencies.zip",
                "sha256": "f".repeat(64),
                "size": 1
            },
            "runtimes": {
                runtime_target(): {
                    "version": "40.8.0",
                    "runtimeAbi": "abi",
                    "manifestSha256": "c".repeat(64),
                    "url": "https://github.com/UnityX103/CPA_V2/releases/download/v0.1.25/runtime.zip",
                    "sha256": "d".repeat(64),
                    "size": 1,
                    "platformSignature": "verified-test-runtime",
                    "acceptanceReceiptSha256": "9".repeat(64)
                }
            }
        });
        let ModuleIndexDocument::Layered(index) =
            parse_module_index(&serde_json::to_vec(&value).unwrap()).unwrap()
        else {
            panic!("expected layered index");
        };
        assert!(validate_layered_index(&index, runtime_target()).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn layered_runtime_restores_safe_framework_symlinks_and_rejects_escape_targets() {
        use zip::write::SimpleFileOptions;

        let root = std::env::temp_dir().join(format!(
            "cpa-cockroach-symlink-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&root).unwrap();
        let archive_path = root.join("runtime.zip");
        let archive_file = std::fs::File::create(&archive_path).unwrap();
        let mut archive = zip::ZipWriter::new(archive_file);
        archive
            .add_symlink(
                "runtime/Framework.framework/Versions/Current",
                "A",
                SimpleFileOptions::default(),
            )
            .unwrap();
        archive.finish().unwrap();
        let staging = root.join("safe");
        std::fs::create_dir_all(&staging).unwrap();
        extract_archive_to(&archive_path, &staging).unwrap();
        assert_eq!(
            std::fs::read_link(staging.join("runtime/Framework.framework/Versions/Current"))
                .unwrap(),
            std::path::PathBuf::from("A")
        );

        let unsafe_path = root.join("unsafe.zip");
        let unsafe_file = std::fs::File::create(&unsafe_path).unwrap();
        let mut unsafe_archive = zip::ZipWriter::new(unsafe_file);
        unsafe_archive
            .add_symlink(
                "runtime/escape",
                "../../outside",
                SimpleFileOptions::default(),
            )
            .unwrap();
        unsafe_archive.finish().unwrap();
        let unsafe_staging = root.join("unsafe");
        std::fs::create_dir_all(&unsafe_staging).unwrap();
        assert!(extract_archive_to(&unsafe_path, &unsafe_staging).is_err());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn verified_content_addressed_runtime_is_reusable_until_a_file_changes() {
        use sha2::{Digest, Sha256};

        let root = std::env::temp_dir().join(format!(
            "cpa-cockroach-runtime-cache-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(root.join("runtime")).unwrap();
        std::fs::write(root.join("runtime/electron"), b"runtime").unwrap();
        let file_hash = format!("{:x}", Sha256::digest(b"runtime"));
        std::fs::write(
            root.join("runtime.json"),
            serde_json::to_vec(&serde_json::json!({
                "schemaVersion": 1,
                "type": "runtime",
                "version": "40.8.0",
                "target": runtime_target(),
                "runtimeAbi": "cpa-cockroach-electron-40-control-v1",
                "entry": "runtime/electron",
                "runtimeRoot": "runtime",
                "distribution": "noncommercial-open-source",
                "platformSignature": "verified-test-runtime",
                "files": [{"path": "runtime/electron", "size": 7, "sha256": file_hash}]
            }))
            .unwrap(),
        )
        .unwrap();
        let package_hash = "a".repeat(64);
        std::fs::write(
            root.join(".artifact.json"),
            serde_json::to_vec(&InstalledArtifact {
                schema_version: 1,
                sha256: package_hash.clone(),
                size: 42,
            })
            .unwrap(),
        )
        .unwrap();
        let component = ComponentPackage {
            version: "40.8.0".to_string(),
            manifest_sha256: sha256_file(&root.join("runtime.json")).unwrap(),
            runtime_abi: "cpa-cockroach-electron-40-control-v1".to_string(),
            dependency_set: None,
            platform_signature: Some("verified-test-runtime".to_string()),
            acceptance_receipt_sha256: Some("b".repeat(64)),
            package: ModulePackage {
                url: "https://github.com/UnityX103/CPA_V2/releases/download/v0.1.25/runtime.zip"
                    .to_string(),
                mirrors: Vec::new(),
                sha256: package_hash,
                size: 42,
            },
        };
        validate_layered_component_directory(
            &root,
            LayeredComponentKind::Runtime,
            "40.8.0",
            runtime_target(),
            Some(&component),
            true,
        )
        .unwrap();
        std::fs::write(root.join("runtime/electron"), b"tampered").unwrap();
        assert!(validate_layered_component_directory(
            &root,
            LayeredComponentKind::Runtime,
            "40.8.0",
            runtime_target(),
            Some(&component),
            true,
        )
        .is_err());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn validates_sha256_shape() {
        assert!(validate_sha256_text(&"a".repeat(64)).is_ok());
        assert!(validate_sha256_text("not-a-hash").is_err());
    }

    #[test]
    fn validates_the_upstream_setting_ranges() {
        assert!(validate_settings(&CockroachModuleSettings {
            max_count: 1,
            baby_growth_minutes: 60,
        })
        .is_ok());
        assert!(validate_settings(&CockroachModuleSettings {
            max_count: 0,
            baby_growth_minutes: 10,
        })
        .is_err());
        assert!(validate_settings(&CockroachModuleSettings {
            max_count: 30,
            baby_growth_minutes: 61,
        })
        .is_err());
    }

    #[test]
    fn writes_electron_store_settings_and_clears_persisted_cockroaches() {
        let root = std::env::temp_dir().join(format!(
            "cpa-cockroach-module-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let settings = CockroachModuleSettings {
            max_count: 42,
            baby_growth_minutes: 6,
        };
        write_upstream_config(&root, &settings, true).unwrap();
        let value: serde_json::Value =
            serde_json::from_slice(&std::fs::read(root.join("data/config.json")).unwrap()).unwrap();
        assert_eq!(value["settings"]["maxCount"], 42);
        assert_eq!(value["settings"]["babyGrowthMinutes"], 6);
        assert_eq!(value["cockroaches"], serde_json::json!([]));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn kill_all_control_waits_for_the_matching_process_acknowledgement() {
        let root = std::env::temp_dir().join(format!(
            "cpa-cockroach-control-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(root.join("data")).unwrap();
        let root_for_process = root.clone();
        let process = std::thread::spawn(move || {
            let command_path = root_for_process.join("data/cpa-control.json");
            let mut last_nonce = None;
            for _ in 0..2 {
                let started = std::time::Instant::now();
                let mut acknowledged = false;
                while started.elapsed() < std::time::Duration::from_secs(2) {
                    if let Ok(bytes) = std::fs::read(&command_path) {
                        let command: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
                        let nonce = command["nonce"].as_str().unwrap().to_string();
                        if last_nonce.as_ref() == Some(&nonce) {
                            std::thread::sleep(std::time::Duration::from_millis(5));
                            continue;
                        }
                        std::fs::write(
                            root_for_process.join("data/cpa-control.ack.json"),
                            serde_json::to_vec(&serde_json::json!({
                                "v": 1,
                                "nonce": nonce,
                                "ok": true,
                            }))
                            .unwrap(),
                        )
                        .unwrap();
                        last_nonce = Some(nonce);
                        acknowledged = true;
                        break;
                    }
                    std::thread::sleep(std::time::Duration::from_millis(5));
                }
                assert!(acknowledged, "control command was not written");
            }
        });
        let state = CockroachModuleState::default();
        send_kill_all_command(&root, &state).unwrap();
        send_kill_all_command(&root, &state).unwrap();
        process.join().unwrap();
        std::fs::remove_dir_all(root).unwrap();
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
