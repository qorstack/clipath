use crate::capture::{self, CaptureSession, Region};
use crate::settings::{self, Settings};
use crate::{clipboard, filename, overlay, shortcuts, tray, winutil, AppState};
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

/// How long Clipath stays warm after the last capture. Keeping the WebViews
/// alive costs a few hundred megabytes; keeping them alive all day for a tool
/// used in bursts is not a trade worth making, so they are released once the
/// user has clearly moved on and rebuilt on the next capture.
/// Three minutes was too eager. Screenshots come in bursts with gaps of
/// several minutes inside one piece of work, and every release costs the next
/// capture ~2s to rebuild the WebViews — long enough that the shortcut reads
/// as broken. Ten minutes keeps a working session warm while still handing the
/// memory back once the user has genuinely moved on.
const IDLE_RELEASE: std::time::Duration = std::time::Duration::from_secs(600);

/// The idle window, shortened by `CLIPATH_IDLE_SECS` when it is set. Reaching
/// the released-then-woken state is otherwise a ten-minute wait per attempt,
/// which is long enough that the path stops being tested.
fn idle_release_after() -> std::time::Duration {
    match std::env::var("CLIPATH_IDLE_SECS").ok().and_then(|v| v.parse().ok()) {
        Some(secs) => std::time::Duration::from_secs(secs),
        None => IDLE_RELEASE,
    }
}

/// How long a capture that has not yet put an overlay on screen is trusted to
/// still be on its way. Long enough to cover rebuilding the WebViews, short
/// enough that a genuinely wedged capture is retried on the next keypress
/// rather than swallowed.
const STARTUP_GRACE: std::time::Duration = std::time::Duration::from_millis(1500);

pub fn touch_activity(app: &AppHandle) {
    *app.state::<AppState>().last_activity.lock().unwrap() = std::time::Instant::now();
}

