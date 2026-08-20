mod capture;
mod clipboard;
mod commands;
mod filename;
mod history;
mod overlay;
mod settings;
mod shortcuts;
mod tray;
mod winutil;

use capture::{CaptureSession, Region};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::Manager;
use tauri_plugin_global_shortcut::{Shortcut, ShortcutState};

/// Browser arguments for every WebView2 this app creates.
///
/// `CalculateNativeWinOcclusion` is Chromium watching whether a window is
/// covered so it can stop rendering it. A display that sleeps or a session
/// that locks marks every window occluded, and the "visible again" transition
/// is sometimes missed — the page keeps running and answering input while the
/// compositor never presents another frame. That is exactly a selection that
/// commits and saves but is never seen being drawn, so the tracker is turned
/// off. The `ms*` entries are wry's own defaults, which passing this argument
/// would otherwise silently drop.
///
/// Every window must pass the same string (the config carries a copy for the
/// startup-built main window): WebView2 processes sharing a data directory
/// share one browser process, and only the arguments of whichever webview
/// starts it are honoured.
pub const BROWSER_ARGS: &str =
    "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection,CalculateNativeWinOcclusion";

/// Debug logging to %TEMP%\clipath-debug.log (stderr redirection is
/// unreliable for GUI processes launched detached).
pub fn dlog(msg: &str) {
    eprintln!("[clipath] {msg}");
    let path = std::env::temp_dir().join("clipath-debug.log");
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(path) {
        use std::io::Write;
        let _ = writeln!(f, "{} {msg}", chrono::Local::now().format("%H:%M:%S%.3f"));
    }
}

