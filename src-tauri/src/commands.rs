use crate::capture::{self, CaptureSession, Region};
use crate::settings::{self, Settings};
use crate::{clipboard, filename, overlay, pin, shortcuts, tray, winutil, AppState};
use base64::Engine;
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
use tauri::{AppHandle, Emitter, Manager, PhysicalSize};
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_opener::OpenerExt;

const IMAGE_EXTS: &[&str] = &["png", "jpg", "jpeg", "webp"];

pub fn notify(app: &AppHandle, title: &str, body: &str) {
    let enabled = app
        .state::<AppState>()
        .settings
        .lock()
        .unwrap()
        .general
        .notifications;
    if !enabled {
        return;
    }
    let _ = app.notification().builder().title(title).body(body).show();
}

pub fn notify_error(app: &AppHandle, title: &str, body: &str) {
    let _ = app.notification().builder().title(title).body(body).show();
}

fn monitor_at(shots: &[capture::MonitorShot], x: i32, y: i32) -> usize {
    shots
        .iter()
        .position(|s| x >= s.x && x < s.x + s.width as i32 && y >= s.y && y < s.y + s.height as i32)
        .or_else(|| shots.iter().position(|s| s.is_primary))
        .unwrap_or(0)
}

// ---------------------------------------------------------------------------
// Action dispatch (tray, global shortcuts, commands)
// ---------------------------------------------------------------------------

pub fn run_action(app: AppHandle, action: &str) {
    match action {
        "region" => spawn_capture(app, CaptureMode::Region),
        "fullscreen" => spawn_capture(app, CaptureMode::Fullscreen),
        "active-window" => spawn_capture(app, CaptureMode::ActiveWindow),
        "previous-region" => spawn_capture(app, CaptureMode::PreviousRegion),
        "copy-last-path" => {
            if let Err(e) = do_copy_last_path(&app) {
                notify_error(&app, "Couldn't copy path", &e);
            }
        }
        "open-folder" => {
            let folder = app
                .state::<AppState>()
                .settings
                .lock()
                .unwrap()
                .output
                .folder
                .clone();
            let _ = fs::create_dir_all(&folder);
            let _ = app.opener().open_path(folder, None::<&str>);
        }
        "open-settings" => tray::show_main(&app, "general"),
        _ => {}
    }
}

pub enum CaptureMode {
    Region,
    Fullscreen,
    ActiveWindow,
    PreviousRegion,
}

/// Build overlay windows ahead of time so the first shortcut press is as fast
/// as every later one.
pub fn prewarm(app: &AppHandle) {
    match capture::monitor_layout() {
        Ok(monitors) => {
            if let Err(e) = overlay::ensure_overlays(app, &monitors) {
                crate::dlog(&format!("prewarm failed: {e}"));
            } else {
                crate::dlog(&format!("overlays pre-warmed for {} monitors", monitors.len()));
            }
        }
        Err(e) => crate::dlog(&format!("prewarm: {e}")),
    }
}

fn spawn_capture(app: AppHandle, mode: CaptureMode) {
    let state = app.state::<AppState>();
    if state.capture_active.swap(true, Ordering::SeqCst) {
        crate::dlog("capture already in progress, ignoring");
        return;
    }
    std::thread::spawn(move || {
        if let Err(e) = start_capture(&app, mode) {
            crate::dlog(&format!("capture failed: {e}"));
            end_capture(&app);
            notify_error(&app, "Capture failed", &e);
        }
    });
}

/// Clear capture state and put the overlays away.
fn end_capture(app: &AppHandle) {
    let state = app.state::<AppState>();
    *state.session.lock().unwrap() = None;
    overlay::hide_overlays(app);
    state.capture_active.store(false, Ordering::SeqCst);
}

