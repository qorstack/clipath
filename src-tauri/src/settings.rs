use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::Manager;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub schema_version: u32,
    pub onboarding_completed: bool,
    pub general: General,
    pub capture: Capture,
    pub annotations: Annotations,
    pub output: Output,
    pub shortcuts: Shortcuts,
    pub appearance: Appearance,
    pub recent: Recent,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct General {
    pub launch_at_startup: bool,
    pub minimize_to_tray: bool,
    pub notifications: bool,
    pub capture_sound: bool,
    /// Whether the user has been told that closing the window leaves Clipath
    /// running. Shown once, because a tray-only app that vanishes from the
    /// taskbar otherwise looks like it quit.
    pub tray_hint_shown: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Capture {
    pub default_mode: String,
    pub freeze_screen: bool,
    pub show_dimensions: bool,
    pub show_magnifier: bool,
    pub crosshair_guides: bool,
    pub remember_previous_region: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Annotations {
    pub default_tool: String,
    pub default_color: String,
    pub stroke_width: f64,
    pub pen_smoothing: bool,
    pub highlighter_opacity: f64,
    pub font_size: f64,
    pub blur_strength: f64,
    pub pixel_size: f64,
    pub counter_size: f64,
    pub counter_start: u32,
    pub remember_last_tool: bool,
    pub remember_last_color: bool,
    pub show_tooltips: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Output {
    pub folder: String,
    pub filename_pattern: String,
    pub format: String,
    pub quality: u8,
    pub default_final_action: String,
    pub path_format: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Shortcuts {
    pub region: Option<String>,
    pub fullscreen: Option<String>,
    pub active_window: Option<String>,
    pub previous_region: Option<String>,
    pub copy_last_path: Option<String>,
    pub open_folder: Option<String>,
    pub open_settings: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Appearance {
    pub theme: String,
    pub accent: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Recent {
    pub keep_list: bool,
    pub limit: u32,
}

pub const SCHEMA_VERSION: u32 = 4;

impl Default for Settings {
    fn default() -> Self {
        Self {
            schema_version: SCHEMA_VERSION,
            onboarding_completed: false,
            general: General::default(),
            capture: Capture::default(),
            annotations: Annotations::default(),
            output: Output::default(),
            shortcuts: Shortcuts::default(),
            appearance: Appearance::default(),
            recent: Recent::default(),
        }
    }
}

impl Default for General {
    fn default() -> Self {
        Self {
            launch_at_startup: true,
            minimize_to_tray: true,
            notifications: true,
            capture_sound: false,
            tray_hint_shown: false,
        }
    }
}

impl Default for Capture {
    fn default() -> Self {
        Self {
            default_mode: "region".into(),
            freeze_screen: true,
            show_dimensions: true,
            show_magnifier: true,
            crosshair_guides: false,
            remember_previous_region: true,
        }
    }
}

impl Default for Annotations {
    fn default() -> Self {
        Self {
            default_tool: "arrow".into(),
            default_color: "#FF3B30".into(),
            stroke_width: 3.0,
            pen_smoothing: true,
            highlighter_opacity: 0.35,
            font_size: 18.0,
            blur_strength: 16.0,
            pixel_size: 12.0,
            counter_size: 28.0,
            counter_start: 1,
            remember_last_tool: true,
            remember_last_color: true,
            show_tooltips: true,
        }
    }
}

impl Default for Output {
    fn default() -> Self {
        Self {
            folder: String::new(),
            filename_pattern: "clipath_{yyyy}-{MM}-{dd}_{HH}-{mm}-{ss}_{fff}".into(),
            format: "png".into(),
            quality: 92,
            default_final_action: "copy-path".into(),
            path_format: "{path}".into(),
        }
    }
}

/// The bindings v3 and earlier shipped with. A global shortcut wins over the
/// focused application, so every one of these quietly took a key that editors
/// and browsers use for themselves: hard reload, find in files, the command
/// palette. They are recognised on upgrade so they can be moved off.
pub(crate) const LEGACY_SHORTCUTS: &[(&str, &str)] = &[
    ("region", "Ctrl+Shift+A"),
    ("fullscreen", "Ctrl+Shift+F"),
    ("activeWindow", "Ctrl+Shift+E"),
    ("previousRegion", "Ctrl+Shift+R"),
    ("copyLastPath", "Ctrl+Shift+P"),
    ("openFolder", "Ctrl+Shift+O"),
    ("openSettings", "Ctrl+Shift+Comma"),
];

impl Default for Shortcuts {
    fn default() -> Self {
        Self {
            // Print Screen and its modifiers: no application binds them for
            // anything of its own, so claiming them globally takes nothing
            // away — unlike Ctrl+Shift+letter, where every combination is
            // already something in an editor or a browser. One key is also
            // the easiest thing there is to press.
            region: Some("PrintScreen".into()),
            fullscreen: Some("Ctrl+PrintScreen".into()),
            // Windows already means "the active window" by this one.
            active_window: Some("Alt+PrintScreen".into()),
            previous_region: Some("Ctrl+Shift+PrintScreen".into()),
            // The three that are not captures have no Print Screen left, so
            // they take Ctrl+Alt, which applications leave alone far more
            // often than Ctrl+Shift.
            copy_last_path: Some("Ctrl+Alt+C".into()),
            open_folder: Some("Ctrl+Alt+F".into()),
            open_settings: Some("Ctrl+Alt+Comma".into()),
        }
    }
}

impl Default for Appearance {
    fn default() -> Self {
        Self {
            theme: "system".into(),
            accent: "#5E5CE6".into(),
        }
    }
}

impl Default for Recent {
    fn default() -> Self {
        Self {
            keep_list: true,
            limit: 50,
        }
    }
}

fn settings_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("cannot resolve config dir: {e}"))?;
    Ok(dir.join("settings.json"))
}

/// Pick a default screenshots folder that is actually writable. OneDrive
/// known-folder redirection can make Pictures unwritable through Win32, so
/// each candidate is verified with a real write test.
pub fn default_screenshot_folder(app: &tauri::AppHandle) -> String {
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Ok(p) = app.path().picture_dir() {
        candidates.push(p.join("Clipath"));
    }
    if let Ok(h) = app.path().home_dir() {
        candidates.push(h.join("Pictures").join("Clipath"));
        candidates.push(h.join("Clipath"));
    }
    for c in &candidates {
        if fs::create_dir_all(c).is_ok() {
            let test = c.join(".clipath-write-test");
            if fs::write(&test, b"ok").is_ok() {
                let _ = fs::remove_file(&test);
                return c.to_string_lossy().to_string();
            }
        }
    }
    candidates
        .last()
        .map(|c| c.to_string_lossy().to_string())
        .unwrap_or_else(|| "C:\\Clipath".into())
}

pub fn load(app: &tauri::AppHandle) -> Settings {
    let mut settings: Settings = settings_path(app)
        .ok()
        .and_then(|p| fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(s.trim_start_matches('\u{feff}')).ok())
        .unwrap_or_default();
    if settings.output.folder.is_empty() {
        settings.output.folder = default_screenshot_folder(app);
    }
    let previous_version = settings.schema_version;
    migrate(&mut settings);
    if previous_version != SCHEMA_VERSION {
        // Write the upgraded file back so Settings shows the new defaults.
        let _ = save(app, &settings);
    }
    settings
}

/// Bring older settings files forward. v1 shipped with only the region
/// shortcut bound; v2 gives every action a default binding.
pub(crate) fn migrate(settings: &mut Settings) {
    if settings.schema_version < 2 {
        let d = Shortcuts::default();
        let s = &mut settings.shortcuts;
        s.fullscreen = s.fullscreen.take().or(d.fullscreen);
        s.active_window = s.active_window.take().or(d.active_window);
        s.previous_region = s.previous_region.take().or(d.previous_region);
        s.copy_last_path = s.copy_last_path.take().or(d.copy_last_path);
        s.open_folder = s.open_folder.take().or(d.open_folder);
        s.open_settings = s.open_settings.take().or(d.open_settings);
        s.region = s.region.take().or(d.region);
    }
    if settings.schema_version < 3 {
        // The editor took Ctrl+Shift+C for Copy Image, so the global
        // Copy Last Path binding has to move off it.
        if settings.shortcuts.copy_last_path.as_deref() == Some("Ctrl+Shift+C") {
            settings.shortcuts.copy_last_path = Some("Ctrl+Shift+P".into());
        }
    }
    if settings.schema_version < 4 {
        // Move off the Ctrl+Shift+letter defaults, which were swallowing keys
        // the focused application needed. Only bindings still sitting on an old
        // default are touched: anything the user chose themselves is theirs.
        let d = Shortcuts::default();
        let s = &mut settings.shortcuts;
        let legacy = |slot: &mut Option<String>, action: &str, new: Option<String>| {
            let was_default = LEGACY_SHORTCUTS
                .iter()
                .any(|(a, old)| *a == action && slot.as_deref() == Some(*old));
            if was_default {
                *slot = new;
            }
        };
        legacy(&mut s.region, "region", d.region);
        legacy(&mut s.fullscreen, "fullscreen", d.fullscreen);
        legacy(&mut s.active_window, "activeWindow", d.active_window);
        legacy(&mut s.previous_region, "previousRegion", d.previous_region);
        legacy(&mut s.copy_last_path, "copyLastPath", d.copy_last_path);
        legacy(&mut s.open_folder, "openFolder", d.open_folder);
        legacy(&mut s.open_settings, "openSettings", d.open_settings);
    }
    // Pin to screen was removed; fall back to the default action.
    if settings.output.default_final_action == "pin" {
        settings.output.default_final_action = "copy-path".into();
    }
    settings.schema_version = SCHEMA_VERSION;
}

pub fn save(app: &tauri::AppHandle, settings: &Settings) -> Result<(), String> {
    let path = settings_path(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("cannot create config dir: {e}"))?;
    }
    let json = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, json).map_err(|e| format!("cannot write settings: {e}"))?;
    fs::rename(&tmp, &path).map_err(|e| format!("cannot write settings: {e}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn migrated(json: &str) -> Settings {
        let mut s: Settings = serde_json::from_str(json).expect("settings should parse");
        migrate(&mut s);
        s
    }

    #[test]
    fn an_empty_object_yields_the_full_defaults() {
        // Every field is `default`, so a truncated or hand-edited file still
        // produces a usable configuration rather than failing to load.
        let s = migrated("{}");
        assert_eq!(s.schema_version, SCHEMA_VERSION);
        assert_eq!(s.output.format, "png");
        assert_eq!(s.annotations.stroke_width, 3.0);
        assert!(s.general.minimize_to_tray);
    }

    #[test]
    fn unknown_fields_do_not_break_loading() {
        // A file written by a newer build must not brick an older one.
        let s = migrated(r#"{"somethingFromTheFuture": 1, "output": {"quality": 50}}"#);
        assert_eq!(s.output.quality, 50);
    }

    #[test]
    fn v1_gains_a_binding_for_every_action() {
        // v1 shipped with only the region shortcut bound, leaving the rest
        // reachable from the tray alone.
        let s = migrated(r#"{"schemaVersion": 1, "shortcuts": {"region": "Ctrl+Shift+A"}}"#);
        // Carried all the way to v4, so region has also moved off the binding
        // that was taking the key from the focused application.
        assert_eq!(s.shortcuts.region.as_deref(), Some("PrintScreen"));
        assert!(s.shortcuts.fullscreen.is_some());
        assert!(s.shortcuts.active_window.is_some());
        assert!(s.shortcuts.previous_region.is_some());
        assert!(s.shortcuts.copy_last_path.is_some());
        assert!(s.shortcuts.open_folder.is_some());
        assert!(s.shortcuts.open_settings.is_some());
    }

    #[test]
    fn migration_never_overwrites_a_binding_the_user_chose() {
        let s = migrated(r#"{"schemaVersion": 1, "shortcuts": {"fullscreen": "Alt+F9"}}"#);
        assert_eq!(s.shortcuts.fullscreen.as_deref(), Some("Alt+F9"));
    }

    #[test]
    fn v2_moves_copy_last_path_off_the_editors_copy_image_key() {
        let s = migrated(r#"{"schemaVersion": 2, "shortcuts": {"copyLastPath": "Ctrl+Shift+C"}}"#);
        // v2 moved it to Ctrl+Shift+P; v4 then moved it off that too. What has
        // to hold either way is that it is not on the editor's Copy Image key.
        assert_ne!(s.shortcuts.copy_last_path.as_deref(), Some("Ctrl+Shift+C"));
        assert_eq!(
            s.shortcuts.copy_last_path,
            Shortcuts::default().copy_last_path
        );
    }

    #[test]
    fn v3_moves_off_the_shortcuts_that_stole_keys_from_the_focused_app() {
        // Ctrl+Shift+R is hard reload, Ctrl+Shift+P is the command palette. A
        // global binding wins over the application, so these were taking them.
        let s = migrated(r#"{"schemaVersion": 3, "shortcuts": {
            "region": "Ctrl+Shift+A",
            "previousRegion": "Ctrl+Shift+R",
            "copyLastPath": "Ctrl+Shift+P"
        }}"#);
        assert_eq!(s.shortcuts.region.as_deref(), Some("PrintScreen"));
        assert_ne!(s.shortcuts.previous_region.as_deref(), Some("Ctrl+Shift+R"));
        assert_ne!(s.shortcuts.copy_last_path.as_deref(), Some("Ctrl+Shift+P"));
    }

    #[test]
    fn the_upgrade_leaves_a_binding_the_user_picked_alone() {
        // Only bindings still sitting on an old default are moved.
        let s = migrated(r#"{"schemaVersion": 3, "shortcuts": {
            "region": "Ctrl+Alt+G",
            "fullscreen": "Ctrl+Shift+F"
        }}"#);
        assert_eq!(s.shortcuts.region.as_deref(), Some("Ctrl+Alt+G"));
        assert_eq!(s.shortcuts.fullscreen.as_deref(), Some("Ctrl+PrintScreen"));
    }

    #[test]
    fn no_default_binding_is_a_ctrl_shift_letter() {
        // The whole point of the move: every Ctrl+Shift+letter is already
        // something in an editor or a browser.
        let d = Shortcuts::default();
        for raw in [d.region, d.fullscreen, d.active_window, d.previous_region,
                    d.copy_last_path, d.open_folder, d.open_settings]
            .into_iter()
            .flatten()
        {
            let is_ctrl_shift_letter = raw.starts_with("Ctrl+Shift+")
                && raw.trim_start_matches("Ctrl+Shift+").len() == 1;
            assert!(!is_ctrl_shift_letter, "{raw} is a Ctrl+Shift+letter again");
        }
    }

    #[test]
    fn a_removed_final_action_falls_back_instead_of_wedging_the_editor() {
        // "pin" was a real setting before Pin to Screen was dropped; leaving
        // it in place would make the primary editor button do nothing.
        let s = migrated(r#"{"schemaVersion": 3, "output": {"defaultFinalAction": "pin"}}"#);
        assert_eq!(s.output.default_final_action, "copy-path");
    }

    #[test]
    fn a_current_file_passes_through_untouched() {
        let mut original = Settings::default();
        original.onboarding_completed = true;
        original.output.folder = r"C:\shots".into();
        original.appearance.accent = "#0A84FF".into();

        let json = serde_json::to_string(&original).unwrap();
        let round_tripped = migrated(&json);

        assert!(round_tripped.onboarding_completed);
        assert_eq!(round_tripped.output.folder, r"C:\shots");
        assert_eq!(round_tripped.appearance.accent, "#0A84FF");
    }

    #[test]
    fn the_tray_hint_defaults_to_unshown_for_existing_installs() {
        // Users upgrading into the tray-hint build have never seen it.
        let s = migrated(r#"{"schemaVersion": 3, "general": {"notifications": false}}"#);
        assert!(!s.general.tray_hint_shown);
        assert!(!s.general.notifications);
    }

    #[test]
    fn serialization_uses_the_camel_case_the_frontend_reads() {
        let json = serde_json::to_string(&Settings::default()).unwrap();
        for key in [
            "schemaVersion",
            "onboardingCompleted",
            "minimizeToTray",
            "trayHintShown",
            "filenamePattern",
            "defaultFinalAction",
            "copyLastPath",
        ] {
            assert!(json.contains(&format!("\"{key}\"")), "missing {key}");
        }
    }

    #[test]
    fn the_default_filename_pattern_is_sortable_and_unique() {
        let p = &Output::default().filename_pattern;
        // Recent falls back to name order, and two captures in the same second
        // must not collide, so the pattern needs date, time and milliseconds.
        for token in ["{yyyy}", "{MM}", "{dd}", "{HH}", "{mm}", "{ss}", "{fff}"] {
            assert!(p.contains(token), "pattern is missing {token}");
        }
    }
}
