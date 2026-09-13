//! Main-window docking owns its transient geometry; normal layout persistence never saves a strip.
use serde::{Deserialize, Serialize};
use std::sync::{
    atomic::{AtomicBool, AtomicU8, Ordering},
    Mutex,
};
use tauri::{Emitter, Manager, PhysicalPosition, PhysicalSize};
#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "windows")]
mod windows;
#[cfg(target_os = "macos")]
use macos::pressed;
#[cfg(target_os = "windows")]
use windows::pressed;
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn pressed() -> bool {
    false
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Side {
    Left,
    Right,
}
#[derive(Clone, Copy, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub side: Option<Side>,
    pub expanded: bool,
    pub dragging: bool,
}
struct Inner {
    view: Snapshot,
    scale: f64,
    paused: bool,
    auto_dock: bool,
    restored: bool,
    phase: Option<String>,
    keep_open_until_blur: bool,
    monitor_origin: Option<(i32, i32)>,
    notice_generation: u64,
    suspended: bool,
    suspended_origin: Option<(f64, f64)>,
}
impl Default for Inner {
    fn default() -> Self {
        Self {
            view: Snapshot::default(),
            scale: 1.0,
            paused: false,
            auto_dock: false,
            restored: false,
            phase: None,
            keep_open_until_blur: false,
            monitor_origin: None,
            notice_generation: 0,
            suspended: false,
            suspended_origin: None,
        }
    }
}
impl Inner {
    fn update_phase(&mut self, phase: String) -> bool {
        let changed = self
            .phase
            .as_ref()
            .is_some_and(|previous| *previous != phase);
        if changed { self.notice_generation = self.notice_generation.wrapping_add(1); }
        self.phase = Some(phase);
        if changed && self.view.side.is_some() {
            self.keep_open_until_blur = true;
        }
        changed
    }
    fn update_pause(&mut self, paused: bool) {
        if self.paused != paused { self.notice_generation = self.notice_generation.wrapping_add(1); }
        if self.paused && !paused && self.view.side.is_some() {
            self.keep_open_until_blur = true;
        }
        self.paused = paused;
    }
    fn expanded_for_hover(&self, hovered: bool) -> bool {
        hovered || self.paused || self.keep_open_until_blur
    }
    fn displayed_view(&self) -> Snapshot {
        if self.suspended { Snapshot::default() } else { self.view }
    }
    fn gain_focus(&mut self) {
        self.notice_generation = self.notice_generation.wrapping_add(1);
    }
    fn focus_notice_token(&self, focused: bool) -> Option<u64> {
        (self.phase.as_deref() == Some("focus") && !self.paused && !focused
            && self.view.side.is_some() && self.keep_open_until_blur && !self.view.dragging && !self.suspended)
            .then_some(self.notice_generation)
    }
    fn expire_focus_notice(&mut self, token: u64, focused: bool) -> bool {
        if self.focus_notice_token(focused) != Some(token) { return false; }
        self.keep_open_until_blur = false;
        self.view.expanded = false;
        true
    }
    fn lose_focus(&mut self) {
        self.gain_focus();
        self.keep_open_until_blur = false;
    }
}
#[derive(Default)]
pub struct Docking {
    inner: Mutex<Inner>,
    pub stop: AtomicBool,
}

