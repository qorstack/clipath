use chrono::{DateTime, Local};
use std::path::{Path, PathBuf};

const INVALID_CHARS: &[char] = &['<', '>', ':', '"', '/', '\\', '|', '?', '*'];
const RESERVED_NAMES: &[&str] = &[
    "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
    "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
];

pub fn sanitize(name: &str) -> String {
    let mut out: String = name
        .chars()
        .map(|c| if INVALID_CHARS.contains(&c) || (c as u32) < 32 { '_' } else { c })
        .collect();
    out = out.trim().trim_end_matches('.').to_string();
    if out.is_empty() {
        out = "clipath".into();
    }
    let stem_upper = out.split('.').next().unwrap_or("").to_uppercase();
    if RESERVED_NAMES.contains(&stem_upper.as_str()) {
        out = format!("_{out}");
    }
    out
}

pub fn render_pattern(
    pattern: &str,
    now: &DateTime<Local>,
    width: u32,
    height: u32,
    counter: u32,
) -> String {
    let name = pattern
        .replace("{yyyy}", &now.format("%Y").to_string())
        .replace("{MM}", &now.format("%m").to_string())
        .replace("{dd}", &now.format("%d").to_string())
        .replace("{HH}", &now.format("%H").to_string())
        .replace("{mm}", &now.format("%M").to_string())
        .replace("{ss}", &now.format("%S").to_string())
        .replace("{fff}", &now.format("%3f").to_string())
        .replace("{width}", &width.to_string())
        .replace("{height}", &height.to_string())
        .replace("{counter}", &counter.to_string())
        .replace("{app}", "");
    sanitize(&name)
}

/// Generate a unique full path in `folder` for the given pattern and extension.
pub fn unique_path(folder: &Path, pattern: &str, ext: &str, width: u32, height: u32) -> PathBuf {
    let now = Local::now();
    let mut counter = 1u32;
    loop {
        let base = render_pattern(pattern, &now, width, height, counter);
        let candidate = if counter == 1 {
            folder.join(format!("{base}.{ext}"))
        } else {
            folder.join(format!("{base}_{counter}.{ext}"))
        };
        if !candidate.exists() {
            return candidate;
        }
        counter += 1;
        if counter > 9999 {
            return folder.join(format!(
                "clipath_{}.{ext}",
                now.format("%Y-%m-%d_%H-%M-%S_%f")
            ));
        }
    }
}

/// Format a saved path according to the user's path format template.
pub fn format_path_template(template: &str, path: &Path, width: u32, height: u32) -> String {
    let now = Local::now();
    let full = path.to_string_lossy().to_string();
    let filename = path
        .file_name()
        .map(|f| f.to_string_lossy().to_string())
        .unwrap_or_default();
    let folder = path
        .parent()
        .map(|f| f.to_string_lossy().to_string())
        .unwrap_or_default();

    if template == "file-uri" {
        let fwd = full.replace('\\', "/").replace(' ', "%20");
        return format!("file:///{fwd}");
    }

    template
        .replace("{path}", &full)
        .replace("{filename}", &filename)
        .replace("{folder}", &folder)
        .replace("{width}", &width.to_string())
        .replace("{height}", &height.to_string())
        .replace("{date}", &now.format("%Y-%m-%d").to_string())
        .replace("{time}", &now.format("%H:%M:%S").to_string())
}
