use crate::capture::MonitorInfo;
use crate::AppState;
use std::sync::atomic::{AtomicUsize, Ordering};
use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindowBuilder};

/// Bumped every time the overlays are torn down.
///
/// Destroying a window only *asks* the event loop to destroy it, so when the
/// request comes from a background thread — which is where every capture runs
/// — the old label is still taken for a moment afterwards. Rebuilding under
/// the same label therefore failed with "a webview with label `overlay-0`
/// already exists", and since rebuilding is the recovery for an overlay that
/// stopped answering, the recovery could never work: the capture simply died.
/// A new generation cannot collide with a window on its way out.
static GENERATION: AtomicUsize = AtomicUsize::new(0);

pub fn label_for(monitor: usize) -> String {
    format!("overlay-{monitor}-g{}", GENERATION.load(Ordering::SeqCst))
}

/// Monitor index carried by an overlay label — and, by returning None for
/// anything else, the single definition of what an overlay label looks like.
pub fn monitor_of(label: &str) -> Option<usize> {
    label
        .strip_prefix("overlay-")?
        .split('-')
        .next()?
        .parse()
        .ok()
}

fn layout_of(monitors: &[MonitorInfo]) -> Vec<(i32, i32, u32, u32)> {
    monitors
        .iter()
        .map(|m| (m.x, m.y, m.width, m.height))
        .collect()
}

/// Overlay windows are created once and reused for every capture: booting a
/// WebView and loading the bundle costs ~200ms, which is the bulk of the
/// delay between pressing the shortcut and seeing the selection UI.
/// They are only rebuilt when the monitor layout actually changes.
pub fn ensure_overlays(app: &AppHandle, monitors: &[MonitorInfo]) -> Result<(), String> {
    let layout = layout_of(monitors);
    let state = app.state::<AppState>();
    let changed = {
        let known = state.overlay_layout.lock().unwrap();
        *known != layout
    };
    let all_present = monitors
        .iter()
        .all(|m| app.get_webview_window(&label_for(m.index)).is_some());

    if !changed && all_present {
        return Ok(());
    }
    close_overlays(app);

    for m in monitors {
        let label = label_for(m.index);
        crate::dlog(&format!("building {label}"));
        let win = WebviewWindowBuilder::new(app, &label, WebviewUrl::App("index.html".into()))
            .title("Clipath Capture")
            .decorations(false)
            .resizable(false)
            .maximizable(false)
            .minimizable(false)
            .skip_taskbar(true)
            .always_on_top(true)
            .visible(false)
            .shadow(false)
            .focused(false)
            // A WebView with no background colour set defaults to white, and
            // this window covers an entire monitor. Any frame drawn before the
            // frozen screenshot lands is then a full-screen white flash, so it
            // is given the near-black the scrim would have shown anyway.
            .background_color(tauri::window::Color(8, 8, 12, 255))
            .build()
            .map_err(|e| format!("cannot create capture overlay: {e}"))?;
        expand(&win, m)?;
        crate::dlog(&format!("built {label}"));
    }
    *state.overlay_layout.lock().unwrap() = layout;
    Ok(())
}

/// Give an overlay its monitor's geometry.
///
/// Idle overlays deliberately keep full monitor size even while hidden.
/// Shrinking them to free the compositing surface reads to Chromium as an
/// occluded window and it freezes the renderer, so the overlay stops
/// answering the event that starts a capture. Idle memory is reclaimed by
/// tearing the windows down entirely instead.
pub fn expand(win: &tauri::WebviewWindow, m: &MonitorInfo) -> Result<(), String> {
    win.set_position(PhysicalPosition::new(m.x, m.y))
        .map_err(|e| e.to_string())?;
    win.set_size(PhysicalSize::new(m.width, m.height))
        .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn any_exist(app: &AppHandle) -> bool {
    app.webview_windows()
        .keys()
        .any(|label| monitor_of(label).is_some())
}

pub fn close_overlays(app: &AppHandle) {
    for (label, win) in app.webview_windows() {
        if monitor_of(&label).is_some() {
            // destroy, not close: close only *requests* a close and leaves
            // the window itself alive.
            let _ = win.destroy();
        }
    }
    // After the destroy requests, not before: the labels being retired must
    // stay the ones `label_for` reports until they have been asked to go.
    GENERATION.fetch_add(1, Ordering::SeqCst);
    if let Some(state) = app.try_state::<AppState>() {
        state.overlay_layout.lock().unwrap().clear();
    }
}

/// Put the overlays away and let them drop everything the capture needed:
/// the frozen frame bitmap, the canvas backing store and the window surface.
pub fn hide_overlays(app: &AppHandle) {
    use tauri::Emitter;
    for (label, win) in app.webview_windows() {
        if monitor_of(&label).is_none() {
            continue;
        }
        let _ = win.hide();
        let _ = app.emit_to(label.as_str(), "capture-end", ());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_new_generation_never_reuses_a_retired_label() {
        let before = label_for(0);
        GENERATION.fetch_add(1, Ordering::SeqCst);
        let after = label_for(0);
        assert_ne!(
            before, after,
            "a rebuild must not ask for a label the outgoing window still holds"
        );
    }

    #[test]
    fn a_label_still_says_which_monitor_it_belongs_to() {
        assert_eq!(monitor_of(&label_for(0)), Some(0));
        assert_eq!(monitor_of(&label_for(3)), Some(3));
        assert_eq!(monitor_of("main"), None);
    }

    #[test]
    fn every_generation_is_still_recognisably_an_overlay() {
        // hide_overlays and the idle sweep find their windows this way.
        for _ in 0..3 {
            assert!(monitor_of(&label_for(1)).is_some());
            GENERATION.fetch_add(1, Ordering::SeqCst);
        }
        assert!(monitor_of("main").is_none(), "the settings window is not an overlay");
    }
}