/// Tear down the WebViews when nothing has happened for a while. The tray
/// icon and global shortcuts live in the Rust process and are unaffected.
pub fn release_if_idle(app: &AppHandle) {
    let state = app.state::<AppState>();
    if state.capture_active.load(Ordering::SeqCst) {
        return;
    }
    if state.last_activity.lock().unwrap().elapsed() < idle_release_after() {
        return;
    }
    let main_visible = app
        .get_webview_window("main")
        .and_then(|w| w.is_visible().ok())
        .unwrap_or(false);
    if main_visible {
        return;
    }
    let had_windows = overlay::any_exist(app) || app.get_webview_window("main").is_some();
    if !had_windows {
        return;
    }
    overlay::close_overlays(app);
    if let Some(win) = app.get_webview_window("main") {
        // destroy, not close: the close handler deliberately keeps this
        // window alive by hiding it instead.
        let _ = win.destroy();
    }
    crate::dlog("idle: released webviews");
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
    {
        let state = app.state::<AppState>();
        if state.capture_active.load(Ordering::SeqCst) {
            // An overlay that has reported ready is a capture the user is
            // actively working in — leave it alone. Otherwise it is only
            // trustworthy for as long as a rebuild plausibly takes; past that
            // the press is a retry of something that never appeared, and
            // refusing it is what leaves the shortcut looking dead.
            let shown = state.capture_shown.load(Ordering::SeqCst);
            let starting = state
                .capture_started
                .lock()
                .unwrap()
                .map(|t| t.elapsed() < STARTUP_GRACE)
                .unwrap_or(false);
            if shown || starting {
                crate::dlog(&format!(
                    "capture already in progress (shown={shown}), ignoring"
                ));
                return;
            }
            crate::dlog("previous capture never appeared, restarting");
            end_capture(&app);
        }
        state.capture_shown.store(false, Ordering::SeqCst);
        state.capture_active.store(true, Ordering::SeqCst);
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
    state.capture_shown.store(false, Ordering::SeqCst);
    state.capture_active.store(false, Ordering::SeqCst);
}

fn start_capture(app: &AppHandle, mode: CaptureMode) -> Result<(), String> {
    let started = std::time::Instant::now();
    touch_activity(app);
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
        // Not remembered: "Capture Previous Region" promises the last
        // rectangle the user drew. Letting a full-screen or active-window shot
        // overwrite it turned the shortcut into a duplicate of the one just
        // pressed, and lost the only thing it uniquely offers.
        let path = write_region(app, &shots[r.monitor], r, false)?;
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
    // Same reasoning as the watchdog: building the overlay windows is
    // event-loop work, so it is posted rather than requested from this thread.
    // Normally there is nothing to build and the closure only sends the start
    // event; after an idle release or a monitor change it builds first.
    let setup = app.clone();
    let for_setup = infos.clone();
    app.run_on_main_thread(move || {
        if let Err(e) = overlay::ensure_overlays(&setup, &for_setup) {
            crate::dlog(&format!("overlay setup failed: {e}"));
            end_capture(&setup);
            notify_error(&setup, "Capture failed", &e);
            return;
        }
        dispatch_overlays(&setup, &for_setup);
    })
    .map_err(|e| format!("cannot reach the event loop: {e}"))?;
    crate::dlog(&format!(
        "capture ready: grab {grabbed}ms, dispatch {}ms",
        started.elapsed().as_millis()
    ));
    watch_for_overlay(app);
    Ok(())
}

fn dispatch_overlays(app: &AppHandle, infos: &[capture::MonitorInfo]) {
    for info in infos {
        let _ = app.emit_to(overlay::label_for(info.index), "capture-start", info.index);
    }
}

/// A reused overlay whose WebView has been suspended by the system will never
/// answer capture-start, and the capture would just appear to do nothing.
/// Rebuild the windows once if nothing has come up shortly after dispatch.
fn watch_for_overlay(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(1200));
        let state = app.state::<AppState>();
        if !state.capture_active.load(Ordering::SeqCst)
            || state.capture_shown.load(Ordering::SeqCst)
        {
            return;
        }
        let infos: Vec<capture::MonitorInfo> = match state.session.lock().unwrap().as_ref() {
            Some(s) => s.monitors.iter().map(|m| m.info()).collect(),
            None => return,
        };
        crate::dlog("overlay did not respond, rebuilding");
        // Handed to the event loop rather than done here. Creating and
        // destroying windows is event-loop work, and asking for it from
        // another thread blocks that thread until the loop answers — so a
        // wedged loop took the watchdog down with it, and the app stopped
        // responding to anything at all. Posting the work cannot block: if the
        // loop is stuck the recovery simply does not happen, and the next
        // keypress tries again.
        let rebuild = app.clone();
        if let Err(e) = app.run_on_main_thread(move || {
            overlay::close_overlays(&rebuild);
            crate::dlog("rebuild: old overlays let go");
            match overlay::ensure_overlays(&rebuild, &infos) {
                Ok(()) => {
                    crate::dlog("rebuild: new overlays built");
                    dispatch_overlays(&rebuild, &infos);
                }
                Err(e) => {
                    crate::dlog(&format!("overlay rebuild failed: {e}"));
                    end_capture(&rebuild);
                }
            }
        }) {
            crate::dlog(&format!("could not reach the event loop to rebuild: {e}"));
            end_capture(&app);
        }
    });
}

/// Crop a region out of a frozen frame and write it to the screenshots folder.
fn write_region(
    app: &AppHandle,
    shot: &capture::MonitorShot,
    r: Region,
    remember: bool,
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
    if capture::is_uniform(&img) {
        // Not refused: selecting an empty area is a perfectly ordinary thing to
        // do. But "the capture came out blank" is otherwise unfalsifiable after
        // the fact, so it is on the record.
        let p = img.get_pixel(0, 0).0;
        crate::dlog(&format!(
            "captured region is a single colour rgba({},{},{},{}) at {}x{} from monitor {}",
            p[0], p[1], p[2], p[3], img.width(), img.height(), r.monitor
        ));
    }
    capture::encode_and_write(&img, &path, &snapshot.output.format, snapshot.output.quality)?;
    crate::history::record(app, &path);
    let state = app.state::<AppState>();
    *state.last_saved.lock().unwrap() = Some(path.clone());
    if remember && snapshot.capture.remember_previous_region {
        *state.prev_region.lock().unwrap() = Some(r);
    }
    Ok(path)
}

