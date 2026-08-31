use futures_util::StreamExt;
use minisign_verify::{PublicKey, Signature};
use rand::distr::{Alphanumeric, SampleString};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs;
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{Emitter, Manager, WebviewUrl, WebviewWindowBuilder};
use tokio::io::AsyncWriteExt;
use zip::ZipArchive;

const MODULE_ID: &str = "cpa-video-editor";
const MODULE_SCHEMA_VERSION: u32 = 1;
const INDEX_SCHEMA_VERSION: u32 = 1;
const DEFAULT_INDEX_URL: &str =
    "https://github.com/UnityX103/CPA_V2/releases/latest/download/video-editor-module-index.json";
const MODULE_PROGRESS_EVENT: &str = "video-editor-module-progress";
const MAX_ARCHIVE_BYTES: u64 = 8 * 1024 * 1024 * 1024;
const MAX_EXTRACTED_BYTES: u64 = 16 * 1024 * 1024 * 1024;
const MAX_ARCHIVE_FILES: usize = 100_000;
const MAX_INDEX_BYTES: usize = 1024 * 1024;
const MAX_SIGNATURE_BYTES: usize = 16 * 1024;

#[derive(Default)]
pub struct VideoEditorModuleState {
    child: Mutex<Option<Child>>,
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
struct ModuleIndex {
    schema_version: u32,
    version: String,
    #[serde(default)]
    debug_only: bool,
    packages: HashMap<String, ModulePackage>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ModulePackage {
    url: String,
    sha256: String,
    size: u64,
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

fn index_url() -> String {
    #[cfg(debug_assertions)]
    if let Ok(url) = std::env::var("CPA_VIDEO_EDITOR_MODULE_INDEX_URL") {
        if !url.trim().is_empty() {
            return url;
        }
    }
    option_env!("CPA_VIDEO_EDITOR_MODULE_INDEX_URL")
        .unwrap_or(DEFAULT_INDEX_URL)
        .to_string()
}

fn module_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|path| path.join("modules").join("video-editor"))
        .map_err(|error| format!("无法打开视频编辑模块目录：{error}"))
}

fn pointer_path(root: &Path) -> PathBuf {
    root.join("current.json")
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
    Ok(Some((pointer, manifest)))
}

fn validate_manifest(
    manifest: &ModuleManifest,
    expected_version: &str,
    expected_target: &str,
) -> Result<(), String> {
    if manifest.schema_version != MODULE_SCHEMA_VERSION {
        return Err("视频编辑模块清单版本不兼容".to_string());
    }
    if manifest.id != MODULE_ID {
        return Err("下载包不是 CPA 视频编辑模块".to_string());
    }
    if manifest.version != expected_version || manifest.target != expected_target {
        return Err("视频编辑模块版本或平台与当前安装包不匹配".to_string());
    }
    let required = [
        "sam2-birefnet-v1",
        "screenshot",
        "output-resolution",
        "vp8-alpha-webm",
    ];
    if required.iter().any(|capability| {
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

fn validate_package_url(value: &str) -> Result<(), String> {
    let url = reqwest::Url::parse(value).map_err(|_| "视频编辑模块下载地址无效".to_string())?;
    if url.scheme() != "https"
        || url.host_str() != Some("github.com")
        || !url
            .path()
            .starts_with("/UnityX103/CPA_V2/releases/download/")
    {
        #[cfg(debug_assertions)]
        if matches!(url.scheme(), "http" | "https") && url.host_str() == Some("127.0.0.1") {
            return Ok(());
        }
        return Err("视频编辑模块下载地址不在允许的发布源中".to_string());
    }
    Ok(())
}

fn validate_index_url(value: &str) -> Result<(), String> {
    let url = reqwest::Url::parse(value).map_err(|_| "视频编辑模块索引地址无效".to_string())?;
    if url.scheme() == "https"
        && url.host_str() == Some("github.com")
        && url.path().starts_with("/UnityX103/CPA_V2/releases/")
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
    let result = module_root(&app).and_then(|root| read_installed_manifest(&root));
    match result {
        Ok(Some((pointer, _))) => VideoEditorModuleStatus {
            installed: true,
            version: Some(pointer.version),
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

#[tauri::command]
pub async fn download_video_editor_module(
    app: tauri::AppHandle,
) -> Result<VideoEditorModuleStatus, String> {
    let target = runtime_target();
    if target == "unsupported" {
        return Err("当前平台不支持视频编辑模块".to_string());
    }
    emit_progress(&app, "index", 0, None, "正在检查视频编辑模块版本");
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::limited(5))
        .timeout(Duration::from_secs(60 * 60))
        .build()
        .map_err(|error| format!("无法创建下载客户端：{error}"))?;
    let index_url = index_url();
    validate_index_url(&index_url)?;
    let index_bytes =
        download_small_document(&client, &index_url, MAX_INDEX_BYTES, "视频编辑模块索引").await?;
    let signature_url = format!("{index_url}.sig");
    let signature_bytes = download_small_document(
        &client,
        &signature_url,
        MAX_SIGNATURE_BYTES,
        "视频编辑模块索引签名",
    )
    .await?;
    verify_index_signature(&index_bytes, &signature_bytes)?;
    let index: ModuleIndex = serde_json::from_slice(&index_bytes)
        .map_err(|error| format!("无法解析视频编辑模块清单：{error}"))?;
    if index.schema_version != INDEX_SCHEMA_VERSION {
        return Err("视频编辑模块索引版本不兼容".to_string());
    }
    if index.debug_only && !cfg!(debug_assertions) {
        return Err("正式应用不能安装内部测试视频编辑模块".to_string());
    }
    validate_release_version(&index.version)?;
    let package = index
        .packages
        .get(target)
        .cloned()
        .ok_or_else(|| format!("当前发布尚未提供 {target} 视频编辑模块"))?;
    validate_package_url(&package.url)?;
    if package.size == 0 || package.size > MAX_ARCHIVE_BYTES {
        return Err("视频编辑模块下载大小无效".to_string());
    }
    validate_sha256_text(&package.sha256)?;

    let root = module_root(&app)?;
    fs::create_dir_all(&root).map_err(|error| format!("无法创建视频编辑模块目录：{error}"))?;
    let archive_path = root.join(format!(".download-{}-{target}.zip", index.version));
    let response = client
        .get(&package.url)
        .send()
        .await
        .map_err(|error| format!("视频编辑模块下载失败：{error}"))?
        .error_for_status()
        .map_err(|error| format!("视频编辑模块下载请求失败：{error}"))?;
    let content_length = response.content_length().or(Some(package.size));
    let mut stream = response.bytes_stream();
    let mut file = tokio::fs::File::create(&archive_path)
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
            let _ = tokio::fs::remove_file(&archive_path).await;
            return Err("视频编辑模块下载超过清单大小".to_string());
        }
        hasher.update(&chunk);
        file.write_all(&chunk)
            .await
            .map_err(|error| format!("无法保存视频编辑模块：{error}"))?;
        emit_progress(
            &app,
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
        let _ = tokio::fs::remove_file(&archive_path).await;
        return Err("视频编辑模块下载大小与清单不一致".to_string());
    }
    let actual_hash = format!("{:x}", hasher.finalize());
    if actual_hash != package.sha256.to_ascii_lowercase() {
        let _ = tokio::fs::remove_file(&archive_path).await;
        return Err("视频编辑模块 SHA-256 校验失败".to_string());
    }

    emit_progress(
        &app,
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
        &app,
        "complete",
        downloaded,
        content_length,
        "视频编辑模块下载完成",
    );
    Ok(video_editor_module_status(app))
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
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&entry, fs::Permissions::from_mode(0o755))
            .map_err(|error| format!("无法设置模块启动权限：{error}"))?;
    }
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
    let temporary_pointer = root.join(".current.json.tmp");
    fs::write(
        &temporary_pointer,
        serde_json::to_vec_pretty(&pointer).map_err(|error| error.to_string())?,
    )
    .map_err(|error| format!("无法保存模块状态：{error}"))?;
    fs::rename(&temporary_pointer, pointer_path(root))
        .map_err(|error| format!("无法激活视频编辑模块：{error}"))?;
    Ok(())
}

#[tauri::command]
pub async fn launch_video_editor_module(
    app: tauri::AppHandle,
    state: tauri::State<'_, VideoEditorModuleState>,
) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("video-editor-module") {
        window.show().map_err(|error| error.to_string())?;
        window.set_focus().map_err(|error| error.to_string())?;
        return Ok(());
    }
    let root = module_root(&app)?;
    let Some((pointer, manifest)) = read_installed_manifest(&root)? else {
        return Err("请先下载视频编辑模块".to_string());
    };
    stop_child(&state);
    let module_dir = root.join(pointer.directory);
    let entry = module_dir.join(safe_relative_path(&manifest.entry)?);
    let port = TcpListener::bind(("127.0.0.1", 0))
        .and_then(|listener| listener.local_addr())
        .map_err(|error| format!("无法分配视频编辑模块端口：{error}"))?
        .port();
    let token = Alphanumeric.sample_string(&mut rand::rng(), 48);
    let mut command = Command::new(&entry);
    command
        .current_dir(&module_dir)
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
    let (tx, rx) = std::sync::mpsc::channel();
    app.run_on_main_thread(move || {
        let result = WebviewWindowBuilder::new(
            &app_for_window,
            "video-editor-module",
            WebviewUrl::External(url),
        )
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
            stop_child(&state);
        }
    });
    Ok(())
}

#[tauri::command]
pub fn uninstall_video_editor_module(
    app: tauri::AppHandle,
    state: tauri::State<'_, VideoEditorModuleState>,
) -> Result<VideoEditorModuleStatus, String> {
    stop_child(&state);
    if let Some(window) = app.get_webview_window("video-editor-module") {
        let _ = window.close();
    }
    let root = module_root(&app)?;
    if root.exists() {
        fs::remove_dir_all(&root).map_err(|error| format!("无法删除视频编辑模块：{error}"))?;
    }
    Ok(video_editor_module_status(app))
}

fn stop_child(state: &VideoEditorModuleState) {
    if let Ok(mut guard) = state.child.lock() {
        if let Some(mut child) = guard.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
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
    let (pointer, _) = read_installed_manifest(&root).ok()??;
    let suffix = if cfg!(target_os = "windows") {
        ".exe"
    } else {
        ""
    };
    let path = root
        .join(pointer.directory)
        .join("runtime")
        .join("bin")
        .join(format!("{tool}{suffix}"));
    path.is_file().then_some(path)
}

#[cfg(test)]
mod tests {
    use super::{
        module_public_key, runtime_target, safe_relative_path, validate_manifest,
        validate_package_url, validate_release_version, validate_sha256_text,
        verify_index_signature, ModuleManifest, MODULE_ID, MODULE_SCHEMA_VERSION,
    };

    fn manifest() -> ModuleManifest {
        ModuleManifest {
            schema_version: MODULE_SCHEMA_VERSION,
            id: MODULE_ID.to_string(),
            version: "1.0.0".to_string(),
            target: runtime_target().to_string(),
            entry: "runtime/video-editor-module".to_string(),
            capabilities: vec![
                "sam2-birefnet-v1".to_string(),
                "screenshot".to_string(),
                "output-resolution".to_string(),
                "vp8-alpha-webm".to_string(),
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
        assert!(validate_package_url("https://example.com/module.zip").is_err());
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
