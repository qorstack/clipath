use crate::settings::Settings;
use crate::AppState;
use tauri::{AppHandle, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};

/// Normalize a user-facing shortcut string ("Ctrl+Shift+A") into the
/// `modifier+Code` format the global-shortcut plugin parses.
pub fn normalize(s: &str) -> Option<String> {
    let parts: Vec<&str> = s.split('+').map(|p| p.trim()).filter(|p| !p.is_empty()).collect();
    if parts.is_empty() {
        return None;
    }
    let mut mods: Vec<&str> = Vec::new();
    let mut key: Option<String> = None;
    for p in parts {
        match p.to_ascii_lowercase().as_str() {
            "ctrl" | "control" => mods.push("control"),
            "shift" => mods.push("shift"),
            "alt" => mods.push("alt"),
            "win" | "super" | "meta" | "cmd" => mods.push("super"),
            _ => key = Some(map_key(p)?),
        }
    }
    let key = key?;
    let mut out = mods.join("+");
    if !out.is_empty() {
        out.push('+');
    }
    out.push_str(&key);
    Some(out)
}

fn map_key(k: &str) -> Option<String> {
    if k.len() == 1 {
        let c = k.chars().next()?.to_ascii_uppercase();
        if c.is_ascii_alphabetic() {
            return Some(format!("Key{c}"));
        }
        if c.is_ascii_digit() {
            return Some(format!("Digit{c}"));
        }
        return None;
    }
    // Multi-character names are expected to already be W3C `Code` names
    // (F1..F24, PrintScreen, Space, Home, ArrowUp, ...) as recorded from
    // KeyboardEvent.code in the frontend.
    Some(k.to_string())
}

const ACTIONS: &[&str] = &[
    "region",
    "fullscreen",
    "active-window",
    "previous-region",
    "copy-last-path",
    "open-folder",
    "open-settings",
];

fn shortcut_for<'a>(settings: &'a Settings, action: &str) -> Option<&'a String> {
    match action {
        "region" => settings.shortcuts.region.as_ref(),
        "fullscreen" => settings.shortcuts.fullscreen.as_ref(),
        "active-window" => settings.shortcuts.active_window.as_ref(),
        "previous-region" => settings.shortcuts.previous_region.as_ref(),
        "copy-last-path" => settings.shortcuts.copy_last_path.as_ref(),
        "open-folder" => settings.shortcuts.open_folder.as_ref(),
        "open-settings" => settings.shortcuts.open_settings.as_ref(),
        _ => None,
    }
}

/// (Re-)register all configured global shortcuts. Returns human-readable
/// errors for any that failed (conflicts with other apps, invalid combos).
pub fn register_all(app: &AppHandle, settings: &Settings) -> Vec<String> {
    let gs = app.global_shortcut();
    let _ = gs.unregister_all();
    let mut errors = Vec::new();
    let mut map: Vec<(Shortcut, String)> = Vec::new();

    // No global shortcuts until onboarding is done — otherwise pressing a
    // combination in the shortcut recorder would trigger a real capture.
    if !settings.onboarding_completed {
        if let Some(state) = app.try_state::<AppState>() {
            state.shortcut_map.lock().unwrap().clear();
        }
        return errors;
    }

    for action in ACTIONS {
        let Some(raw) = shortcut_for(settings, action) else {
            continue;
        };
        if raw.trim().is_empty() {
            continue;
        }
        let parsed = normalize(raw).and_then(|n| n.parse::<Shortcut>().ok());
        match parsed {
            Some(sc) => {
                if map.iter().any(|(existing, _)| *existing == sc) {
                    errors.push(format!("{raw} is assigned to more than one action"));
                    continue;
                }
                match gs.register(sc) {
                    Ok(()) => {
                        crate::dlog(&format!("registered {raw} -> {action}"));
                        map.push((sc, action.to_string()));
                    }
                    Err(e) => errors.push(format!("could not register {raw}: {e}")),
                }
            }
            None => errors.push(format!("invalid shortcut: {raw}")),
        }
    }

    if let Some(state) = app.try_state::<AppState>() {
        *state.shortcut_map.lock().unwrap() = map;
    }
    errors
}