/// Bring the app forward showing the editor for `path`. An editor that is
/// already on screen just swaps to the new capture — resizing and recentring
/// a window the user is working in would be disruptive.
fn open_editor(app: &AppHandle, path: &Path) -> Result<(), String> {
    touch_activity(app);
    // Recorded so a main window that is still starting up can pick the
    // capture up itself rather than racing the event below.
    *app.state::<AppState>().pending_editor.lock().unwrap() =
        Some(path.to_string_lossy().to_string());

    let existing = app.get_webview_window("main");
    let already_open = existing
        .as_ref()
        .and_then(|w| w.is_visible().ok())
        .unwrap_or(false);

    if already_open {
        let win = existing.expect("visible window exists");
        let _ = win.set_focus();
        if let Ok(hwnd) = win.hwnd() {
            winutil::force_foreground(hwnd.0 as isize);
        }
        let _ = app.emit_to("main", "open-editor", path.to_string_lossy().to_string());
        return Ok(());
    }

    // Created but deliberately not shown yet. After the idle sweep this is a
    // brand-new WebView with nothing to paint, and showing it here is what put
    // an empty rectangle of background colour on screen. It goes up when the
    // editor reports that it has the capture rendered.
    let win = tray::ensure_main(app).ok_or("main window unavailable")?;

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
    let _ = app.emit_to("main", "open-editor", path.to_string_lossy().to_string());

    // A frontend that never reports ready must not leave the capture with no
    // window at all, so the wait has a floor.
    let fallback = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(2500));
        if let Some(w) = fallback.get_webview_window("main") {
            if !w.is_visible().unwrap_or(false) {
                crate::dlog("editor never reported ready, showing anyway");
                present_main(&fallback);
            }
        }
    });
    Ok(())
}

