//! Small, signed, platform-neutral webview feature packs. No runtime is bundled.
use super::{replace_file_atomically, ExtensionRuntimeContribution, InstallState};
use base64::Engine;
use futures_util::StreamExt;
use minisign_verify::{PublicKey, Signature};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{collections::HashSet, fs, io::Read, path::{Path, PathBuf}, time::Duration};
use tauri::{Emitter, Manager};

pub const KEGEL_ID: &str = "wellness.kegel";
pub const ABI: &str = "cpa-webview-break-activity-v1";
const MAX_ARCHIVE: usize = 16 * 1024 * 1024;
const MAX_EXPANDED: u64 = 32 * 1024 * 1024;
const INDEX_URLS: [&str; 2] = [
    "https://cnb.cool/nanzhaigame-xpy/CPA_V2/-/releases/latest/download/kegel-module-index.json",
    "https://github.com/UnityX103/CPA_V2/releases/latest/download/kegel-module-index.json",
];

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FileEntry { pub path: String, pub size: u64, pub sha256: String }
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Manifest {
    pub schema_version: u32, pub id: String, pub version: String, pub runtime_abi: String,
    pub distribution: String, pub entry: String, pub targets: Vec<String>,
    pub dependencies: Vec<String>, pub runtime_contribution: ExtensionRuntimeContribution,
    pub requires_running: bool, pub files: Vec<FileEntry>,
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Index {
    schema_version: u32, id: String, version: String, runtime_abi: String,
    distribution: String, url: String, mirrors: Vec<String>, size: u64,
    sha256: String, manifest_sha256: String,
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Pointer { schema_version: u32, version: String, directory: String, manifest_sha256: String }

pub fn target() -> &'static str {
    if cfg!(target_os = "windows") { "windows-x86_64" }
    else if cfg!(target_os = "macos") && cfg!(target_arch = "aarch64") { "macos-arm64" }
    else if cfg!(target_os = "macos") { "macos-x86_64" } else { "unsupported" }
}
pub fn root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map(|p| p.join("modules").join(KEGEL_ID)).map_err(|e| e.to_string())
}
fn digest(bytes: &[u8]) -> String { format!("{:x}", Sha256::digest(bytes)) }
fn valid_hash(value: &str) -> bool { value.len() == 64 && value.bytes().all(|b| b.is_ascii_hexdigit()) }
fn safe_path(value: &str) -> Result<&str, String> {
    if value.is_empty() || value.contains(['\\', ':', '%']) || value.starts_with('/')
        || value.split('/').any(|part| part.is_empty() || part == "." || part == ".."
            || part.ends_with(['.', ' ']) || part.chars().any(char::is_control)
            || reserved_windows_name(part)) {
        return Err("功能包包含不安全路径".into());
    }
    Ok(value)
}
fn reserved_windows_name(part: &str) -> bool {
    let name = part.split('.').next().unwrap_or_default().to_ascii_uppercase();
    matches!(name.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || (name.len() == 4 && (name.starts_with("COM") || name.starts_with("LPT"))
            && matches!(name.as_bytes()[3], b'1'..=b'9'))
}
pub fn validate_manifest(manifest: &Manifest, version: &str) -> Result<(), String> {
    if manifest.schema_version != 1 || manifest.id != KEGEL_ID || manifest.version != version
        || manifest.runtime_abi != ABI || manifest.distribution != "project-owned"
        || manifest.entry != "index.html" || !manifest.dependencies.is_empty()
        || manifest.requires_running || manifest.runtime_contribution.event_contract != "pomodoro-broadcast-v1"
        || manifest.runtime_contribution.activation_phase != "break" || manifest.runtime_contribution.delay_ms != 0
        || manifest.runtime_contribution.requires_presence || manifest.runtime_contribution.settings_gate != KEGEL_ID
        || manifest.runtime_contribution.event_rules.is_some()
        || manifest.targets != ["macos-arm64", "macos-x86_64", "windows-x86_64"]
        || manifest.files.is_empty() || manifest.files.len() > 128 {
        return Err("凯格尔功能包的版本、平台或活动协议不兼容".into());
    }
    let mut seen = HashSet::new();
    let mut total = 0_u64;
    for entry in &manifest.files {
        safe_path(&entry.path)?;
        if !seen.insert(entry.path.to_ascii_lowercase()) || entry.path.eq_ignore_ascii_case("manifest.json") || !valid_hash(&entry.sha256) {
            return Err("功能包文件清单无效".into());
        }
        total = total.checked_add(entry.size).ok_or("功能包大小溢出")?;
        if total > MAX_EXPANDED { return Err("功能包展开大小超出限制".into()); }
    }
    if !manifest.files.iter().any(|entry| entry.path == manifest.entry) { return Err("功能包缺少入口文件".into()); }
    Ok(())
}
fn verify_directory(directory: &Path, version: &str, manifest_hash: &str) -> Result<Manifest, String> {
    let bytes = fs::read(directory.join("manifest.json")).map_err(|e| e.to_string())?;
    if !valid_hash(manifest_hash) || digest(&bytes) != manifest_hash.to_ascii_lowercase() { return Err("功能包清单校验失败".into()); }
    let manifest: Manifest = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
    validate_manifest(&manifest, version)?;
    let canonical = directory.canonicalize().map_err(|e| e.to_string())?;
    for entry in &manifest.files {
        let path = directory.join(&entry.path);
        let metadata = fs::symlink_metadata(&path).map_err(|e| e.to_string())?;
        if !metadata.is_file() || metadata.file_type().is_symlink() || metadata.len() != entry.size
            || !path.canonicalize().map_err(|e| e.to_string())?.starts_with(&canonical)
            || digest(&fs::read(path).map_err(|e| e.to_string())?) != entry.sha256.to_ascii_lowercase() {
            return Err(format!("功能包文件校验失败：{}", entry.path));
        }
    }
    Ok(manifest)
}
pub fn installed(app: &tauri::AppHandle) -> Result<(PathBuf, Manifest), String> {
    let root = root(app)?;
    let pointer: Pointer = serde_json::from_slice(&fs::read(root.join("current.json")).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    if pointer.schema_version != 1 || !valid_hash(&pointer.directory) { return Err("功能包指针无效".into()); }
    let directory = root.join("components").join(&pointer.directory);
    let manifest = verify_directory(&directory, &pointer.version, &pointer.manifest_sha256)?;
    if !manifest.targets.iter().any(|t| t == target()) { return Err("功能包不支持当前平台".into()); }
    Ok((directory, manifest))
}
pub fn state(app: &tauri::AppHandle) -> InstallState {
    match installed(app) {
        Ok((_, manifest)) => InstallState { installed: true, version: Some(manifest.version), target: target().into(),
            message: "已安装独立凯格尔功能包".into(), runtime_contribution: Some(manifest.runtime_contribution) },
        Err(error) => InstallState { installed: false, version: None, target: target().into(),
            message: if root(app).is_ok_and(|p| p.join("current.json").exists()) { error } else { "尚未安装".into() }, runtime_contribution: None },
    }
}
fn validate_url(value: &str, index: bool) -> Result<(), String> {
    let url = reqwest::Url::parse(value).map_err(|e| e.to_string())?;
    let prefix = if index { "releases/" } else { "releases/download/" };
    let allowed = (url.host_str() == Some("github.com") && url.path().starts_with(&format!("/UnityX103/CPA_V2/{prefix}")))
        || (url.host_str() == Some("cnb.cool") && url.path().starts_with(&format!("/nanzhaigame-xpy/CPA_V2/-/{prefix}")));
    if url.scheme() != "https" || !allowed || !url.username().is_empty() || url.password().is_some()
        || (index && !url.path().ends_with("/kegel-module-index.json")) { return Err("功能包下载源不在允许列表中".into()); }
    Ok(())
}
async fn download(client: &reqwest::Client, url: &str, maximum: usize) -> Result<Vec<u8>, String> {
    let response = client.get(url).send().await.map_err(|e| e.to_string())?.error_for_status().map_err(|e| e.to_string())?;
    if response.content_length().is_some_and(|n| n > maximum as u64) { return Err("功能包下载超出大小限制".into()); }
    let mut bytes = Vec::new();
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| e.to_string())?;
        if bytes.len().saturating_add(chunk.len()) > maximum { return Err("功能包下载超出大小限制".into()); }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}
fn verify_signature(bytes: &[u8], signature: &[u8]) -> Result<(), String> {
    let config: serde_json::Value = serde_json::from_str(include_str!("../../tauri.conf.json")).map_err(|e| e.to_string())?;
    let encoded = config["plugins"]["updater"]["pubkey"].as_str().ok_or("缺少模块签名公钥")?;
    let decoded = base64::engine::general_purpose::STANDARD.decode(encoded).map_err(|e| e.to_string())?;
    let key = PublicKey::decode(std::str::from_utf8(&decoded).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    let decoded = base64::engine::general_purpose::STANDARD.decode(std::str::from_utf8(signature).map_err(|e| e.to_string())?.trim()).map_err(|e| e.to_string())?;
    let signature = Signature::decode(std::str::from_utf8(&decoded).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    key.verify(bytes, &signature, false).map_err(|e| format!("功能包索引签名校验失败：{e}"))
}
fn progress(app: &tauri::AppHandle, stage: &str, message: &str, bytes: u64, total: Option<u64>) {
    let _ = app.emit("extension-pack-progress", serde_json::json!({ "packId": KEGEL_ID, "stage": stage,
        "message": message, "downloadedBytes": bytes, "totalBytes": total }));
}
fn extract(bytes: &[u8], directory: &Path) -> Result<(), String> {
    let mut archive = zip::ZipArchive::new(std::io::Cursor::new(bytes)).map_err(|e| e.to_string())?;
    if archive.len() > 256 { return Err("功能包文件数量超出限制".into()); }
    let mut total = 0_u64;
    let mut seen = HashSet::new();
    for index in 0..archive.len() {
        let mut entry = archive.by_index(index).map_err(|e| e.to_string())?;
        let name = entry.name().trim_end_matches('/').to_string();
        safe_path(&name)?;
        if !seen.insert(name.to_ascii_lowercase()) || entry.unix_mode().is_some_and(|mode| mode & 0o170000 == 0o120000) {
            return Err("功能包包含重复路径或符号链接".into());
        }
        total = total.checked_add(entry.size()).ok_or("功能包大小溢出")?;
        if total > MAX_EXPANDED { return Err("功能包展开大小超出限制".into()); }
        let path = directory.join(name);
        if entry.is_dir() { fs::create_dir_all(path).map_err(|e| e.to_string())?; continue; }
        fs::create_dir_all(path.parent().ok_or("功能包路径无效")?).map_err(|e| e.to_string())?;
        let mut data = Vec::new();
        entry.by_ref().take(MAX_EXPANDED + 1).read_to_end(&mut data).map_err(|e| e.to_string())?;
        if data.len() as u64 != entry.size() { return Err("功能包文件大小不匹配".into()); }
        fs::write(path, data).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Cursor, Write};
    struct TempDirectory(PathBuf);
    impl TempDirectory {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!("cpa-kegel-pack-{}-{}", std::process::id(), rand::random::<u64>()));
            fs::create_dir(&path).unwrap(); Self(path)
        }
    }
    impl Drop for TempDirectory { fn drop(&mut self) { let _ = fs::remove_dir_all(&self.0); } }
    fn manifest() -> Manifest {
        let mut value: serde_json::Value = serde_json::from_str(include_str!("../../../feature-packs/kegel/module-contract.json")).unwrap();
        value["version"] = "1.0.0".into();
        value["files"] = serde_json::json!([{ "path": "index.html", "size": 4, "sha256": digest(b"test") }]);
        serde_json::from_value(value).unwrap()
    }
    fn archive(names: &[&str], symlink: bool) -> Vec<u8> {
        let mut writer = zip::ZipWriter::new(Cursor::new(Vec::new()));
        let options = zip::write::SimpleFileOptions::default();
        for name in names {
            if symlink { writer.add_symlink(*name, "../outside", options).unwrap(); }
            else { writer.start_file(*name, options).unwrap(); writer.write_all(b"test").unwrap(); }
        }
        writer.finish().unwrap().into_inner()
    }
    #[test]
    fn rejects_incompatible_platform_abi_policy_and_dependencies() {
        let baseline = manifest();
        assert!(validate_manifest(&baseline, "1.0.0").is_ok());
        let mut variants = Vec::new();
        let mut m = baseline.clone(); m.runtime_abi = "arbitrary-js".into(); variants.push(m);
        let mut m = baseline.clone(); m.targets = vec!["windows-arm64".into()]; variants.push(m);
        let mut m = baseline.clone(); m.runtime_contribution.settings_gate = "unknown".into(); variants.push(m);
        let mut m = baseline.clone(); m.requires_running = true; variants.push(m);
        let mut m = baseline.clone(); m.runtime_contribution.requires_presence = true; variants.push(m);
        let mut m = baseline.clone(); m.runtime_contribution.delay_ms = 1; variants.push(m);
        let mut m = baseline.clone(); m.dependencies.push("pet.core".into()); variants.push(m);
        for m in variants { assert!(validate_manifest(&m, "1.0.0").is_err()); }
        assert!(validate_manifest(&baseline, "2.0.0").is_err());
    }
    #[test]
    fn rejects_traversal_aliases_duplicate_paths_and_symlinks() {
        for name in ["../escape", "/absolute", "C:/escape", "assets\\escape", "assets/%2e", "CON.txt", "assets/aux", "a/./b", "trailing."] {
            assert!(safe_path(name).is_err(), "{name}");
        }
        let dir = TempDirectory::new();
        assert!(extract(&archive(&["../escape"], false), &dir.0).is_err());
        assert!(extract(&archive(&["index.html", "INDEX.HTML"], false), &dir.0).is_err());
        assert!(extract(&archive(&["link.js"], true), &dir.0).is_err());
    }
    #[test]
    fn verifies_manifest_and_every_file_before_activation() {
        let dir = TempDirectory::new();
        let m = manifest();
        let bytes = serde_json::to_vec(&m).unwrap();
        fs::write(dir.0.join("manifest.json"), &bytes).unwrap();
        fs::write(dir.0.join("index.html"), b"test").unwrap();
        assert!(verify_directory(&dir.0, "1.0.0", &digest(&bytes)).is_ok());
        assert!(verify_directory(&dir.0, "1.0.0", &"0".repeat(64)).is_err());
        fs::write(dir.0.join("index.html"), b"evil").unwrap();
        assert!(verify_directory(&dir.0, "1.0.0", &digest(&bytes)).is_err());
        fs::remove_file(dir.0.join("index.html")).unwrap();
        assert!(verify_directory(&dir.0, "1.0.0", &digest(&bytes)).is_err());
    }
    #[test]
    fn rejects_undeclared_entry_duplicate_manifest_files_and_bad_hashes() {
        let mut m = manifest(); m.files[0].path = "other.html".into();
        assert!(validate_manifest(&m, "1.0.0").is_err());
        let mut m = manifest(); let mut duplicate = m.files[0].clone(); duplicate.path = "INDEX.HTML".into(); m.files.push(duplicate);
        assert!(validate_manifest(&m, "1.0.0").is_err());
        let mut m = manifest(); m.files[0].sha256 = "bad".into();
        assert!(validate_manifest(&m, "1.0.0").is_err());
    }
    #[test]
    fn rejects_unapproved_sources_unsigned_indexes_and_tampered_index_hashes() {
        for url in ["http://github.com/UnityX103/CPA_V2/releases/download/v1/pack.zip", "https://example.com/pack.zip", "https://github.com/another/repo/releases/download/v1/pack.zip"] {
            assert!(validate_url(url, false).is_err());
        }
        assert!(verify_signature(b"{}", b"unsigned").is_err());
        let mut index = Index { schema_version: 1, id: KEGEL_ID.into(), version: "1.0.0".into(), runtime_abi: ABI.into(),
            distribution: "project-owned".into(), url: "https://github.com/UnityX103/CPA_V2/releases/download/v1/pack.zip".into(),
            mirrors: vec![], size: 10, sha256: "0".repeat(64), manifest_sha256: "0".repeat(64) };
        assert!(validate_index(&index).is_ok());
        index.manifest_sha256 = "bad".into(); assert!(validate_index(&index).is_err());
    }
}
fn validate_index(index: &Index) -> Result<(), String> {
    if index.schema_version != 1 || index.id != KEGEL_ID || index.runtime_abi != ABI
        || index.distribution != "project-owned" || index.size == 0 || index.size > MAX_ARCHIVE as u64
        || !valid_hash(&index.sha256) || !valid_hash(&index.manifest_sha256)
        || index.version.is_empty() || index.version.len() > 64
        || !index.version.bytes().all(|b| b.is_ascii_alphanumeric() || b".-+".contains(&b)) {
        return Err("凯格尔功能包索引无效".into());
    }
    validate_url(&index.url, false)?;
    for mirror in &index.mirrors { validate_url(mirror, false)?; }
    Ok(())
}
pub async fn install(app: &tauri::AppHandle) -> Result<(), String> {
    if let (Some(path), Some(archive_hash), Some(manifest_hash)) = (
        option_env!("CPA_KEGEL_LOCAL_PACKAGE_PATH"), option_env!("CPA_KEGEL_LOCAL_PACKAGE_SHA256"),
        option_env!("CPA_KEGEL_LOCAL_MANIFEST_SHA256"),
    ) {
        // This trust anchor is compiled into an explicitly local test host. A
        // runtime environment variable cannot bypass public-index signatures.
        if !valid_hash(archive_hash) || !valid_hash(manifest_hash) { return Err("本机测试包校验配置无效".into()); }
        let app = app.clone();
        let path = PathBuf::from(path);
        return tauri::async_runtime::spawn_blocking(move || {
            if fs::metadata(&path).map_err(|e| e.to_string())?.len() > MAX_ARCHIVE as u64 { return Err("本机测试包超出大小限制".into()); }
            let bytes = fs::read(path).map_err(|e| format!("找不到本机凯格尔功能包：{e}"))?;
            if digest(&bytes) != archive_hash { return Err("本机凯格尔功能包 SHA256 不匹配".into()); }
            progress(&app, "install", "正在校验并安装本机凯格尔功能包", bytes.len() as u64, Some(bytes.len() as u64));
            let index = Index { schema_version: 1, id: KEGEL_ID.into(), version: "1.0.0".into(), runtime_abi: ABI.into(),
                distribution: "project-owned".into(), url: String::new(), mirrors: vec![], size: bytes.len() as u64,
                sha256: archive_hash.into(), manifest_sha256: manifest_hash.into() };
            install_verified(&app, &index, &bytes)
        }).await.map_err(|e| e.to_string())?;
    }
    let client = reqwest::Client::builder().connect_timeout(Duration::from_secs(10)).timeout(Duration::from_secs(90)).build().map_err(|e| e.to_string())?;
    progress(app, "index", "正在校验凯格尔功能包索引", 0, None);
    let mut errors = Vec::new();
    let mut selected = None;
    for url in INDEX_URLS {
        let result = async {
            validate_url(url, true)?;
            let bytes = download(&client, url, 1024 * 1024).await?;
            let signature = download(&client, &format!("{url}.sig"), 16 * 1024).await?;
            verify_signature(&bytes, &signature)?;
            let index: Index = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
            validate_index(&index)?;
            Ok::<Index, String>(index)
        }.await;
        match result { Ok(index) => { selected = Some(index); break; }, Err(error) => errors.push(error) }
    }
    let index = selected.ok_or_else(|| format!("凯格尔模块尚无可用的签名下载包：{}", errors.join("；")))?;
    progress(app, "download", "正在下载凯格尔独立功能包", 0, Some(index.size));
    let mut package = None;
    for url in std::iter::once(&index.url).chain(index.mirrors.iter()) {
        match download(&client, url, MAX_ARCHIVE).await {
            Ok(bytes) if bytes.len() as u64 == index.size && digest(&bytes) == index.sha256.to_ascii_lowercase() => { package = Some(bytes); break; },
            Ok(_) => errors.push("功能包大小或 SHA256 校验失败".into()), Err(error) => errors.push(error),
        }
    }
    let bytes = package.ok_or_else(|| errors.join("；"))?;
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || install_verified(&app, &index, &bytes)).await.map_err(|e| e.to_string())?
}
fn install_verified(app: &tauri::AppHandle, index: &Index, bytes: &[u8]) -> Result<(), String> {
    let root = root(app)?;
    let components = root.join("components");
    fs::create_dir_all(&components).map_err(|e| e.to_string())?;
    let directory = components.join(index.sha256.to_ascii_lowercase());
    let staging = components.join(format!(".staging-{}", std::process::id()));
    fs::create_dir(&staging).map_err(|e| e.to_string())?;
    let result = (|| {
        extract(bytes, &staging)?;
        verify_directory(&staging, &index.version, &index.manifest_sha256)?;
        if directory.exists() { verify_directory(&directory, &index.version, &index.manifest_sha256)?; }
        else { fs::rename(&staging, &directory).map_err(|e| e.to_string())?; }
        crate::kegel_window::stop_feature(app)?;
        let pointer = Pointer { schema_version: 1, version: index.version.clone(), directory: index.sha256.to_ascii_lowercase(), manifest_sha256: index.manifest_sha256.clone() };
        let temporary = root.join(".current.tmp");
        fs::write(&temporary, serde_json::to_vec_pretty(&pointer).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
        replace_file_atomically(&temporary, &root.join("current.json"), "激活凯格尔功能包")?;
        progress(app, "complete", "凯格尔功能包安装完成", index.size, Some(index.size));
        Ok(())
    })();
    if staging.exists() { let _ = fs::remove_dir_all(&staging); }
    result
}
pub fn uninstall(app: &tauri::AppHandle) -> Result<(), String> {
    crate::kegel_window::stop_feature(app)?;
    let root = root(app)?;
    if root.exists() { fs::remove_dir_all(root).map_err(|e| e.to_string())?; }
    // User history/settings deliberately live outside the installed package root.
    Ok(())
}
pub fn asset_response(app: &tauri::AppHandle, path: &str) -> tauri::http::Response<Vec<u8>> {
    let result = (|| {
        if !super::pack_is_enabled(app, KEGEL_ID)? { return Err("模块未安装或已停用".into()); }
        let relative = path.strip_prefix("/wellness.kegel/").ok_or("模块资源路径无效")?;
        safe_path(relative)?;
        let (directory, manifest) = installed(app)?;
        if !manifest.files.iter().any(|entry| entry.path == relative) { return Err("未声明的模块资源".into()); }
        fs::read(directory.join(relative)).map_err(|e| e.to_string())
    })();
    let mime = if path.ends_with(".js") { "text/javascript" } else if path.ends_with(".css") { "text/css" }
        else if path.ends_with(".html") { "text/html; charset=utf-8" } else { "application/octet-stream" };
    let (status, body) = match result { Ok(bytes) => (200, bytes), Err(error) => (403, error.into_bytes()) };
    tauri::http::Response::builder().status(status).header("Content-Type", mime)
        .header("Cache-Control", "no-store").header("X-Content-Type-Options", "nosniff")
        .header("Content-Security-Policy", "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data:; connect-src ipc: http://ipc.localhost")
        .body(body).expect("static web-pack response headers")
}