fn start_capture(app: &AppHandle, mode: CaptureMode) -> Result<(), String> {
    let started = std::time::Instant::now();
    *app.state::<AppState>().capture_started.lock().unwrap() = Some(started);
    let prev_focus = winutil::foreground_window();
    *app.state::<AppState>().prev_focus.lock().unwrap() = prev_focus;

    let shots = capture::capture_all_monitors()?;
    let grabbed = started.elapsed().as_millis();
    let infos: Vec<capture::MonitorInfo> = shots.iter().map(|s| s.info()).collect();

    // Region capture needs the selection overlay; every other mode already
    // knows its rectangle and goes straight to the editor.
    let region = match mode {
        CaptureMode::Region => None,
        CaptureMode::Fullscreen => {
            let (cx, cy) = winutil::cursor_pos();
            let idx = monitor_at(&shots, cx, cy);
            Some(Region {
                monitor: idx,
                x: 0,
                y: 0,
                w: shots[idx].width,
                h: shots[idx].height,
            })
        }
        CaptureMode::ActiveWindow => {
            let (wx, wy, ww, wh) =
                winutil::foreground_window_bounds().ok_or("no active window found")?;
            let idx = monitor_at(&shots, wx + ww / 2, wy + wh / 2);
            let s = &shots[idx];
            let ix1 = wx.max(s.x);
            let iy1 = wy.max(s.y);
            let ix2 = (wx + ww).min(s.x + s.width as i32);
            let iy2 = (wy + wh).min(s.y + s.height as i32);
            if ix2 <= ix1 || iy2 <= iy1 {
                return Err("active window is off-screen".into());
            }
            Some(Region {
                monitor: idx,
                x: (ix1 - s.x) as u32,
                y: (iy1 - s.y) as u32,
                w: (ix2 - ix1) as u32,
                h: (iy2 - iy1) as u32,
            })
        }
        CaptureMode::PreviousRegion => {
            let prev = app
                .state::<AppState>()
                .prev_region
                .lock()
                .unwrap()
                .ok_or("no previous region yet")?;
            if prev.monitor >= shots.len() {
                return Err("previous monitor is no longer available".into());
            }
            Some(prev)
        }
    };

    if let Some(r) = region {
        let path = write_region(app, &shots[r.monitor], r)?;
        end_capture(app);
        open_editor(app, &path)?;
        crate::dlog(&format!("direct capture done in {}ms", started.elapsed().as_millis()));
        return Ok(());
    }

    // Publish the session before the windows exist: an overlay created here
    // (first run, or after a monitor change) mounts and asks for its frame
    // immediately, which would race the event below.
    *app.state::<AppState>().session.lock().unwrap() = Some(CaptureSession {
        monitors: shots,
        saved_path: None,
        region: None,
        prev_focus,
    });
    overlay::ensure_overlays(app, &infos)?;
    for info in &infos {
        let _ = app.emit_to(overlay::label_for(info.index), "capture-start", info.index);
    }
    crate::dlog(&format!(
        "capture ready: grab {grabbed}ms, dispatch {}ms",
        started.elapsed().as_millis()
    ));
    Ok(())
}

/// Crop a region out of a frozen frame and write it to the screenshots folder.
fn write_region(
    app: &AppHandle,
    shot: &capture::MonitorShot,
    r: Region,
) -> Result<PathBuf, String> {
    let snapshot = app.state::<AppState>().settings.lock().unwrap().clone();
    let img = capture::crop(shot, r.x, r.y, r.w, r.h);
    let ext = capture::extension_for_format(&snapshot.output.format);
    let path = filename::unique_path(
        Path::new(&snapshot.output.folder),
        &snapshot.output.filename_pattern,
        ext,
        img.width(),
        img.height(),
    );
    capture::encode_and_write(&img, &path, &snapshot.output.format, snapshot.output.quality)?;
    crate::history::record(app, &path);
    let state = app.state::<AppState>();
    *state.last_saved.lock().unwrap() = Some(path.clone());
    if snapshot.capture.remember_previous_region {
        *state.prev_region.lock().unwrap() = Some(r);
    }
    Ok(path)
}