pub fn transient(app: &tauri::AppHandle) -> bool {
    let state = app.state::<Docking>();
    // Resize/move events can arrive synchronously while we hold the geometry lock.
    state
        .inner
        .try_lock()
        .map(|s| s.view.side.is_some() || s.view.dragging || s.suspended)
        .unwrap_or(true)
}
pub fn radius(width: f64, height: f64) -> Option<f64> {
    let ratio = width / height;
    if ratio < 0.5 {
        Some(11.0 * height / 156.0)
    } else {
        None
    }
}
fn window(app: &tauri::AppHandle) -> Result<tauri::WebviewWindow, String> {
    app.get_webview_window("main")
        .ok_or("main window unavailable".into())
}
static HIT_MODE: AtomicU8 = AtomicU8::new(0);
pub fn hit_region(width: f64, height: f64, x: f64, y: f64) -> (f64, f64, f64, f64) {
    let mode = HIT_MODE.load(Ordering::Relaxed);
    dock_hit_region(mode, width, height, x, y)
}
fn dock_hit_region(mode: u8, width: f64, height: f64, x: f64, y: f64) -> (f64, f64, f64, f64) {
    if mode == 1 || mode == 2 {
        let visible = 22.0 * height / 156.0;
        (
            visible,
            height,
            if mode == 2 { x - (width - visible) } else { x },
            y,
        )
    } else {
        (width, height, x, y)
    }
}
fn dock_frame_width(_expanded: bool) -> f64 {
    56.0
}
fn emit(w: &tauri::WebviewWindow, s: &Inner) {
    HIT_MODE.store(
        match s.displayed_view().side {
            None => 0,
            Some(_) if s.view.expanded => 3,
            Some(Side::Left) => 1,
            Some(Side::Right) => 2,
        },
        Ordering::Relaxed,
    );
    let _ = w.emit("pomodoro-docking", s.displayed_view());
}
fn geometry(w: &tauri::WebviewWindow, s: &Inner, x: f64, y: f64) -> Result<(), String> {
    let dpi = if s.view.side.is_some() {
        docking_monitor(w, s)?.scale_factor()
    } else {
        w.scale_factor().map_err(|e| e.to_string())?
    };
    let zoom = dpi * s.scale;
    let (width, height) = if s.view.side.is_some() && !s.suspended {
        (dock_frame_width(s.view.expanded), 156.0)
    } else {
        (215.0, 187.0)
    };
    w.set_min_size(Some(PhysicalSize::new(
        (22.0 * zoom) as u32,
        (156.0 * zoom) as u32,
    )))
    .map_err(|e| e.to_string())?;
    let size = PhysicalSize::new(
        (width * zoom).ceil() as u32,
        (height * zoom).ceil() as u32,
    );
    let old_size = w.outer_size().map_err(|e| e.to_string())?;
    let old_pos = w.outer_position().map_err(|e| e.to_string())?;
    let pos = PhysicalPosition::new(x.round() as i32, y.round() as i32);
    // Grow inward before widening: the intermediate frame must not cross onto the adjacent display.
    let move_first = move_before_resize(old_pos.x, old_size.width, pos.x, size.width);
    if move_first && old_pos != pos {
        w.set_position(pos).map_err(|e| e.to_string())?;
    }
    if old_size != size {
        w.set_size(size).map_err(|e| e.to_string())?;
    }
    if !move_first && old_pos != pos {
        w.set_position(pos).map_err(|e| e.to_string())?;
    }
    emit(w, s);
    Ok(())
}
fn move_before_resize(old_x: i32, old_width: u32, new_x: i32, new_width: u32) -> bool {
    new_width > old_width && new_x < old_x
}
fn monitor_index(anchor: Option<(i32, i32)>, positions: &[(i32, i32)], fallback: usize) -> usize {
    anchor
        .and_then(|a| positions.iter().position(|p| *p == a))
        .unwrap_or(fallback)
}
fn docking_monitor(w: &tauri::WebviewWindow, s: &Inner) -> Result<tauri::Monitor, String> {
    let monitors = w.available_monitors().map_err(|e| e.to_string())?;
    let current = w
        .current_monitor()
        .map_err(|e| e.to_string())?
        .ok_or("monitor unavailable")?;
    let positions: Vec<_> = monitors
        .iter()
        .map(|m| (m.position().x, m.position().y))
        .collect();
    let fallback = positions
        .iter()
        .position(|p| *p == (current.position().x, current.position().y))
        .unwrap_or(0);
    let index = monitor_index(
        if s.view.side.is_some() {
            s.monitor_origin
        } else {
            None
        },
        &positions,
        fallback,
    );
    Ok(monitors.get(index).cloned().unwrap_or(current))
}
fn snap(w: &tauri::WebviewWindow, s: &mut Inner, nearest: bool) -> Result<(), String> {
    let m = docking_monitor(w, s)?;
    s.monitor_origin = Some((m.position().x, m.position().y));
    let r = m.work_area();
    let p = w.outer_position().map_err(|e| e.to_string())?;
    let size = w.outer_size().map_err(|e| e.to_string())?;
    let left = r.position.x as f64;
    let right = left + r.size.width as f64;
    if nearest {
        s.view.side = Some(nearest_side(p.x as f64, size.width as f64, left, right));
    }
    s.view.expanded = s.expanded_for_hover(false);
    let zoom = m.scale_factor() * s.scale;
    let width = (if s.suspended { 215.0 } else { dock_frame_width(s.view.expanded) } * zoom).ceil();
    let x = if s.view.side == Some(Side::Left) {
        left
    } else {
        right - width
    };
    let y = (p.y as f64).clamp(
        r.position.y as f64,
        (r.position.y as f64 + r.size.height as f64 - if s.suspended { 187.0 } else { 156.0 } * zoom).max(r.position.y as f64),
    );
    geometry(w, s, x, y)
}
pub fn nearest_side(x: f64, width: f64, left: f64, right: f64) -> Side {
    if (x - left).abs() <= (right - x - width).abs() {
        Side::Left
    } else {
        Side::Right
    }
}
pub fn drag_side_enabled(
    enabled: bool,
    x: f64,
    width: f64,
    left: f64,
    right: f64,
    threshold: f64,
) -> Option<Side> {
    if enabled {
        drag_side(x, width, left, right, threshold)
    } else {
        None
    }
}
fn dock_origin(side: Side, left: f64, right: f64, width: f64) -> f64 {
    if side == Side::Right {
        right - width.round()
    } else {
        left
    }
}
pub fn drag_side(x: f64, width: f64, left: f64, right: f64, threshold: f64) -> Option<Side> {
    if x <= left + threshold {
        Some(Side::Left)
    } else if x + width >= right - threshold {
        Some(Side::Right)
    } else {
        None
    }
}
pub fn resize_if_docked(app: &tauri::AppHandle, scale: f64) -> Result<bool, String> {
    let state = app.state::<Docking>();
    let mut s = state.inner.lock().map_err(|e| e.to_string())?;
    s.scale = scale;
    if s.view.side.is_none() {
        return Ok(false);
    }
    let w = window(app)?;
    snap(&w, &mut s, false)?;
    Ok(true)
}
#[tauri::command]
pub async fn configure_pomodoro_docking(
    app: tauri::AppHandle,
    auto_dock: bool,
    paused: bool,
    phase: String,
    scale: f64,
    suspended: bool,
) -> Result<Snapshot, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let w = window(&app)?;
        let state = app.state::<Docking>();
        let mut s = state.inner.lock().map_err(|e| e.to_string())?;
        if !matches!(phase.as_str(), "focus" | "break" | "completed") {
            return Err("invalid pomodoro phase".into());
        }
        if !scale.is_finite() || scale <= 0.0 {
            return Err("invalid UI scale".into());
        }
        let scale_changed = s.scale != scale;
        s.scale = scale;
        let phase_changed = s.update_phase(phase);
        let pause_changed = s.paused != paused;
        let changed = pause_changed || phase_changed || scale_changed;
        s.auto_dock = auto_dock;
        s.update_pause(paused);
        if !s.restored {
            s.restored = true;
            restore(&app, &w, &mut s)?;
        }
        let suspension_changed = s.suspended != suspended;
        if suspension_changed {
            s.gain_focus();
            if suspended && s.view.side.is_some() {
                let p = w.outer_position().map_err(|e| e.to_string())?;
                s.suspended_origin = Some((p.x as f64, p.y as f64));
            }
            s.suspended = suspended;
            if !suspended {
                if let Some((x, y)) = s.suspended_origin.take() {
                    if s.auto_dock && s.view.side.is_some() { geometry(&w, &s, x, y)?; }
                }
            }
        }
        if !s.auto_dock && s.view.side.is_some() && !s.view.dragging {
            let side = s.view.side.unwrap();
            let p = w.outer_position().map_err(|e| e.to_string())?;
            let m = w
                .current_monitor()
                .map_err(|e| e.to_string())?
                .ok_or("monitor unavailable")?;
            let r = m.work_area();
            let z = w.scale_factor().map_err(|e| e.to_string())? * s.scale;
            let x = dock_origin(
                side,
                r.position.x as f64,
                r.position.x as f64 + r.size.width as f64,
                215.0 * z,
            );
            s.keep_open_until_blur = false;
            s.monitor_origin = None;
            s.view.side = None;
            s.view.expanded = false;
            geometry(&w, &s, x, p.y as f64)?;
            save(&app, &w, &s)?;
        }
        if (changed || suspension_changed) && s.view.side.is_some() && !s.view.dragging {
            snap(&w, &mut s, false)?;
        }
        if phase_changed || pause_changed {
            if let Some(token) = s.focus_notice_token(w.is_focused().unwrap_or(true)) {
                schedule_focus_notice_collapse(app.clone(), token);
            }
        }
        Ok(s.displayed_view())
    })
    .await
    .map_err(|e| e.to_string())?
}

