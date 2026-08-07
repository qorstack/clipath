use std::borrow::Cow;
use std::path::Path;

pub fn copy_text(text: &str) -> Result<(), String> {
    let mut cb = arboard::Clipboard::new().map_err(|e| format!("clipboard unavailable: {e}"))?;
    cb.set_text(text.to_string())
        .map_err(|e| format!("clipboard write failed: {e}"))
}

pub fn copy_image_rgba(width: u32, height: u32, bytes: &[u8]) -> Result<(), String> {
    let mut cb = arboard::Clipboard::new().map_err(|e| format!("clipboard unavailable: {e}"))?;
    cb.set_image(arboard::ImageData {
        width: width as usize,
        height: height as usize,
        bytes: Cow::Borrowed(bytes),
    })
    .map_err(|e| format!("clipboard write failed: {e}"))
}

pub fn copy_image_file(path: &Path) -> Result<(), String> {
    let img = image::open(path)
        .map_err(|e| format!("cannot open image: {e}"))?
        .to_rgba8();
    copy_image_rgba(img.width(), img.height(), img.as_raw())
}