pub fn action_for_shortcut(app: &AppHandle, shortcut: &Shortcut) -> Option<String> {
    let state = app.try_state::<AppState>()?;
    let map = state.shortcut_map.lock().unwrap();
    map.iter()
        .find(|(sc, _)| sc == shortcut)
        .map(|(_, action)| action.clone())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn letters_become_physical_key_codes() {
        // Not the character: on a Thai layout the character under that key is
        // not "A", but the physical code still is KeyA.
        assert_eq!(normalize("Ctrl+Shift+A").unwrap(), "control+shift+KeyA");
        assert_eq!(normalize("ctrl+shift+a").unwrap(), "control+shift+KeyA");
    }

    #[test]
    fn every_modifier_spelling_is_accepted() {
        assert_eq!(normalize("Control+Q").unwrap(), "control+KeyQ");
        assert_eq!(normalize("Alt+Q").unwrap(), "alt+KeyQ");
        assert_eq!(normalize("Win+Q").unwrap(), "super+KeyQ");
        assert_eq!(normalize("Cmd+Q").unwrap(), "super+KeyQ");
        assert_eq!(normalize("Meta+Q").unwrap(), "super+KeyQ");
    }

    #[test]
    fn digits_and_named_codes_pass_through() {
        assert_eq!(normalize("Ctrl+1").unwrap(), "control+Digit1");
        assert_eq!(normalize("Ctrl+F5").unwrap(), "control+F5");
        assert_eq!(normalize("PrintScreen").unwrap(), "PrintScreen");
        assert_eq!(normalize("Ctrl+Shift+Comma").unwrap(), "control+shift+Comma");
    }

    #[test]
    fn whitespace_and_empty_segments_are_tolerated() {
        assert_eq!(normalize(" Ctrl + Shift + A ").unwrap(), "control+shift+KeyA");
    }

    #[test]
    fn rejects_input_with_no_key() {
        assert!(normalize("").is_none());
        assert!(normalize("Ctrl+Shift").is_none());
        assert!(normalize("Ctrl++").is_none());
    }

    #[test]
    fn rejects_punctuation_that_is_not_a_code_name() {
        assert!(normalize("Ctrl+,").is_none());
    }

    #[test]
    fn every_default_shortcut_parses_into_a_real_binding() {
        // A default that cannot be registered would leave an action with no
        // way to reach it, which is how they shipped unbound the first time.
        let d = crate::settings::Shortcuts::default();
        for raw in [
            d.region,
            d.fullscreen,
            d.active_window,
            d.previous_region,
            d.copy_last_path,
            d.open_folder,
            d.open_settings,
        ] {
            let raw = raw.expect("every action ships with a default binding");
            let n = normalize(&raw).unwrap_or_else(|| panic!("{raw} did not normalize"));
            n.parse::<Shortcut>()
                .unwrap_or_else(|_| panic!("{raw} -> {n} did not parse"));
        }
    }

    #[test]
    fn defaults_do_not_collide_with_each_other() {
        let d = crate::settings::Shortcuts::default();
        let all = [
            d.region,
            d.fullscreen,
            d.active_window,
            d.previous_region,
            d.copy_last_path,
            d.open_folder,
            d.open_settings,
        ];
        let mut seen = std::collections::HashSet::new();
        for raw in all.into_iter().flatten() {
            assert!(seen.insert(normalize(&raw).unwrap()), "{raw} bound twice");
        }
    }

    #[test]
    fn defaults_leave_the_editors_own_copy_bindings_free() {
        // Ctrl+C / Ctrl+Shift+C are the editor's Copy Path and Copy Image. A
        // global binding on either would swallow them app-wide.
        let d = crate::settings::Shortcuts::default();
        for raw in [d.region, d.fullscreen, d.active_window, d.previous_region,
                    d.copy_last_path, d.open_folder, d.open_settings]
            .into_iter()
            .flatten()
        {
            let n = normalize(&raw).unwrap();
            assert_ne!(n, "control+KeyC");
            assert_ne!(n, "control+shift+KeyC");
        }
    }

    #[test]
    fn shortcut_lookup_covers_every_dispatchable_action() {
        let s = crate::settings::Settings::default();
        for action in ACTIONS {
            assert!(
                shortcut_for(&s, action).is_some(),
                "{action} has no shortcut slot"
            );
        }
        assert!(shortcut_for(&s, "not-an-action").is_none());
    }
}