const FOCUS_NOTICE_DURATION: std::time::Duration = std::time::Duration::from_secs(5);
fn schedule_focus_notice_collapse(app: tauri::AppHandle, token: u64) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(FOCUS_NOTICE_DURATION).await;
        let _ = tauri::async_runtime::spawn_blocking(move || {
            let state = app.state::<Docking>();
            if state.stop.load(Ordering::Relaxed) { return; }
            let Ok(w) = window(&app) else { return; };
            let Ok(mut s) = state.inner.lock() else { return; };
            if s.expire_focus_notice(token, w.is_focused().unwrap_or(true)) {
                emit(&w, &s);
            }
        }).await;
    });
}
#[tauri::command]
pub async fn hover_pomodoro_docking(
    app: tauri::AppHandle,
    hovered: bool,
) -> Result<Snapshot, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let w = window(&app)?;
        let state = app.state::<Docking>();
        let mut s = state.inner.lock().map_err(|e| e.to_string())?;
        if s.view.side.is_some() && !s.view.dragging && !s.suspended {
            let expanded = s.expanded_for_hover(hovered);
            if expanded != s.view.expanded {
                s.view.expanded = expanded;
                // Hover only changes painted content; never resize or move the native window.
                emit(&w, &s);
            }
        }
        Ok(s.displayed_view())
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn drag_pomodoro_window(app: tauri::AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let w = window(&app)?;
        let state = app.state::<Docking>();
        let suspended = state.inner.lock().map_err(|e| e.to_string())?.suspended;
        if suspended { return w.start_dragging().map_err(|e| e.to_string()); }
        let (start, anchor_x, anchor_y) = {
            let mut s = state.inner.lock().map_err(|e| e.to_string())?;
            if s.view.dragging {
                return Ok(());
            }
            let c = w.cursor_position().map_err(|e| e.to_string())?;
            let p = w.outer_position().map_err(|e| e.to_string())?;
            let size = w.outer_size().map_err(|e| e.to_string())?;
            let z = w.scale_factor().map_err(|e| e.to_string())? * s.scale;
            let ax = if s.view.side == Some(Side::Right) {
                215.0 * z - (size.width as f64 - (c.x - p.x as f64))
            } else {
                c.x - p.x as f64
            };
            s.gain_focus();
            s.view.dragging = true;
            emit(&w, &s);
            (c, ax / z, (c.y - p.y as f64) / z)
        };
        let result = (|| {
            let mut moved = false;
            while !state.stop.load(Ordering::Relaxed) && pressed() {
                let c = w.cursor_position().map_err(|e| e.to_string())?;
                if !moved && (c.x - start.x).hypot(c.y - start.y) < 4.0 {
                    std::thread::sleep(std::time::Duration::from_millis(16));
                    continue;
                }
                moved = true;
                let m = w
                    .monitor_from_point(c.x, c.y)
                    .map_err(|e| e.to_string())?
                    .or(w.current_monitor().map_err(|e| e.to_string())?)
                    .ok_or("monitor unavailable")?;
                let r = m.work_area();
                let mut s = state.inner.lock().map_err(|e| e.to_string())?;
                s.keep_open_until_blur = false;
                s.monitor_origin = Some((m.position().x, m.position().y));
                let z = w.scale_factor().map_err(|e| e.to_string())? * s.scale;
                let x = c.x - anchor_x * z;
                let y = c.y - anchor_y * z;
                s.view.side = drag_side_enabled(
                    s.auto_dock,
                    x,
                    215.0 * z,
                    r.position.x as f64,
                    (r.position.x as f64) + r.size.width as f64,
                    16.0 * z,
                );
                s.view.expanded = s.view.side.is_some();
                let x = match s.view.side {
                    Some(Side::Left) => r.position.x as f64,
                    Some(Side::Right) => r.position.x as f64 + r.size.width as f64 - 56.0 * z,
                    None => x,
                };
                geometry(&w, &s, x, y)?;
                drop(s);
                std::thread::sleep(std::time::Duration::from_millis(16));
            }
            Ok::<_, String>(())
        })();
        let mut s = state.inner.lock().map_err(|e| e.to_string())?;
        s.view.dragging = false;
        if s.view.side.is_some() {
            snap(&w, &mut s, false)?;
        } else {
            emit(&w, &s);
        }
        save(&app, &w, &s)?;
        drop(s);
        let _ = crate::window_layout::save_current_layout(&app, &w, "main");
        result
    })
    .await
    .map_err(|e| e.to_string())?
}
pub fn install(app: &tauri::AppHandle) {
    if let Ok(w) = window(app) {
        let app = app.clone();
        w.on_window_event(move |e| {
            if matches!(e, tauri::WindowEvent::Focused(true)) {
                let app = app.clone();
                tauri::async_runtime::spawn_blocking(move || {
                    if let Ok(mut s) = app.state::<Docking>().inner.lock() { s.gain_focus(); }
                });
            }
            if matches!(e, tauri::WindowEvent::Focused(false)) {
                let app = app.clone();
                tauri::async_runtime::spawn_blocking(move || {
                    let state = app.state::<Docking>();
                    let Ok(mut s) = state.inner.lock() else {
                        return;
                    };
                    s.lose_focus();
                    if s.auto_dock && !s.view.dragging && !s.suspended {
                        if let Ok(w) = window(&app) {
                            if let Err(e) = snap(&w, &mut s, true).and_then(|()| save(&app, &w, &s))
                            {
                                eprintln!("[docking] {e}");
                            }
                        }
                    }
                });
            }
        });
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn closest_edges_include_negative_monitors() {
        assert_eq!(nearest_side(-1800.0, 215.0, -1920.0, 0.0), Side::Left);
        assert_eq!(nearest_side(-300.0, 215.0, -1920.0, 0.0), Side::Right);
    }
    #[test]
    fn drag_restores_full_between_edges() {
        assert_eq!(drag_side(200.0, 215.0, 0.0, 1000.0, 16.0), None);
        assert_eq!(drag_side(10.0, 215.0, 0.0, 1000.0, 16.0), Some(Side::Left));
        assert_eq!(
            drag_side(780.0, 215.0, 0.0, 1000.0, 16.0),
            Some(Side::Right)
        );
    }
}

#[derive(Serialize, Deserialize)]
struct SavedDock {
    side: Option<Side>,
    monitor_x: i32,
    monitor_y: i32,
    y_fraction: f64,
}
fn saved_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("pomodoro-docking.json"))
}
fn save(app: &tauri::AppHandle, w: &tauri::WebviewWindow, s: &Inner) -> Result<(), String> {
    if s.suspended { return Ok(()); }
    let m = docking_monitor(w, s)?;
    let r = m.work_area();
    let p = w.outer_position().map_err(|e| e.to_string())?;
    let h = 156.0 * w.scale_factor().map_err(|e| e.to_string())? * s.scale;
    let fraction =
        ((p.y - r.position.y) as f64 / (r.size.height as f64 - h).max(1.0)).clamp(0.0, 1.0);
    let saved = SavedDock {
        side: s.view.side,
        monitor_x: r.position.x + (r.size.width / 2) as i32,
        monitor_y: r.position.y + (r.size.height / 2) as i32,
        y_fraction: fraction,
    };
    let path = saved_path(app)?;
    let temp = path.with_extension("tmp");
    std::fs::write(
        &temp,
        serde_json::to_vec(&saved).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    std::fs::rename(temp, path).map_err(|e| e.to_string())
}
fn restore(app: &tauri::AppHandle, w: &tauri::WebviewWindow, s: &mut Inner) -> Result<(), String> {
    if !s.auto_dock {
        return Ok(());
    }
    let Ok(raw) = std::fs::read(saved_path(app)?) else {
        return Ok(());
    };
    let Ok(saved) = serde_json::from_slice::<SavedDock>(&raw) else {
        return Ok(());
    };
    if saved.side.is_none() || !saved.y_fraction.is_finite() {
        return Ok(());
    }
    let m = w
        .monitor_from_point(saved.monitor_x as f64, saved.monitor_y as f64)
        .map_err(|e| e.to_string())?
        .or(w.current_monitor().map_err(|e| e.to_string())?)
        .ok_or("monitor unavailable")?;
    let r = m.work_area();
    s.monitor_origin = Some((m.position().x, m.position().y));
    s.view.side = saved.side;
    s.view.expanded = s.expanded_for_hover(false);
    let z = w.scale_factor().map_err(|e| e.to_string())? * s.scale;
    let width = dock_frame_width(s.paused) * z;
    let x = if saved.side == Some(Side::Left) {
        r.position.x as f64
    } else {
        r.position.x as f64 + r.size.width as f64 - width
    };
    let y = r.position.y as f64
        + saved.y_fraction.clamp(0.0, 1.0) * (r.size.height as f64 - 156.0 * z).max(0.0);
    geometry(w, s, x, y)
}

#[cfg(test)]
mod regression_tests {
    use super::*;
    #[test]
    fn disabled_mode_never_snaps_on_drag() {
        assert_eq!(
            drag_side_enabled(false, 0.0, 215.0, 0.0, 1000.0, 16.0),
            None
        );
        assert_eq!(
            drag_side_enabled(false, 790.0, 215.0, 0.0, 1000.0, 16.0),
            None
        );
    }
    #[test]
    fn hover_keeps_edge_when_native_size_read_is_stale() {
        // Resizing is queued by the OS. Position can be new while size still reports the old strip.
        assert_eq!(dock_origin(Side::Right, 0.0, 1000.0, 22.0), 978.0);
        assert_eq!(dock_origin(Side::Left, 0.0, 1000.0, 22.0), 0.0);
    }
}

#[cfg(test)]
mod adjacent_screen_tests {
    use super::*;
    #[test]
    fn entering_from_adjacent_screen_keeps_docked_monitor() {
        assert_eq!(monitor_index(Some((0, 0)), &[(0, 0), (1920, 0)], 1), 0);
        assert_eq!(monitor_index(Some((1920, 0)), &[(0, 0), (1920, 0)], 0), 1);
    }
    #[test]
    fn removed_monitor_falls_back() {
        assert_eq!(monitor_index(Some((1920, 0)), &[(0, 0)], 0), 0);
    }
}

#[cfg(test)]
mod frame_order_tests {
    use super::*;
    #[test]
    fn right_expansion_never_temporarily_crosses_boundary() {
        let (x, width, new_x, new_width) = (978, 22, 944, 56);
        assert!(move_before_resize(x, width, new_x, new_width));
        assert!(new_x + width as i32 <= 1000);
        assert!(!move_before_resize(new_x, new_width, x, width));
    }
}

#[cfg(test)]
mod stable_hover_tests {
    use super::*;
    #[test]
    fn hovering_never_changes_native_frame() {
        assert_eq!(dock_frame_width(false), dock_frame_width(true));
    }
    #[test]
    fn collapsed_transparent_space_passes_through_on_both_sides() {
        let (w, h, x, y) = dock_hit_region(2, 56.0, 156.0, 10.0, 80.0);
        assert!(!crate::window_helpers::point_in_rounded_rect(
            w, h, 11.0, x, y
        ));
        let (w, h, x, y) = dock_hit_region(2, 56.0, 156.0, 45.0, 80.0);
        assert!(crate::window_helpers::point_in_rounded_rect(
            w, h, 11.0, x, y
        ));
        let (w, h, x, y) = dock_hit_region(1, 56.0, 156.0, 40.0, 80.0);
        assert!(!crate::window_helpers::point_in_rounded_rect(
            w, h, 11.0, x, y
        ));
    }
}

#[cfg(test)]
mod resume_focus_tests {
    use super::*;
    #[test]
    fn resume_stays_expanded_until_native_focus_is_lost() {
        let mut s = Inner::default();
        s.view.side = Some(Side::Right);
        s.update_pause(true);
        s.update_pause(false);
        assert!(s.expanded_for_hover(false));
        s.lose_focus();
        assert!(!s.expanded_for_hover(false));
    }
    #[test]
    fn ordinary_hover_still_collapses_on_leave_and_pause_stays_open() {
        let mut s = Inner::default();
        s.view.side = Some(Side::Left);
        assert!(s.expanded_for_hover(true));
        assert!(!s.expanded_for_hover(false));
        s.update_pause(true);
        s.lose_focus();
        assert!(s.expanded_for_hover(false));
    }
}

#[cfg(test)]
mod phase_notice_tests {
    use super::*;
    #[test]
    fn stage_change_expands_until_next_focus_loss() {
        let mut s = Inner::default();
        s.view.side = Some(Side::Left);
        assert!(!s.update_phase("focus".into()));
        assert!(!s.expanded_for_hover(false));
        assert!(s.update_phase("break".into()));
        assert!(s.expanded_for_hover(false));
        s.lose_focus();
        assert!(!s.expanded_for_hover(false));
        assert!(!s.update_phase("break".into()));
        assert!(!s.expanded_for_hover(false));
        assert!(s.update_phase("completed".into()));
        assert!(s.expanded_for_hover(false));
    }
    #[test]
    fn full_timer_stage_change_does_not_enable_docking() {
        let mut s = Inner::default();
        s.update_phase("focus".into());
        s.update_phase("break".into());
        assert!(s.view.side.is_none());
        assert!(!s.keep_open_until_blur);
    }
}

#[cfg(test)]
mod corner_tests {
    use super::*;
    #[test]
    fn strip_and_block_keep_same_corner_at_every_scale() {
        for scale in [1.0, 1.5, 2.0] {
            let expected = 11.0 * scale;
            assert_eq!(radius(22.0 * scale, 156.0 * scale), Some(expected));
            assert_eq!(radius(56.0 * scale, 156.0 * scale), Some(expected));
        }
    }
}

#[cfg(test)]
mod focus_notice_timeout_tests {
    use super::*;
    fn notice() -> Inner {
        let mut s = Inner::default();
        s.view.side = Some(Side::Right);
        s.update_phase("break".into());
        s.update_phase("focus".into());
        s.view.expanded = true;
        s
    }
    #[test]
    fn unattended_focus_notice_collapses_when_timer_expires() {
        let mut s = notice();
        let token = s.focus_notice_token(false).unwrap();
        assert!(s.view.expanded);
        assert!(s.expire_focus_notice(token, false));
        assert!(!s.view.expanded);
        assert!(!s.expanded_for_hover(false));
    }
    #[test]
    fn gaining_focus_cancels_timeout_and_preserves_blur_behavior() {
        let mut s = notice();
        let token = s.focus_notice_token(false).unwrap();
        assert!(!s.expire_focus_notice(token, true));
        s.gain_focus();
        assert!(!s.expire_focus_notice(token, false));
        assert!(s.view.expanded);
        s.lose_focus();
        assert!(!s.expanded_for_hover(false));
    }
    #[test]
    fn break_pause_and_resume_ignore_old_focus_timeout() {
        for phase in ["break", "completed"] {
            let mut s = notice();
            let token = s.focus_notice_token(false).unwrap();
            s.update_phase(phase.into());
            assert!(!s.expire_focus_notice(token, false));
            assert!(s.view.expanded);
        }
        let mut s = notice();
        let token = s.focus_notice_token(false).unwrap();
        s.update_pause(true);
        assert!(!s.expire_focus_notice(token, false));
        s.update_pause(false);
        assert!(!s.expire_focus_notice(token, false));
        assert!(s.view.expanded);
    }
    #[test]
    fn dragging_and_subsequent_phase_changes_invalidate_old_timeout() {
        let mut s = notice();
        let token = s.focus_notice_token(false).unwrap();
        s.view.dragging = true;
        assert!(!s.expire_focus_notice(token, false));
        s.view.dragging = false;
        s.update_phase("break".into());
        s.update_phase("focus".into());
        assert!(!s.expire_focus_notice(token, false));
        assert!(s.expire_focus_notice(s.focus_notice_token(false).unwrap(), false));
    }
}

#[cfg(test)]
mod notice_suspension_tests {
    use super::*;
    #[test]
    fn full_notification_preserves_original_dock_on_both_edges() {
        for side in [Side::Left, Side::Right] {
            let mut s = Inner::default();
            s.view.side = Some(side);
            s.monitor_origin = Some((-1920, 0));
            s.suspended_origin = Some((-56.0, 420.0));
            s.suspended = true;
            assert!(s.displayed_view().side.is_none());
            assert_eq!(s.view.side, Some(side));
            s.lose_focus();
            assert!(s.displayed_view().side.is_none());
            s.suspended = false;
            assert_eq!(s.displayed_view().side, Some(side));
            assert_eq!(s.suspended_origin, Some((-56.0, 420.0)));
            assert_eq!(s.monitor_origin, Some((-1920, 0)));
        }
    }
    #[test]
    fn focus_timer_cannot_collapse_a_full_notification() {
        let mut s = Inner::default();
        s.view.side = Some(Side::Right);
        s.update_phase("break".into());
        s.update_phase("focus".into());
        let token = s.focus_notice_token(false).unwrap();
        s.suspended = true;
        assert!(!s.expire_focus_notice(token, false));
    }
}
