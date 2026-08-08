use crate::commands;
use crate::settings::Settings;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager};

/// Menu item with the configured shortcut shown alongside it. A shortcut
/// string the menu layer cannot parse is dropped rather than failing the
/// whole tray build.
/// Render W3C key codes the way a user reads them: "Comma" -> ",".
fn humanize(shortcut: &str) -> String {
    shortcut
        .split('+')
        .map(|part| match part {
            "Comma" => ",",
            "Period" => ".",
            "Slash" => "/",
            "Semicolon" => ";",
            "Quote" => "'",
            "BracketLeft" => "[",
            "BracketRight" => "]",
            "Backslash" => "\\",
            "Minus" => "-",
            "Equal" => "=",
            "Backquote" => "`",
            "Space" => "Space",
            other => other,
        })
        .collect::<Vec<_>>()
        .join("+")
}

fn item(
    app: &AppHandle,
    id: &str,
    label: &str,
    accel: Option<&String>,
) -> tauri::Result<MenuItem<tauri::Wry>> {
    let Some(a) = accel.filter(|a| !a.trim().is_empty()) else {
        return MenuItem::with_id(app, id, label, true, None::<&str>);
    };
    // Prefer a real accelerator (right-aligned natively); if the menu layer
    // can't parse the combination, show it inline so it is never hidden.
    if let Ok(m) = MenuItem::with_id(app, id, label, true, Some(a.as_str())) {
        return Ok(m);
    }
    MenuItem::with_id(
        app,
        id,
        format!("{label}   ({})", humanize(a)),
        true,
        None::<&str>,
    )
}

fn build_menu(app: &AppHandle, settings: &Settings) -> tauri::Result<Menu<tauri::Wry>> {
    let s = &settings.shortcuts;
    let capture_region = item(app, "capture-region", "Capture Region", s.region.as_ref())?;
    let capture_full = item(
        app,
        "capture-fullscreen",
        "Capture Full Screen",
        s.fullscreen.as_ref(),
    )?;
    let capture_window = item(
        app,
        "capture-active-window",
        "Capture Active Window",
        s.active_window.as_ref(),
    )?;
    let capture_prev = item(
        app,
        "capture-previous-region",
        "Capture Previous Region",
        s.previous_region.as_ref(),
    )?;
    let recent = item(app, "recent", "Recent Captures", None)?;
    let copy_last = item(
        app,
        "copy-last-path",
        "Copy Last Screenshot Path",
        s.copy_last_path.as_ref(),
    )?;
    let open_folder = item(
        app,
        "open-folder",
        "Open Screenshots Folder",
        s.open_folder.as_ref(),
    )?;
    let settings_item = item(app, "settings", "Settings", s.open_settings.as_ref())?;
    let about = item(app, "about", "About", None)?;
    let quit = item(app, "quit", "Quit Clipath", None)?;

    Menu::with_items(
        app,
        &[
            &capture_region,
            &capture_full,
            &capture_window,
            &capture_prev,
            &PredefinedMenuItem::separator(app)?,
            &recent,
            &copy_last,
            &open_folder,
            &PredefinedMenuItem::separator(app)?,
            &settings_item,
            &about,
            &PredefinedMenuItem::separator(app)?,
            &quit,
        ],
    )
}

pub fn create_tray(app: &AppHandle, settings: &Settings) -> tauri::Result<()> {
    let menu = build_menu(app, settings)?;
    let shortcut = settings
        .shortcuts
        .region
        .clone()
        .unwrap_or_else(|| "tray menu".into());

    TrayIconBuilder::with_id("clipath-tray")
        .icon(app.default_window_icon().unwrap().clone())
        .menu(&menu)
        .show_menu_on_left_click(false)
        .tooltip(format!("Clipath — {shortcut} to capture"))
        .on_menu_event(|app, event| match event.id.as_ref() {
            "capture-region" => commands::run_action(app.clone(), "region"),
            "capture-fullscreen" => commands::run_action(app.clone(), "fullscreen"),
            "capture-active-window" => commands::run_action(app.clone(), "active-window"),
            "capture-previous-region" => commands::run_action(app.clone(), "previous-region"),
            "recent" => show_main(app, "recent"),
            "copy-last-path" => commands::run_action(app.clone(), "copy-last-path"),
            "open-folder" => commands::run_action(app.clone(), "open-folder"),
            "settings" => show_main(app, "general"),
            "about" => show_main(app, "about"),
            "quit" => commands::quit(app.clone()),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| match event {
            TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } => {
                commands::run_action(tray.app_handle().clone(), "region");
            }
            TrayIconEvent::DoubleClick {
                button: MouseButton::Left,
                ..
            } => {
                // The first click of the pair already started a capture —
                // cancel it and open Settings instead.
                let app = tray.app_handle();
                commands::cancel_capture(app.clone());
                show_main(app, "general");
            }
            _ => {}
        })
        .build(app)?;
    Ok(())
}

/// Rebuild the tray menu so its shortcut labels match the current settings.
pub fn refresh(app: &AppHandle, settings: &Settings) {
    let Some(tray) = app.tray_by_id("clipath-tray") else {
        return;
    };
    match build_menu(app, settings) {
        Ok(menu) => {
            let _ = tray.set_menu(Some(menu));
        }
        Err(e) => crate::dlog(&format!("tray: cannot rebuild menu: {e}")),
    }
    let shortcut = settings
        .shortcuts
        .region
        .clone()
        .unwrap_or_else(|| "tray menu".into());
    let _ = tray.set_tooltip(Some(format!("Clipath — {shortcut} to capture")));
}

pub fn show_main(app: &AppHandle, page: &str) {
    let win = match app.get_webview_window("main") {
        Some(w) => w,
        None => {
            // Recreate the settings window if it was ever destroyed.
            let built = tauri::WebviewWindowBuilder::new(
                app,
                "main",
                tauri::WebviewUrl::App("index.html".into()),
            )
            .title("Clipath")
            .inner_size(780.0, 580.0)
            .min_inner_size(700.0, 520.0)
            .center()
            .build();
            match built {
                Ok(w) => w,
                Err(e) => {
                    crate::dlog(&format!("cannot recreate main window: {e}"));
                    return;
                }
            }
        }
    };
    let _ = win.show();
    let _ = win.unminimize();
    let _ = win.set_focus();
    // set_focus alone loses to focus-stealing prevention when the request came
    // from a global shortcut or the tray, which would leave the window sitting
    // behind the app the user is looking at.
    if let Ok(hwnd) = win.hwnd() {
        crate::winutil::force_foreground(hwnd.0 as isize);
    }
    use tauri::Emitter;
    let _ = app.emit_to("main", "navigate", page.to_string());
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn code_names_are_shown_as_the_key_the_user_presses() {
        assert_eq!(humanize("Ctrl+Shift+Comma"), "Ctrl+Shift+,");
        assert_eq!(humanize("Ctrl+Period"), "Ctrl+.");
        assert_eq!(humanize("Ctrl+Slash"), "Ctrl+/");
        assert_eq!(humanize("Ctrl+BracketLeft"), "Ctrl+[");
        assert_eq!(humanize("Alt+Backquote"), "Alt+`");
    }

    #[test]
    fn ordinary_keys_are_left_alone() {
        assert_eq!(humanize("Ctrl+Shift+A"), "Ctrl+Shift+A");
        assert_eq!(humanize("Ctrl+F5"), "Ctrl+F5");
        assert_eq!(humanize("Ctrl+Space"), "Ctrl+Space");
    }
}
