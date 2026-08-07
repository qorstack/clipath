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
        win.set_position(PhysicalPosition::new(m.x, m.y))
            .map_err(|e| e.to_string())?;
        win.set_size(PhysicalSize::new(m.width, m.height))
            .map_err(|e| e.to_string())?;
    }
    *state.overlay_layout.lock().unwrap() = layout;
    Ok(())
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

pub fn hide_overlays(app: &AppHandle) {
    for (label, win) in app.webview_windows() {
        if label.starts_with("overlay-") {
            let _ = win.hide();
        }
    }
}
