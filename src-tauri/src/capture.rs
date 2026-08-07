use image::RgbaImage;
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};

/// One captured monitor: physical virtual-desktop coordinates + frozen pixels.
/// Pixels stay in memory — the overlay reads them over IPC, so nothing is
/// written to disk on the capture hot path.
pub struct MonitorShot {
    pub index: usize,
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub scale: f64,
    pub is_primary: bool,
    pub image: RgbaImage,
}

#[derive(Serialize, Clone, Copy)]
#[serde(rename_all = "camelCase")]
pub struct MonitorInfo {
    pub index: usize,
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub scale: f64,
    pub is_primary: bool,
}

impl MonitorShot {
    pub fn info(&self) -> MonitorInfo {
        MonitorInfo {
            index: self.index,
            x: self.x,
            y: self.y,
            width: self.width,
            height: self.height,
            scale: self.scale,
            is_primary: self.is_primary,
        }
    }
}

/// Region on a monitor, in physical pixels relative to that monitor's top-left.
#[derive(Debug, Clone, Copy, Serialize)]
pub struct Region {
    pub monitor: usize,
    pub x: u32,
    pub y: u32,
    pub w: u32,
    pub h: u32,
}

pub struct CaptureSession {
    pub monitors: Vec<MonitorShot>,
    pub saved_path: Option<PathBuf>,
    pub region: Option<Region>,
    pub prev_focus: isize,
}

/// Monitor geometry without grabbing any pixels — cheap enough to run at
/// startup so overlay windows can be sized and pre-warmed.
pub fn monitor_layout() -> Result<Vec<MonitorInfo>, String> {
    let monitors = xcap::Monitor::all().map_err(|e| format!("monitor enumeration failed: {e}"))?;
    if monitors.is_empty() {
        return Err("no monitors found".into());
    }
    let mut out = Vec::new();
    for (index, m) in monitors.into_iter().enumerate() {
        out.push(MonitorInfo {
            index,
            x: m.x().map_err(|e| e.to_string())?,
            y: m.y().map_err(|e| e.to_string())?,
            width: m.width().map_err(|e| e.to_string())?,
            height: m.height().map_err(|e| e.to_string())?,
            scale: m.scale_factor().map_err(|e| e.to_string())? as f64,
            is_primary: m.is_primary().unwrap_or(false),
        });
    }
    Ok(out)
}

/// Grab every monitor's pixels. Frames are kept in memory only.
pub fn capture_all_monitors() -> Result<Vec<MonitorShot>, String> {
    let monitors = xcap::Monitor::all().map_err(|e| format!("monitor enumeration failed: {e}"))?;
    if monitors.is_empty() {
        return Err("no monitors found".into());
    }
    let mut shots = Vec::new();
    for (index, m) in monitors.into_iter().enumerate() {
        let image = m
            .capture_image()
            .map_err(|e| format!("screen capture failed: {e}"))?;
        shots.push(MonitorShot {
            index,
            x: m.x().map_err(|e| e.to_string())?,
            y: m.y().map_err(|e| e.to_string())?,
            width: image.width(),
            height: image.height(),
            scale: m.scale_factor().map_err(|e| e.to_string())? as f64,
            is_primary: m.is_primary().unwrap_or(false),
            image,
        });
    }
    Ok(shots)
}

pub fn crop(shot: &MonitorShot, x: u32, y: u32, w: u32, h: u32) -> RgbaImage {
    let x = x.min(shot.width.saturating_sub(1));
    let y = y.min(shot.height.saturating_sub(1));
    let w = w.min(shot.width - x).max(1);
    let h = h.min(shot.height - y).max(1);
    image::imageops::crop_imm(&shot.image, x, y, w, h).to_image()
}

/// Encode and atomically write an image to `path` in the requested format.
pub fn encode_and_write(
    img: &RgbaImage,
    path: &Path,
    format: &str,
    quality: u8,
) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("cannot create folder: {e}"))?;
    }
    let tmp = path.with_extension("clipath-tmp");
    let result = (|| -> Result<(), String> {
        match format {
            "jpeg" | "jpg" => {
                let rgb = image::DynamicImage::ImageRgba8(img.clone()).to_rgb8();
                let file = fs::File::create(&tmp).map_err(|e| e.to_string())?;
                let mut writer = std::io::BufWriter::new(file);
                let encoder =
                    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut writer, quality);
                rgb.write_with_encoder(encoder).map_err(|e| e.to_string())?;
            }
            "webp" => {
                let file = fs::File::create(&tmp).map_err(|e| e.to_string())?;
                let writer = std::io::BufWriter::new(file);
                let encoder = image::codecs::webp::WebPEncoder::new_lossless(writer);
                img.write_with_encoder(encoder).map_err(|e| e.to_string())?;
            }
            _ => {
                img.save_with_format(&tmp, image::ImageFormat::Png)
                    .map_err(|e| e.to_string())?;
            }
        }
        Ok(())
    })();
    match result {
        Ok(()) => {
            fs::rename(&tmp, path).map_err(|e| format!("cannot finalize file: {e}"))?;
            Ok(())
        }
        Err(e) => {
            let _ = fs::remove_file(&tmp);
            Err(format!("cannot save screenshot: {e}"))
        }
    }
}

pub fn extension_for_format(format: &str) -> &'static str {
    match format {
        "jpeg" | "jpg" => "jpg",
        "webp" => "webp",
        _ => "png",
    }
}