/// The capture the main window should open with, consumed as it mounts.
#[tauri::command]
pub fn take_pending_editor(app: AppHandle) -> Option<String> {
    app.state::<AppState>().pending_editor.lock().unwrap().take()
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

/// The shortcuts Clipath ships with.
///
/// Exposed rather than duplicated in the UI: the Settings page kept its own
/// copy of the list, so "Reset to defaults" handed back the bindings a release
/// had already moved away from — the user got Ctrl+Shift+A again long after it
/// stopped being the default.
#[tauri::command]
pub fn default_shortcuts() -> settings::Shortcuts {
    settings::Shortcuts::default()
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
    crate::dlog(&format!("overlay {monitor} asked for its info"));
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
    crate::dlog(&format!("overlay {monitor} asked for its frame"));
    let state = app.state::<AppState>();
    let session = state.session.lock().unwrap();
    let session = session.as_ref().ok_or("no capture session")?;
    let shot = session
        .monitors
        .get(monitor)
        .ok_or("monitor not in session")?;
    Ok(tauri::ipc::Response::new(shot.image.as_raw().clone()))
}

/// Put the main window on screen and in front. Separated so both the ready
/// signal and the fallback raise it exactly the same way.
pub fn present_main(app: &AppHandle) {
    let Some(win) = app.get_webview_window("main") else { return };
    let _ = win.show();
    let _ = win.unminimize();
    let _ = win.set_focus();
    if let Ok(hwnd) = win.hwnd() {
        winutil::force_foreground(hwnd.0 as isize);
    }
}

/// The editor has the capture on screen. Until this arrives the window stays
/// hidden rather than showing an unpainted WebView.
#[tauri::command]
pub fn editor_ready(app: AppHandle) {
    present_main(&app);
}

/// The overlay page talking about itself — that it loaded, or that something
/// went wrong on it. Purely a log entry: without it, a capture that never
/// appears cannot be told apart from a page that was never loaded at all, and
/// that distinction is the difference between a five-minute fix and a day of
/// guessing. Deliberately does not touch the capture: a stray script error is
/// not a reason to cancel a selection the user is in the middle of.
#[tauri::command]
pub fn overlay_note(monitor: usize, note: String) {
    crate::dlog(&format!("overlay {monitor}: {note}"));
}

/// An overlay could not prepare itself. Without this the capture stays flagged
/// active with nothing on screen, and the next keypress has to wait out the
/// grace period before anything happens.
#[tauri::command]
pub fn overlay_failed(app: AppHandle, monitor: usize, reason: String) {
    crate::dlog(&format!("overlay {monitor} failed: {reason}"));
    end_capture(&app);
    notify_error(&app, "Capture failed", &reason);
}

#[tauri::command]
pub fn overlay_ready(app: AppHandle, monitor: usize) -> Result<(), String> {
    let win = app
        .get_webview_window(&overlay::label_for(monitor))
        .ok_or("overlay window missing")?;
    {
        // Give the window its monitor's geometry before showing it.
        let state = app.state::<AppState>();
        let session = state.session.lock().unwrap();
        let session = session.as_ref().ok_or("no capture session")?;
        let shot = session
            .monitors
            .get(monitor)
            .ok_or("monitor not in session")?;
        overlay::expand(&win, &shot.info())?;
    }
    win.show().map_err(|e| e.to_string())?;
    let _ = win.set_always_on_top(true);

    app.state::<AppState>()
        .capture_shown
        .store(true, Ordering::SeqCst);
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
    let written = {
        let state = app.state::<AppState>();
        let guard = state.session.lock().unwrap();
        guard
            .as_ref()
            .ok_or_else(|| "no capture session".to_string())
            .and_then(|session| {
                let shot = session
                    .monitors
                    .get(monitor)
                    .ok_or_else(|| "monitor not in session".to_string())?;
                write_region(&app, shot, region, true)
            })
    };
    // Release the capture either way; a failed save must not wedge the
    // shortcut behind a busy flag that never clears.
    end_capture(&app);
    let path = match written {
        Ok(p) => p,
        Err(e) => {
            crate::dlog(&format!("commit_region failed: {e}"));
            winutil::restore_foreground(*app.state::<AppState>().prev_focus.lock().unwrap());
            notify_error(&app, "Couldn't save screenshot", &e);
            return Err(e);
        }
    };
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

    // An empty payload means the editor changed nothing, so the file on disk is
    // already the answer. Re-encoding it would only cost quality and risk a
    // rounding difference in size — copying a path must not alter the capture.
    let img = if image_base64.trim().is_empty() {
        image::open(&target)
            .map_err(|e| format!("cannot read the screenshot: {e}"))?
            .to_rgba8()
    } else {
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
        img
    };
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
    touch_activity(&app);
    hide_main(&app);
    let prev = *app.state::<AppState>().prev_focus.lock().unwrap();
    winutil::restore_foreground(prev);
}

/// Hide the main window and tell it to let go of the open capture. The window
/// stays alive so it reopens instantly, but a decoded screenshot is several
/// megabytes to keep around for a window nobody is looking at.
pub fn hide_main(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.hide();
    }
    *app.state::<AppState>().pending_editor.lock().unwrap() = None;
    let _ = app.emit_to("main", "editor-closed", ());
}