/// Bring the app forward showing the editor for `path`. An editor that is
/// already on screen just swaps to the new capture — resizing and recentring
/// a window the user is working in would be disruptive.
fn open_editor(app: &AppHandle, path: &Path) -> Result<(), String> {
    let win = app
        .get_webview_window("main")
        .ok_or("main window unavailable")?;
    let already_open = win.is_visible().unwrap_or(false);

    if already_open {
        let _ = win.set_focus();
        let _ = app.emit_to("main", "open-editor", path.to_string_lossy().to_string());
        return Ok(());
    }

    tray::show_main(app, "editor");
    if let Ok((iw, ih)) = image::image_dimensions(path) {
        let (max_w, max_h) = win
            .current_monitor()
            .ok()
            .flatten()
            .map(|m| {
                let s = m.size();
                ((s.width as f64 * 0.92) as u32, (s.height as f64 * 0.92) as u32)
            })
            .unwrap_or((1600, 1000));
        // Chrome around the canvas: toolbar, action bar and recent strip.
        let want_w = (iw + 96).clamp(880, max_w.max(880));
        let want_h = (ih + 268).clamp(620, max_h.max(620));
        let _ = win.set_size(PhysicalSize::new(want_w, want_h));
        let _ = win.center();
    }
    let _ = win.set_focus();
    let _ = app.emit_to("main", "open-editor", path.to_string_lossy().to_string());
    Ok(())
}

fn do_copy_last_path(app: &AppHandle) -> Result<(), String> {
    let state = app.state::<AppState>();
    let snapshot = state.settings.lock().unwrap().clone();
    let last = state.last_saved.lock().unwrap().clone();
    let path = match last {
        Some(p) if p.exists() => p,
        _ => newest_capture(Path::new(&snapshot.output.folder)).ok_or("no screenshots yet")?,
    };
    let (w, h) = image::image_dimensions(&path).unwrap_or((0, 0));
    let text = filename::format_path_template(&snapshot.output.path_format, &path, w, h);
    clipboard::copy_text(&text)?;
    notify(
        app,
        "Path copied",
        &path
            .file_name()
            .map(|f| f.to_string_lossy().to_string())
            .unwrap_or_default(),
    );
    Ok(())
}

fn newest_capture(folder: &Path) -> Option<PathBuf> {
    let mut best: Option<(std::time::SystemTime, PathBuf)> = None;
    for entry in fs::read_dir(folder).ok()?.flatten() {
        let path = entry.path();
        let ext = path
            .extension()
            .map(|e| e.to_string_lossy().to_lowercase())
            .unwrap_or_default();
        if !IMAGE_EXTS.contains(&ext.as_str()) {
            continue;
        }
        let Ok(modified) = entry.metadata().and_then(|m| m.modified()) else {
            continue;
        };
        if best.as_ref().map(|(t, _)| modified > *t).unwrap_or(true) {
            best = Some((modified, path));
        }
    }
    best.map(|(_, p)| p)
}

// ---------------------------------------------------------------------------
// Settings commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn get_settings(app: AppHandle) -> Settings {
    app.state::<AppState>().settings.lock().unwrap().clone()
}

#[tauri::command]
pub fn set_settings(app: AppHandle, settings: Settings) -> Result<Vec<String>, String> {
    settings::save(&app, &settings)?;
    *app.state::<AppState>().settings.lock().unwrap() = settings.clone();
    {
        use tauri_plugin_autostart::ManagerExt;
        let autolaunch = app.autolaunch();
        if settings.general.launch_at_startup {
            let _ = autolaunch.enable();
        } else {
            let _ = autolaunch.disable();
        }
    }
    let errors = shortcuts::register_all(&app, &settings);
    tray::refresh(&app, &settings);
    let _ = app.emit("settings-changed", &settings);
    Ok(errors)
}

#[tauri::command]
pub fn validate_folder(path: String) -> Result<(), String> {
    let p = PathBuf::from(&path);
    fs::create_dir_all(&p).map_err(|e| format!("Cannot create this folder: {e}"))?;
    let test = p.join(".clipath-write-test");
    fs::write(&test, b"ok").map_err(|e| format!("This folder is not writable: {e}"))?;
    let _ = fs::remove_file(&test);
    Ok(())
}

#[tauri::command]
pub fn get_default_folder(app: AppHandle) -> String {
    settings::default_screenshot_folder(&app)
}

