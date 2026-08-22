//! Thin Win32 helpers: foreground window tracking and active-window bounds.

use windows::core::BOOL;
use windows::Win32::Foundation::{HWND, RECT};
use windows::Win32::Graphics::Dwm::{
    DwmFlush, DwmGetWindowAttribute, DwmSetWindowAttribute, DWMWA_CLOAK,
    DWMWA_EXTENDED_FRAME_BOUNDS, DWMWA_TRANSITIONS_FORCEDISABLED,
};
use windows::Win32::System::Threading::{AttachThreadInput, GetCurrentThreadId};
use windows::Win32::UI::Input::KeyboardAndMouse::SetFocus;
use windows::Win32::UI::WindowsAndMessaging::{
    BringWindowToTop, GetCursorPos, GetForegroundWindow, GetWindowThreadProcessId, IsHungAppWindow,
    IsIconic, SetForegroundWindow, ShowWindow, SW_RESTORE,
};

pub fn foreground_window() -> isize {
    unsafe { GetForegroundWindow().0 as isize }
}

/// Bring a window to the front, past Windows' focus-stealing prevention.
///
/// A bare `SetForegroundWindow` is refused for a process that did not produce
/// the last input event: the window is shown but stays behind whatever the user
/// was doing, so pressing the Settings shortcut looks like nothing happened.
/// Attaching this thread's input queue to the current foreground thread's makes
/// the two count as one for that check, which is the sanctioned way through.
pub fn force_foreground(hwnd: isize) {
    if hwnd == 0 {
        return;
    }
    let target = HWND(hwnd as *mut _);
    unsafe {
        if IsIconic(target).as_bool() {
            let _ = ShowWindow(target, SW_RESTORE);
        }
        let fg = GetForegroundWindow();
        if fg == target {
            return;
        }

        // Attaching joins this thread's input queue to the other window's, and
        // a shared queue means a shared fate: if that application has stopped
        // pumping messages, this thread stops with it. Clipath froze exactly
        // that way — unclickable, uncloseable — so a window that is already
        // not responding is never attached to. Losing the foreground is a far
        // smaller problem than hanging.
        let fg_thread = if fg.0.is_null() || IsHungAppWindow(fg).as_bool() {
            0
        } else {
            GetWindowThreadProcessId(fg, None)
        };
        let this_thread = GetCurrentThreadId();
        let attached = fg_thread != 0
            && fg_thread != this_thread
            && AttachThreadInput(this_thread, fg_thread, true).as_bool();

        let _ = BringWindowToTop(target);
        let _ = SetForegroundWindow(target);
        if attached {
            // Only meaningful while the queues are joined, and it must happen
            // before they are separated again.
            let _ = SetFocus(Some(target));
            let _ = AttachThreadInput(this_thread, fg_thread, false);
        }
    }
}

/// Hand the foreground back to whatever the user was in before a capture.
///
/// Deliberately plain: this runs on the UI thread when the editor closes, and
/// the attach trick there is what let another application's hang become ours.
/// Best effort is the right level — if Windows refuses, it flashes a taskbar
/// button and nothing is broken.
pub fn restore_foreground(hwnd: isize) {
    if hwnd == 0 {
        return;
    }
    unsafe {
        let _ = SetForegroundWindow(HWND(hwnd as *mut _));
    }
}

/// Remove a window from the screen instantly, or put it back — without going
/// through hide/show.
///
/// Hiding animates: DWM fades the window out over ~200ms, and a screenshot
/// grabbed during the fade contains a half-transparent ghost of it — the
/// "captures stacked into each other" bug. Cloaking is DWM simply not
/// compositing the window: effective at the next frame, no animation, and the
/// window keeps its visible state so nothing downstream changes behaviour.
pub fn set_cloaked(hwnd: isize, cloaked: bool) {
    if hwnd == 0 {
        return;
    }
    let hwnd = HWND(hwnd as *mut _);
    let set = |attr, on: bool| {
        let value = BOOL::from(on);
        let r = unsafe {
            DwmSetWindowAttribute(
                hwnd,
                attr,
                &value as *const _ as *const _,
                std::mem::size_of::<BOOL>() as u32,
            )
        };
        if let Err(e) = r {
            crate::dlog(&format!("cloak: DwmSetWindowAttribute({attr:?}, {on}) failed: {e}"));
        }
    };
    // Windows 11 animates even the cloak; a grab taken mid-fade still caught
    // the ghost. Transitions are forced off around the cloak so it really is
    // a single-frame disappearance, and turned back on afterwards so the
    // window keeps its ordinary animations everywhere else.
    if cloaked {
        set(DWMWA_TRANSITIONS_FORCEDISABLED, true);
        set(DWMWA_CLOAK, true);
    } else {
        set(DWMWA_CLOAK, false);
        set(DWMWA_TRANSITIONS_FORCEDISABLED, false);
    }
}

/// Make WebView2 notice that its window is back on screen.
///
/// Showing a window that Chromium froze while it was hidden — most reliably
/// after the display slept or the session was locked — sometimes leaves the
/// renderer running but presenting nothing: input works, the capture commits,
/// and none of it is ever painted. Toggling the controller's visibility is the
/// transition Chromium cannot miss, and the position notification makes it
/// re-check where the window actually is. Called after every show of a window
/// that was hidden; on a healthy webview both calls are cheap no-ops.
pub fn wake_webview(win: &tauri::WebviewWindow) {
    let _ = win.with_webview(|wv| unsafe {
        let controller = wv.controller();
        let _ = controller.SetIsVisible(false);
        let _ = controller.SetIsVisible(true);
        let _ = controller.NotifyParentWindowPositionChanged();
    });
}

/// Block until the compositor has drawn at least one frame since now.
///
/// Cloaking a window is a request to DWM, not an instant fact: the window is
/// still on screen until the next composition pass, and a screenshot grabbed
/// before then contains it. The wait used to be a flat 150ms — an eighth of a
/// second added to every capture taken while the editor was open, to cover
/// something that takes one frame. `DwmFlush` returns when that frame has
/// actually been composed, so the wait is as long as it needs to be and no
/// longer. Two of them: the first returns at the boundary of the pass that may
/// already have been in flight when the cloak was set.
pub fn wait_for_composition() {
    unsafe {
        for _ in 0..2 {
            if DwmFlush().is_err() {
                // Composition off or unavailable — fall back to roughly two
                // frames rather than returning to a screen that still has the
                // window on it.
                std::thread::sleep(std::time::Duration::from_millis(32));
                return;
            }
        }
    }
}

pub fn cursor_pos() -> (i32, i32) {
    let mut pt = windows::Win32::Foundation::POINT::default();
    unsafe {
        let _ = GetCursorPos(&mut pt);
    }
    (pt.x, pt.y)
}

/// Physical virtual-desktop bounds (x, y, w, h) of the foreground window,
/// using DWM extended frame bounds so drop shadows are excluded.
pub fn foreground_window_bounds() -> Option<(i32, i32, i32, i32)> {
    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd.0.is_null() {
            return None;
        }
        let mut rect = RECT::default();
        let ok = DwmGetWindowAttribute(
            hwnd,
            DWMWA_EXTENDED_FRAME_BOUNDS,
            &mut rect as *mut _ as *mut _,
            std::mem::size_of::<RECT>() as u32,
        );
        if ok.is_err() {
            return None;
        }
        let w = rect.right - rect.left;
        let h = rect.bottom - rect.top;
        if w <= 0 || h <= 0 {
            return None;
        }
        Some((rect.left, rect.top, w, h))
    }
}