pub struct AppState {
    pub settings: Mutex<settings::Settings>,
    pub session: Mutex<Option<CaptureSession>>,
    pub last_saved: Mutex<Option<PathBuf>>,
    pub prev_region: Mutex<Option<Region>>,
    pub shortcut_map: Mutex<Vec<(Shortcut, String)>>,
    pub capture_active: std::sync::atomic::AtomicBool,
    pub overlay_layout: Mutex<Vec<(i32, i32, u32, u32)>>,
    /// Window that had focus when the capture started, so the editor can hand
    /// it back and the copied path can be pasted immediately.
    pub prev_focus: Mutex<isize>,
    pub capture_started: Mutex<Option<std::time::Instant>>,
    /// Whether an overlay has reported itself ready for the *current* capture.
    /// Window visibility is not a substitute: an overlay left on screen by an
    /// earlier capture makes a wedged one look healthy.
    pub capture_shown: std::sync::atomic::AtomicBool,
    /// Last time the user captured or used the editor, for the idle sweep.
    pub last_activity: Mutex<std::time::Instant>,
    /// Capture waiting to be shown, read by the main window as it mounts.
    pub pending_editor: Mutex<Option<String>>,
    /// Set only by Quit. Every other route out of the event loop — the last
    /// window closing, the idle sweep tearing the WebViews down, a plugin
    /// asking to exit — is refused, so Clipath survives in the tray.
    pub quitting: std::sync::atomic::AtomicBool,
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            tray::show_main(app, "general");
        }))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        crate::dlog(&format!("hotkey pressed: {shortcut:?}"));
                        if let Some(action) = shortcuts::action_for_shortcut(app, shortcut) {
                            commands::run_action(app.clone(), &action);
                        }
                    }
                })
                .build(),
        )
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            // Boot-time launches must not put a window in the user's face;
            // the flag is how startup below tells them apart from a launch
            // the user asked for.
            Some(vec!["--hidden"]),
        ))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let handle = app.handle().clone();
            let loaded = settings::load(&handle);
            app.manage(AppState {
                settings: Mutex::new(loaded.clone()),
                session: Mutex::new(None),
                last_saved: Mutex::new(None),
                prev_region: Mutex::new(None),
                shortcut_map: Mutex::new(Vec::new()),
                capture_active: std::sync::atomic::AtomicBool::new(false),
                overlay_layout: Mutex::new(Vec::new()),
                prev_focus: Mutex::new(0),
                capture_started: Mutex::new(None),
                capture_shown: std::sync::atomic::AtomicBool::new(false),
                last_activity: Mutex::new(std::time::Instant::now()),
                pending_editor: Mutex::new(None),
                quitting: std::sync::atomic::AtomicBool::new(false),
            });
            tray::create_tray(&handle, &loaded)?;
            let errors = shortcuts::register_all(&handle, &loaded);
            for e in errors {
                crate::dlog(&format!("shortcut error: {e}"));
            }
            crate::dlog("started, shortcuts registered");
            // Build the capture overlays while the app is idle so the first
            // shortcut press is as fast as every later one, then release them
            // again once the user has stopped capturing.
            {
                let h = handle.clone();
                std::thread::spawn(move || {
                    // Short: a capture taken moments after launching the app
                    // should find the overlays already warm, not still queued
                    // behind a courtesy delay.
                    std::thread::sleep(std::time::Duration::from_millis(250));
                    commands::prewarm(&h);
                    if std::env::var("CLIPATH_TEST_CAPTURE").is_ok() {
                        std::thread::sleep(std::time::Duration::from_millis(800));
                        crate::dlog("test trigger");
                        commands::run_action(h.clone(), "region");
                    }
                    loop {
                        std::thread::sleep(std::time::Duration::from_secs(30));
                        commands::release_if_idle(&h);
                    }
                });
            }
            // Launching the app by hand puts the window on screen — starting
            // into nothing but a tray icon reads as the app not launching at
            // all. Only the autostart entry, which passes --hidden, is meant
            // to begin silently in the background.
            let start_hidden = std::env::args().any(|a| a == "--hidden");
            if !loaded.onboarding_completed || !start_hidden {
                if let Some(win) = app.get_webview_window("main") {
                    let _ = win.show();
                    let _ = win.set_focus();
                }
            }
            // Refresh the autostart entry: one registered before --hidden
            // existed would keep popping the window on every boot.
            if loaded.general.launch_at_startup {
                use tauri_plugin_autostart::ManagerExt;
                let _ = handle.autolaunch().enable();
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            // The main window hides to the tray instead of closing, handing
            // focus back so a just-copied path can be pasted straight away.
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() != "main" {
                    return;
                }
                let app = window.app_handle();
                let keep = app
                    .try_state::<AppState>()
                    .map(|s| s.settings.lock().unwrap().general.minimize_to_tray)
                    .unwrap_or(true);
                if !keep {
                    commands::quit(app.clone());
                    return;
                }
                api.prevent_close();
                commands::hide_main(app);
                commands::hint_still_running(app);
                if let Some(state) = app.try_state::<AppState>() {
                    let prev = *state.prev_focus.lock().unwrap();
                    winutil::restore_foreground(prev);
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_settings,
            commands::default_shortcuts,
            commands::set_settings,
            commands::validate_folder,
            commands::get_default_folder,
            commands::check_shortcut_available,
            commands::suspend_shortcuts,
            commands::resume_shortcuts,
            commands::app_info,
            commands::trigger_capture,
            commands::get_overlay_info,
            commands::get_overlay_frame,
            commands::overlay_ready,
            commands::page_note,
            commands::overlay_failed,
            commands::editor_ready,
            commands::commit_region,
            commands::cancel_capture,
            commands::take_pending_editor,
            commands::read_image,
            commands::finalize_image,
            commands::save_image_as,
            commands::close_editor,
            commands::list_recent,
            commands::copy_path_text,
            commands::copy_text,
            commands::copy_image_file,
            commands::delete_file,
            commands::reveal_in_folder,
            commands::open_path,
            commands::hide_main_window,
            commands::quit,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Clipath")
        .run(|app, event| {
            // Keep running in the tray when every window is closed or hidden.
            // Only Quit is allowed through: the idle sweep destroys the last
            // WebView on purpose, and that must not take the process with it.
            if let tauri::RunEvent::ExitRequested { api, .. } = event {
                let quitting = app
                    .try_state::<AppState>()
                    .map(|s| s.quitting.load(std::sync::atomic::Ordering::SeqCst))
                    .unwrap_or(false);
                if !quitting {
                    api.prevent_exit();
                }
            }
        });
}