#[tauri::command]
pub fn suspend_shortcuts(app: AppHandle) {
    use tauri_plugin_global_shortcut::GlobalShortcutExt;
    let _ = app.global_shortcut().unregister_all();
    if let Some(state) = app.try_state::<AppState>() {
        state.shortcut_map.lock().unwrap().clear();
    }
}

#[tauri::command]
pub fn resume_shortcuts(app: AppHandle) -> Vec<String> {
    let settings = app.state::<AppState>().settings.lock().unwrap().clone();
    shortcuts::register_all(&app, &settings)
}

#[tauri::command]
pub fn check_shortcut_available(app: AppHandle, shortcut: String) -> Result<bool, String> {
    let normalized = shortcuts::normalize(&shortcut).ok_or("invalid shortcut")?;
    let parsed: tauri_plugin_global_shortcut::Shortcut =
        normalized.parse().map_err(|_| "invalid shortcut")?;
    use tauri_plugin_global_shortcut::GlobalShortcutExt;
    if app.global_shortcut().is_registered(parsed) {
        return Ok(true);
    }
    match app.global_shortcut().register(parsed) {
        Ok(()) => {
            let _ = app.global_shortcut().unregister(parsed);
            Ok(true)
        }
        Err(_) => Ok(false),
    }
}

#[tauri::command]
pub fn app_info(app: AppHandle) -> serde_json::Value {
    serde_json::json!({
        "version": env!("CARGO_PKG_VERSION"),
        "configDir": app
            .path()
            .app_config_dir()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default(),
    })
}

// ---------------------------------------------------------------------------
// Capture overlay commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn trigger_capture(app: AppHandle, mode: String) {
    run_action(app, &mode);
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OverlayData {
    pub monitor: capture::MonitorInfo,
    pub settings: Settings,
}

#[tauri::command]
pub fn get_overlay_info(app: AppHandle, monitor: usize) -> Result<OverlayData, String> {
    let state = app.state::<AppState>();
    let settings = state.settings.lock().unwrap().clone();
    let session = state.session.lock().unwrap();
    let session = session.as_ref().ok_or("no capture session")?;
    let shot = session
        .monitors
        .get(monitor)
        .ok_or("monitor not in session")?;
    Ok(OverlayData {
        monitor: shot.info(),
        settings,
    })
}

/// Raw RGBA pixels of a monitor's frozen frame. Raw beats an encoded format
/// here: no encoder in Rust, no decoder in the browser, and the bytes go
/// straight into an ImageBitmap.
#[tauri::command]
pub fn get_overlay_frame(app: AppHandle, monitor: usize) -> Result<tauri::ipc::Response, String> {
    let state = app.state::<AppState>();
    let session = state.session.lock().unwrap();
    let session = session.as_ref().ok_or("no capture session")?;
    let shot = session
        .monitors
        .get(monitor)
        .ok_or("monitor not in session")?;
    Ok(tauri::ipc::Response::new(shot.image.as_raw().clone()))
}

#[tauri::command]
pub fn overlay_ready(app: AppHandle, monitor: usize) -> Result<(), String> {
    let win = app
        .get_webview_window(&overlay::label_for(monitor))
        .ok_or("overlay window missing")?;
    win.show().map_err(|e| e.to_string())?;
    let _ = win.set_always_on_top(true);

    if let Some(t) = *app.state::<AppState>().capture_started.lock().unwrap() {
        crate::dlog(&format!(
            "overlay {monitor} visible {}ms after shortcut",
            t.elapsed().as_millis()
        ));
    }

    let (cx, cy) = winutil::cursor_pos();
    let state = app.state::<AppState>();
    let session = state.session.lock().unwrap();
    if let Some(session) = session.as_ref() {
        if let Some(shot) = session.monitors.get(monitor) {
            let inside = cx >= shot.x
                && cx < shot.x + shot.width as i32
                && cy >= shot.y
                && cy < shot.y + shot.height as i32;
            if inside {
                let _ = win.set_focus();
            }
        }
    }
    Ok(())
}

