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

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    fn at(y: i32, mo: u32, d: u32, h: u32, mi: u32, s: u32) -> DateTime<Local> {
        Local.with_ymd_and_hms(y, mo, d, h, mi, s).unwrap()
    }

    #[test]
    fn strips_characters_windows_rejects() {
        assert_eq!(sanitize(r#"a<b>c:d"e/f\g|h?i*j"#), "a_b_c_d_e_f_g_h_i_j");
    }

    #[test]
    fn keeps_unicode_and_spaces() {
        assert_eq!(sanitize("ภาพ หน้าจอ"), "ภาพ หน้าจอ");
    }

    #[test]
    fn refuses_to_produce_an_empty_name() {
        // An empty stem would make the saved file ".png" — hidden on some
        // systems and impossible to tell apart from the next one.
        assert_eq!(sanitize("   "), "clipath");
        assert_eq!(sanitize(""), "clipath");
        for input in ["///", "...", "<>", "\u{1}\u{2}"] {
            assert!(!sanitize(input).is_empty(), "{input:?} sanitized to nothing");
        }
    }

    #[test]
    fn escapes_dos_device_names() {
        // "CON.png" is not a file Windows will let you create.
        assert_eq!(sanitize("CON.png"), "_CON.png");
        assert_eq!(sanitize("com1"), "_com1");
        assert_eq!(sanitize("console"), "console");
    }

    #[test]
    fn trailing_dots_are_dropped() {
        // Windows silently strips them, which breaks path round-tripping.
        assert_eq!(sanitize("shot..."), "shot");
    }

    #[test]
    fn pattern_fills_every_placeholder() {
        let now = at(2026, 8, 8, 9, 5, 3);
        let name = render_pattern(
            "{yyyy}-{MM}-{dd}_{HH}-{mm}-{ss}_{width}x{height}_{counter}",
            &now,
            2560,
            1440,
            7,
        );
        assert_eq!(name, "2026-08-08_09-05-03_2560x1440_7");
    }

    #[test]
    fn pattern_pads_to_fixed_width_so_names_sort_chronologically() {
        // Recent is ordered by name as a fallback; unpadded months would put
        // December before February.
        let a = render_pattern("{yyyy}-{MM}-{dd}", &at(2026, 2, 3, 0, 0, 0), 1, 1, 1);
        let b = render_pattern("{yyyy}-{MM}-{dd}", &at(2026, 12, 3, 0, 0, 0), 1, 1, 1);
        assert_eq!(a, "2026-02-03");
        assert!(a < b);
    }

    #[test]
    fn pattern_output_is_sanitized() {
        let now = at(2026, 8, 8, 9, 5, 3);
        assert_eq!(render_pattern("a/b:c", &now, 1, 1, 1), "a_b_c");
    }

    #[test]
    fn unique_path_steps_around_an_existing_file() {
        let dir = std::env::temp_dir().join(format!("clipath-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();

        let first = unique_path(&dir, "fixed", "png", 10, 10);
        assert_eq!(first.file_name().unwrap(), "fixed.png");
        std::fs::write(&first, b"x").unwrap();

        let second = unique_path(&dir, "fixed", "png", 10, 10);
        assert_ne!(first, second);
        assert!(!second.exists());

        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn path_template_expands_the_parts_of_a_path() {
        let p = Path::new(r"C:\Users\me\Pictures\Clipath\shot.png");
        assert_eq!(format_path_template("{path}", p, 8, 9), p.to_string_lossy());
        assert_eq!(format_path_template("{filename}", p, 8, 9), "shot.png");
        assert_eq!(
            format_path_template("{folder}", p, 8, 9),
            r"C:\Users\me\Pictures\Clipath"
        );
        assert_eq!(format_path_template("{width}x{height}", p, 8, 9), "8x9");
    }

    #[test]
    fn file_uri_escapes_spaces_and_flips_separators() {
        let p = Path::new(r"C:\My Shots\a b.png");
        assert_eq!(
            format_path_template("file-uri", p, 1, 1),
            "file:///C:/My%20Shots/a%20b.png"
        );
    }

    #[test]
    fn markdown_style_templates_survive_intact() {
        let p = Path::new(r"C:\x\y.png");
        assert_eq!(
            format_path_template("![{filename}]({path})", p, 1, 1),
            r"![y.png](C:\x\y.png)"
        );
    }
}
