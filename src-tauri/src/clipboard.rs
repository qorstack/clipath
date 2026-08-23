use std::borrow::Cow;
use std::path::Path;
use std::time::{Duration, Instant};

/// How long to keep trying to reach the clipboard before giving up.
///
/// The Windows clipboard is opened exclusively: while any other process holds
/// it, every attempt to open it fails outright. Clipboard managers, Office,
/// browsers and remote-desktop clients all take it for a moment whenever its
/// contents change — which is precisely when Clipath is trying to write.
///
/// arboard already retries, but only five times 5ms apart, so it gives up
/// after about 30ms. That is not long enough: the collision it is covering
/// routinely lasts longer, and the copy failed for no reason the user could
/// see or act on. A second of trying costs nothing when the clipboard is free
/// — the first attempt succeeds and nothing sleeps — and turns nearly all of
/// those collisions into a copy that simply worked.
const RETRY_BUDGET: Duration = Duration::from_millis(1000);

/// The longest single wait between attempts. Backing off keeps a busy
/// clipboard from being hammered, but waiting whole seconds would mean
/// succeeding long after the user gave up and pressed the key again.
const MAX_BACKOFF: Duration = Duration::from_millis(120);

/// Run a clipboard operation, retrying while something else holds the
/// clipboard. The error returned is the last one, so the message the user sees
/// describes why it kept failing rather than the first collision.
fn retrying<T>(budget: Duration, mut op: impl FnMut() -> Result<T, String>) -> Result<T, String> {
    let deadline = Instant::now() + budget;
    let mut backoff = Duration::from_millis(10);
    loop {
        match op() {
            Ok(value) => return Ok(value),
            Err(e) => {
                let now = Instant::now();
                if now >= deadline {
                    return Err(e);
                }
                // Never sleep past the deadline: the budget is what the caller
                // is willing to wait, not a floor to overshoot.
                std::thread::sleep(backoff.min(deadline - now));
                backoff = (backoff * 2).min(MAX_BACKOFF);
            }
        }
    }
}

pub fn copy_text(text: &str) -> Result<(), String> {
    retrying(RETRY_BUDGET, || {
        let mut cb =
            arboard::Clipboard::new().map_err(|e| format!("clipboard unavailable: {e}"))?;
        cb.set_text(text.to_string())
            .map_err(|e| format!("clipboard write failed: {e}"))
    })
}

pub fn copy_image_rgba(width: u32, height: u32, bytes: &[u8]) -> Result<(), String> {
    retrying(RETRY_BUDGET, || {
        let mut cb =
            arboard::Clipboard::new().map_err(|e| format!("clipboard unavailable: {e}"))?;
        cb.set_image(arboard::ImageData {
            width: width as usize,
            height: height as usize,
            bytes: Cow::Borrowed(bytes),
        })
        .map_err(|e| format!("clipboard write failed: {e}"))
    })
}

pub fn copy_image_file(path: &Path) -> Result<(), String> {
    let img = image::open(path)
        .map_err(|e| format!("cannot open image: {e}"))?
        .to_rgba8();
    copy_image_rgba(img.width(), img.height(), img.as_raw())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;

    #[test]
    fn a_clipboard_that_answers_first_time_is_never_slept_on() {
        let started = Instant::now();
        let attempts = Cell::new(0);
        let out = retrying(RETRY_BUDGET, || {
            attempts.set(attempts.get() + 1);
            Ok::<_, String>(())
        });
        assert!(out.is_ok());
        assert_eq!(attempts.get(), 1);
        assert!(started.elapsed() < Duration::from_millis(50));
    }

    #[test]
    fn a_clipboard_briefly_held_by_something_else_is_waited_out() {
        let attempts = Cell::new(0);
        let out = retrying(Duration::from_millis(500), || {
            attempts.set(attempts.get() + 1);
            if attempts.get() < 3 {
                Err("clipboard write failed: occupied".to_string())
            } else {
                Ok(())
            }
        });
        assert_eq!(out, Ok(()));
        assert_eq!(attempts.get(), 3);
    }

    #[test]
    fn a_clipboard_that_never_frees_up_gives_up_with_the_last_error() {
        let attempts = Cell::new(0);
        let started = Instant::now();
        let out = retrying(Duration::from_millis(80), || {
            attempts.set(attempts.get() + 1);
            Err::<(), _>(format!("attempt {}", attempts.get()))
        });
        assert_eq!(out, Err(format!("attempt {}", attempts.get())));
        assert!(attempts.get() > 1, "should have retried at least once");
        // Bounded by the budget rather than running on: a copy that cannot
        // happen has to say so while the user is still looking at the window.
        assert!(started.elapsed() < Duration::from_millis(400));
    }
}
