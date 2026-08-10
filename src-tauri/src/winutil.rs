//! Thin Win32 helpers: foreground window tracking and active-window bounds.

use windows::Win32::Foundation::{HWND, RECT};
use windows::Win32::Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_EXTENDED_FRAME_BOUNDS};
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
