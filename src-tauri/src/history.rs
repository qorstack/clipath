//! Capture timestamps.
//!
//! Sorting Recent by the file's modified time looks right until a capture is
//! re-saved — annotating an older shot rewrites it and jumps it to the top.
//! Filenames encode a timestamp, but only for the default pattern, so the
//! capture time is recorded separately here and the file system is used only
//! as a fallback.

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::Manager;

type Index = HashMap<String, u64>;

fn index_path(app: &tauri::AppHandle) -> Option<PathBuf> {
    app.path().app_config_dir().ok().map(|d| d.join("history.json"))
}

fn key(path: &Path) -> String {
    path.to_string_lossy().to_lowercase()
}

pub fn load(app: &tauri::AppHandle) -> Index {
    index_path(app)
        .and_then(|p| fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save(app: &tauri::AppHandle, index: &Index) {
    let Some(path) = index_path(app) else { return };
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    if let Ok(json) = serde_json::to_string(index) {
        let _ = fs::write(path, json);
    }
}

pub fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Remember when a capture was taken. Entries for files that no longer exist
/// are dropped at the same time, so the index cannot grow without bound.
pub fn record(app: &tauri::AppHandle, path: &Path) {
    let mut index = load(app);
    index.insert(key(path), now_ms());
    index.retain(|k, _| Path::new(k).exists());
    save(app, &index);
}

pub fn forget(app: &tauri::AppHandle, path: &Path) {
    let mut index = load(app);
    if index.remove(&key(path)).is_some() {
        save(app, &index);
    }
}

pub fn captured_at(index: &Index, path: &Path) -> Option<u64> {
    index.get(&key(path)).copied()
}
