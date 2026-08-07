use std::path::Path;
use std::sync::atomic::{AtomicUsize, Ordering};
use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindowBuilder};

static PIN_COUNTER: AtomicUsize = AtomicUsize::new(0);

/// Create a floating always-on-top pin window showing an already-saved image.
/// `x`/`y`/`w`/`h` are physical virtual-desktop coordinates; pass `None` to
/// open near the cursor at a size derived from the image.
pub fn create_pin(
    app: &AppHandle,
    file_path: &str,
    rect: Option<(i32, i32, u32, u32, u32)>, // x, y, w, h (physical)
) -> Result<(), String> {
    let n = PIN_COUNTER.fetch_add(1, Ordering::SeqCst);
    let label = format!("pin-{n}");

    let (x, y, w, h) = match rect {
        Some((x, y, w, h, _scale)) => (x, y, w, h),
        None => {
            let (cx, cy) = crate::winutil::cursor_pos();
            let (mut w, mut h) = image::image_dimensions(Path::new(file_path))
                .map_err(|e| format!("cannot read image: {e}"))?;
            // Cap the initial pin size so huge captures do not fill the screen.
            let max = 900u32;
            if w > max || h > max {
                let ratio = (max as f64 / w as f64).min(max as f64 / h as f64);
                w = ((w as f64) * ratio) as u32;
                h = ((h as f64) * ratio) as u32;
            }
            (cx - (w as i32) / 2, cy - (h as i32) / 2, w, h)
        }
    };

    {
        let state = app.state::<crate::AppState>();
        state
            .pins
            .lock()
            .unwrap()
            .insert(label.clone(), file_path.to_string());
    }
    let win = WebviewWindowBuilder::new(app, &label, WebviewUrl::App("index.html".into()))
        .title("Pinned Screenshot")
        .decorations(false)
        .resizable(true)
        .maximizable(false)
        .minimizable(false)
        .skip_taskbar(true)
        .always_on_top(true)
        .transparent(true)
        .shadow(false)
        .visible(false)
        .build()
        .map_err(|e| format!("cannot create pin window: {e}"))?;
    win.set_position(PhysicalPosition::new(x, y))
        .map_err(|e| e.to_string())?;
    win.set_size(PhysicalSize::new(w.max(80), h.max(60)))
        .map_err(|e| e.to_string())?;
    Ok(())
}
