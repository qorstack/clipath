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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lookup_ignores_path_casing() {
        // Windows paths round-trip through the frontend with inconsistent
        // casing; the same file must not get two entries.
        let mut index = Index::new();
        index.insert(key(Path::new(r"C:\Users\Me\Pictures\Shot.png")), 42);
        assert_eq!(
            captured_at(&index, Path::new(r"c:\users\me\pictures\shot.png")),
            Some(42)
        );
    }

    #[test]
    fn an_unknown_file_has_no_recorded_time() {
        let index = Index::new();
        assert_eq!(captured_at(&index, Path::new(r"C:\nope.png")), None);
    }

    #[test]
    fn recorded_times_order_captures_by_when_they_were_taken() {
        // Sorting by the file's mtime reorders Recent whenever an older shot
        // is annotated and saved again, which is what this index exists to fix.
        let first = now_ms();
        std::thread::sleep(std::time::Duration::from_millis(5));
        let second = now_ms();
        assert!(second > first, "{second} should be later than {first}");
    }

    #[test]
    fn the_index_survives_a_json_round_trip() {
        let mut index = Index::new();
        index.insert(key(Path::new(r"C:\a\b.png")), 7);
        let json = serde_json::to_string(&index).unwrap();
        let back: Index = serde_json::from_str(&json).unwrap();
        assert_eq!(captured_at(&back, Path::new(r"C:\A\B.PNG")), Some(7));
    }
}