/// Selection finished: crop, save, dismiss the overlay, open the editor.
#[tauri::command]
pub fn commit_region(
    app: AppHandle,
    monitor: usize,
    x: u32,
    y: u32,
    w: u32,
    h: u32,
) -> Result<String, String> {
    crate::dlog(&format!("commit_region(mon={monitor}, {x},{y} {w}x{h})"));
    let region = Region { monitor, x, y, w, h };
    let path = {
        let state = app.state::<AppState>();
        let guard = state.session.lock().unwrap();
        let session = guard.as_ref().ok_or("no capture session")?;
        let shot = session
            .monitors
            .get(monitor)
            .ok_or("monitor not in session")?;
        write_region(&app, shot, region)?
    };
    end_capture(&app);
    open_editor(&app, &path)?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn cancel_capture(app: AppHandle) {
    let prev_focus = {
        let state = app.state::<AppState>();
        let taken = state.session.lock().unwrap().take();
        taken.map(|s| s.prev_focus).unwrap_or(0)
    };
    end_capture(&app);
    winutil::restore_foreground(prev_focus);
}

// ---------------------------------------------------------------------------
// Editor commands
// ---------------------------------------------------------------------------

/// File bytes for the editor. Served over IPC (not the asset protocol) so the
/// annotation canvas stays same-origin and can still be exported.
#[tauri::command]
pub fn read_image(path: String) -> Result<tauri::ipc::Response, String> {
    let bytes = fs::read(&path).map_err(|e| format!("cannot read image: {e}"))?;
    Ok(tauri::ipc::Response::new(bytes))
}

/// Render → write → verify → clipboard, in that order: the copied path always
/// points at a file that is already fully written.
#[tauri::command]
pub fn finalize_image(
    app: AppHandle,
    path: String,
    action: String,
    image_base64: String,
) -> Result<String, String> {
    let state = app.state::<AppState>();
    let snapshot = state.settings.lock().unwrap().clone();
    let target = PathBuf::from(&path);

    let b64 = image_base64
        .split_once("base64,")
        .map(|(_, d)| d)
        .unwrap_or(&image_base64);
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(b64)
        .map_err(|e| format!("bad image data: {e}"))?;
    let img = image::load_from_memory(&bytes)
        .map_err(|e| format!("cannot decode rendered image: {e}"))?
        .to_rgba8();

    let ext = target
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_else(|| snapshot.output.format.clone());
    capture::encode_and_write(&img, &target, &ext, snapshot.output.quality)?;
    if !target.exists() {
        return Err("screenshot file missing after save".into());
    }
    *state.last_saved.lock().unwrap() = Some(target.clone());

    match action.as_str() {
        "copy-path" => {
            let text = filename::format_path_template(
                &snapshot.output.path_format,
                &target,
                img.width(),
                img.height(),
            );
            clipboard::copy_text(&text)?;
        }
        "copy-image" => clipboard::copy_image_rgba(img.width(), img.height(), img.as_raw())?,
        "pin" => pin::create_pin(&app, &path, None)?,
        _ => {}
    }

    let fname = target
        .file_name()
        .map(|f| f.to_string_lossy().to_string())
        .unwrap_or_default();
    match action.as_str() {
        "copy-path" => notify(&app, "Path copied", &fname),
        "copy-image" => notify(&app, "Image copied", &fname),
        "save" => notify(&app, "Screenshot saved", &snapshot.output.folder),
        _ => {}
    }
    Ok(target.to_string_lossy().to_string())
}

#[tauri::command]
pub fn save_image_as(app: AppHandle, target: String, image_base64: String) -> Result<(), String> {
    let b64 = image_base64
        .split_once("base64,")
        .map(|(_, d)| d)
        .unwrap_or(&image_base64);
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(b64)
        .map_err(|e| format!("bad image data: {e}"))?;
    let img = image::load_from_memory(&bytes)
        .map_err(|e| format!("cannot decode rendered image: {e}"))?
        .to_rgba8();
    let path = PathBuf::from(&target);
    let ext = path
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_else(|| "png".into());
    let quality = app
        .state::<AppState>()
        .settings
        .lock()
        .unwrap()
        .output
        .quality;
    capture::encode_and_write(&img, &path, &ext, quality)
}

/// Close the editor and hand focus back to whatever the user was doing, so a
/// copied path can be pasted straight away.
#[tauri::command]
pub fn close_editor(app: AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.hide();
    }
    let prev = *app.state::<AppState>().prev_focus.lock().unwrap();
    winutil::restore_foreground(prev);
}

