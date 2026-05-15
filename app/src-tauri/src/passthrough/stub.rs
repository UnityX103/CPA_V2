use super::HitRegionStore;
use tauri::WebviewWindow;

pub fn install_impl(_w: &WebviewWindow, _s: std::sync::Arc<HitRegionStore>) {}
pub fn uninstall_impl(_w: &WebviewWindow) {}
pub fn install_first_mouse_only_impl(_w: &WebviewWindow) {}
