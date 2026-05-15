use serde::Serialize;

#[derive(Debug, Serialize, Clone)]
pub struct ActiveAppInfo {
    pub name: String,
    pub bundle_id: String,
}

#[cfg(target_os = "macos")]
pub fn current_active_app() -> Option<ActiveAppInfo> {
    use objc2_app_kit::NSWorkspace;
    let workspace = NSWorkspace::sharedWorkspace();
    let app = workspace.frontmostApplication()?;
    let name = app
        .localizedName()
        .map(|s| s.to_string())
        .unwrap_or_default();
    let bundle_id = app
        .bundleIdentifier()
        .map(|s| s.to_string())
        .unwrap_or_default();
    Some(ActiveAppInfo { name, bundle_id })
}

#[cfg(not(target_os = "macos"))]
pub fn current_active_app() -> Option<ActiveAppInfo> {
    None
}