/// Tell the user once that closing the window did not quit Clipath. Hiding to
/// the tray takes the taskbar entry away too, and the tray icon starts life in
/// the Windows overflow, so without this the app looks like it exited.
pub fn hint_still_running(app: &AppHandle) {
    let (already, shortcut) = {
        let state = app.state::<AppState>();
        let s = state.settings.lock().unwrap();
        (
            s.general.tray_hint_shown,
            s.shortcuts.region.clone().unwrap_or_default(),
        )
    };
    if already {
        return;
    }
    let body = if shortcut.is_empty() {
        "Clipath is still running in the system tray.".to_string()
    } else {
        format!("Clipath is still running in the system tray — press {shortcut} to capture.")
    };
    // Deliberately not gated on the notification setting: this is a one-off
    // explanation of where the app went, not a per-capture notice.
    let _ = app.notification().builder().title("Clipath").body(body).show();
    let state = app.state::<AppState>();
    let mut s = state.settings.lock().unwrap();
    s.general.tray_hint_shown = true;
    let _ = settings::save(app, &s);
}

/// The one sanctioned way out. Everything else that could end the event loop
/// is refused so the tray icon survives.
#[tauri::command]
pub fn quit(app: AppHandle) {
    app.state::<AppState>()
        .quitting
        .store(true, Ordering::SeqCst);
    app.exit(0);
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
    crate::history::forget(&app, Path::new(&path));
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
pub fn hide_main_window(app: AppHandle) {
    hide_main(&app);
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Two monitors side by side, the second one to the right of the first.
    fn two_monitors() -> Vec<capture::MonitorShot> {
        vec![
            capture::MonitorShot {
                index: 0,
                x: 0,
                y: 0,
                width: 2560,
                height: 1440,
                scale: 1.0,
                is_primary: true,
                image: image::RgbaImage::new(1, 1),
            },
            capture::MonitorShot {
                index: 1,
                x: 2560,
                y: 0,
                width: 1920,
                height: 1080,
                scale: 1.0,
                is_primary: false,
                image: image::RgbaImage::new(1, 1),
            },
        ]
    }

    #[test]
    fn a_point_resolves_to_the_monitor_containing_it() {
        let m = two_monitors();
        assert_eq!(monitor_at(&m, 10, 10), 0);
        assert_eq!(monitor_at(&m, 3000, 500), 1);
    }

    #[test]
    fn monitor_edges_belong_to_exactly_one_screen() {
        // 2560 is the first pixel of the second monitor, not the last of the
        // first: an off-by-one here sends the capture to the wrong overlay.
        let m = two_monitors();
        assert_eq!(monitor_at(&m, 2559, 0), 0);
        assert_eq!(monitor_at(&m, 2560, 0), 1);
    }

    #[test]
    fn a_point_off_every_monitor_falls_back_to_the_primary() {
        let m = two_monitors();
        assert_eq!(monitor_at(&m, -500, -500), 0);
        assert_eq!(monitor_at(&m, 99_999, 99_999), 0);
    }

    #[test]
    fn a_negative_layout_still_resolves() {
        // A monitor placed to the left of the primary has negative origins.
        let m = vec![
            capture::MonitorShot {
                index: 0,
                x: -1920,
                y: 0,
                width: 1920,
                height: 1080,
                scale: 1.0,
                is_primary: false,
                image: image::RgbaImage::new(1, 1),
            },
            capture::MonitorShot {
                index: 1,
                x: 0,
                y: 0,
                width: 2560,
                height: 1440,
                scale: 1.0,
                is_primary: true,
                image: image::RgbaImage::new(1, 1),
            },
        ];
        assert_eq!(monitor_at(&m, -100, 100), 0);
        assert_eq!(monitor_at(&m, 100, 100), 1);
    }

    #[test]
    fn overlay_labels_round_trip_through_the_window_label() {
        // The frontend recovers the monitor index by stripping the prefix; when
        // that parsing drifted, every overlay reported monitor 0 and captures
        // only worked on one screen.
        for index in [0usize, 1, 7] {
            let label = overlay::label_for(index);
            assert!(label.starts_with("overlay-"));
            let parsed: usize = overlay::monitor_of(&label).unwrap();
            assert_eq!(parsed, index);
        }
    }
}