// ---------------------------------------------------------------------------
// Files / clipboard / history commands
// ---------------------------------------------------------------------------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentItem {
    pub path: String,
    pub filename: String,
    pub modified: u64,
}

#[tauri::command]
pub fn list_recent(app: AppHandle, limit: usize) -> Vec<RecentItem> {
    let folder = app
        .state::<AppState>()
        .settings
        .lock()
        .unwrap()
        .output
        .folder
        .clone();
    let index = crate::history::load(&app);
    let mut items: Vec<RecentItem> = Vec::new();
    let Ok(entries) = fs::read_dir(&folder) else {
        return Vec::new();
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let ext = path
            .extension()
            .map(|e| e.to_string_lossy().to_lowercase())
            .unwrap_or_default();
        if !IMAGE_EXTS.contains(&ext.as_str()) {
            continue;
        }
        // Prefer the recorded capture time; re-saving an annotated shot must
        // not reorder the list.
        let taken = crate::history::captured_at(&index, &path).or_else(|| {
            entry
                .metadata()
                .and_then(|m| m.modified())
                .ok()?
                .duration_since(std::time::UNIX_EPOCH)
                .ok()
                .map(|d| d.as_millis() as u64)
        });
        let Some(taken) = taken else { continue };
        items.push(RecentItem {
            filename: path
                .file_name()
                .map(|f| f.to_string_lossy().to_string())
                .unwrap_or_default(),
            path: path.to_string_lossy().to_string(),
            modified: taken,
        });
    }
    // Newest first; filename breaks ties because the default pattern is
    // timestamped and therefore already in chronological order.
    items.sort_by(|a, b| {
        b.modified
            .cmp(&a.modified)
            .then_with(|| b.filename.cmp(&a.filename))
    });
    items.truncate(limit);
    items
}

#[tauri::command]
pub fn copy_path_text(app: AppHandle, path: String) -> Result<(), String> {
    let template = app
        .state::<AppState>()
        .settings
        .lock()
        .unwrap()
        .output
        .path_format
        .clone();
    let p = PathBuf::from(&path);
    let (w, h) = image::image_dimensions(&p).unwrap_or((0, 0));
    clipboard::copy_text(&filename::format_path_template(&template, &p, w, h))
}

#[tauri::command]
pub fn copy_text(text: String) -> Result<(), String> {
    clipboard::copy_text(&text)
}

#[tauri::command]
pub fn copy_image_file(path: String) -> Result<(), String> {
    clipboard::copy_image_file(Path::new(&path))
}

#[tauri::command]
pub fn delete_file(app: AppHandle, path: String) -> Result<(), String> {
    fs::remove_file(&path).map_err(|e| format!("cannot delete: {e}"))?;
    let state = app.state::<AppState>();
    let mut last = state.last_saved.lock().unwrap();
    if last.as_ref().map(|p| p.to_string_lossy() == path) == Some(true) {
        *last = None;
    }
    Ok(())
}

#[tauri::command]
pub fn reveal_in_folder(app: AppHandle, path: String) -> Result<(), String> {
    app.opener()
        .reveal_item_in_dir(&path)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn open_path(app: AppHandle, path: String) -> Result<(), String> {
    app.opener()
        .open_path(path, None::<&str>)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn pin_file(app: AppHandle, path: String) -> Result<(), String> {
    pin::create_pin(&app, &path, None)
}

#[tauri::command]
pub fn get_pin_path(app: AppHandle, label: String) -> Result<String, String> {
    app.state::<AppState>()
        .pins
        .lock()
        .unwrap()
        .get(&label)
        .cloned()
        .ok_or_else(|| "unknown pin".into())
}

#[tauri::command]
pub fn hide_main_window(app: AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.hide();
    }
}
