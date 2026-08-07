use crate::capture::MonitorInfo;
use crate::AppState;
use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindowBuilder};

pub fn label_for(monitor: usize) -> String {
    format!("overlay-{monitor}")
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
            .build()
            .map_err(|e| format!("cannot create capture overlay: {e}"))?;
        expand(&win, m)?;
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
        .any(|label| label.starts_with("overlay-"))
}

pub fn close_overlays(app: &AppHandle) {
    for (label, win) in app.webview_windows() {
        if label.starts_with("overlay-") {
            let _ = win.close();
        }
    }
    if let Some(state) = app.try_state::<AppState>() {
        state.overlay_layout.lock().unwrap().clear();
    }
}

/// Whether a selection overlay is actually on screen. Used to tell a real
/// capture in progress from a stale busy flag.
pub fn any_visible(app: &AppHandle) -> bool {
    app.webview_windows()
        .iter()
        .any(|(label, win)| label.starts_with("overlay-") && win.is_visible().unwrap_or(false))
}

/// Put the overlays away and let them drop everything the capture needed:
/// the frozen frame bitmap, the canvas backing store and the window surface.
pub fn hide_overlays(app: &AppHandle) {
    use tauri::Emitter;
    for (label, win) in app.webview_windows() {
        if !label.starts_with("overlay-") {
            continue;
        }
        let _ = win.hide();
        let _ = app.emit_to(label.as_str(), "capture-end", ());
    }
}
