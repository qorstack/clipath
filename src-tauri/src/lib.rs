mod capture;
mod clipboard;
mod commands;
mod filename;
mod overlay;
mod pin;
mod settings;
mod shortcuts;
mod tray;
mod winutil;

use capture::{CaptureSession, Region};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::Manager;
use tauri_plugin_global_shortcut::{Shortcut, ShortcutState};

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
    pub pins: Mutex<std::collections::HashMap<String, String>>,
    pub capture_active: std::sync::atomic::AtomicBool,
    pub overlay_layout: Mutex<Vec<(i32, i32, u32, u32)>>,
    /// Window that had focus when the capture started, so the editor can hand
    /// it back and the copied path can be pasted immediately.
    pub prev_focus: Mutex<isize>,
    pub capture_started: Mutex<Option<std::time::Instant>>,
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
            None,
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
                pins: Mutex::new(std::collections::HashMap::new()),
                capture_active: std::sync::atomic::AtomicBool::new(false),
                overlay_layout: Mutex::new(Vec::new()),
                prev_focus: Mutex::new(0),
                capture_started: Mutex::new(None),
            });
            tray::create_tray(&handle, &loaded)?;
            let errors = shortcuts::register_all(&handle, &loaded);
            for e in errors {
                crate::dlog(&format!("shortcut error: {e}"));
            }
            crate::dlog("started, shortcuts registered");
            // Build the capture overlays while the app is idle so the first
            // shortcut press is as fast as every later one.
            {
                let h = handle.clone();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_millis(1200));
                    commands::prewarm(&h);
                    if std::env::var("CLIPATH_TEST_CAPTURE").is_ok() {
                        std::thread::sleep(std::time::Duration::from_millis(800));
                        crate::dlog("test trigger");
                        commands::run_action(h.clone(), "region");
                    }
                });
            }
            if !loaded.onboarding_completed {
                if let Some(win) = app.get_webview_window("main") {
                    let _ = win.show();
                    let _ = win.set_focus();
                }
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            // The main window hides to the tray instead of closing.
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_settings,
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
            commands::commit_region,
            commands::cancel_capture,
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
            commands::pin_file,
            commands::get_pin_path,
            commands::hide_main_window,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Clipath")
        .run(|_app, event| {
            // Keep running in the tray when every window is closed or hidden.
            if let tauri::RunEvent::ExitRequested { api, code, .. } = event {
                if code.is_none() {
                    api.prevent_exit();
                }
            }
        });
}


