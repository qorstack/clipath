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

/// Whether every sampled pixel is the same colour.
///
/// A capture that comes out flat is either a genuinely empty area of the screen
/// or a frame the compositor never filled in. The two are indistinguishable
/// from the file afterwards, so the answer is recorded at the moment of capture
/// instead of guessed at later.
pub fn is_uniform(img: &RgbaImage) -> bool {
    let (w, h) = img.dimensions();
    if w == 0 || h == 0 {
        return true;
    }
    let first = img.get_pixel(0, 0);
    let step_x = (w / 16).max(1);
    let step_y = (h / 16).max(1);
    for y in (0..h).step_by(step_y as usize) {
        for x in (0..w).step_by(step_x as usize) {
            if img.get_pixel(x, y) != first {
                return false;
            }
        }
    }
    true
}

pub fn extension_for_format(format: &str) -> &'static str {
    match format {
        "jpeg" | "jpg" => "jpg",
        "webp" => "webp",
        _ => "png",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn shot(w: u32, h: u32) -> MonitorShot {
        let mut image = RgbaImage::new(w, h);
        // Encode each pixel's position so crops can be checked by value.
        for (x, y, p) in image.enumerate_pixels_mut() {
            *p = image::Rgba([x as u8, y as u8, 0, 255]);
        }
        MonitorShot {
            index: 0,
            x: 0,
            y: 0,
            width: w,
            height: h,
            scale: 1.0,
            is_primary: true,
            image,
        }
    }

    #[test]
    fn crop_takes_the_requested_rectangle() {
        let s = shot(20, 20);
        let out = crop(&s, 4, 6, 5, 7);
        assert_eq!(out.dimensions(), (5, 7));
        assert_eq!(out.get_pixel(0, 0), &image::Rgba([4, 6, 0, 255]));
    }

    #[test]
    fn crop_clamps_a_rectangle_running_past_the_edge() {
        // The selection is built from pointer coordinates, which can land one
        // pixel outside the monitor; that must not panic.
        let s = shot(10, 10);
        let out = crop(&s, 8, 8, 100, 100);
        assert_eq!(out.dimensions(), (2, 2));
    }

    #[test]
    fn crop_of_a_fully_out_of_bounds_origin_still_returns_pixels() {
        let s = shot(10, 10);
        let out = crop(&s, 50, 50, 4, 4);
        assert_eq!(out.dimensions(), (1, 1));
    }

    #[test]
    fn crop_never_returns_a_zero_sized_image() {
        let s = shot(10, 10);
        let out = crop(&s, 5, 5, 0, 0);
        assert_eq!(out.dimensions(), (1, 1));
    }

    #[test]
    fn format_names_map_to_the_extension_actually_written() {
        assert_eq!(extension_for_format("png"), "png");
        assert_eq!(extension_for_format("jpeg"), "jpg");
        assert_eq!(extension_for_format("jpg"), "jpg");
        assert_eq!(extension_for_format("webp"), "webp");
        assert_eq!(extension_for_format("nonsense"), "png");
    }

    #[test]
    fn every_supported_format_writes_a_file_that_decodes_again() {
        let dir = std::env::temp_dir().join(format!("clipath-enc-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        let img = shot(8, 6).image;
        for format in ["png", "jpeg", "webp"] {
            let path = dir.join(format!("out.{}", extension_for_format(format)));
            encode_and_write(&img, &path, format, 90).expect("encode should succeed");
            let decoded = image::open(&path).expect("written file should decode");
            assert_eq!(decoded.width(), 8, "{format} width");
            assert_eq!(decoded.height(), 6, "{format} height");
        }
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn writing_creates_missing_folders() {
        let root = std::env::temp_dir().join(format!("clipath-mk-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        let path = root.join("nested").join("deeper").join("shot.png");
        encode_and_write(&shot(2, 2).image, &path, "png", 90).unwrap();
        assert!(path.exists());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn a_finished_write_leaves_no_scratch_file_behind() {
        // The real file is only renamed into place once encoding succeeded, so
        // a partly written capture can never be picked up by Recent.
        let dir = std::env::temp_dir().join(format!("clipath-tmp-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        encode_and_write(&shot(4, 4).image, &dir.join("shot.png"), "png", 90).unwrap();
        let leftovers: Vec<String> = fs::read_dir(&dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .map(|e| e.file_name().to_string_lossy().to_string())
            .filter(|n| n.ends_with("clipath-tmp"))
            .collect();
        assert!(leftovers.is_empty(), "scratch files left: {leftovers:?}");
        let _ = fs::remove_dir_all(&dir);
    }
}
