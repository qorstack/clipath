# Clipath

**Capture. Annotate. Paste the path.**

[**Download for Windows**](https://github.com/qorstack/clipath/releases/latest/download/Clipath-Setup-x64.exe) · [clipath.qorstack.com](https://clipath.qorstack.com) · [Releases](https://github.com/qorstack/clipath/releases)

Clipath is a fast, minimal Windows screenshot utility built for developer workflows.
Every capture is **saved automatically** to a folder you choose, and the absolute
file path can be **copied to the clipboard instantly** — ready to paste into
Claude Code, Codex CLI, terminals, IDEs, and issue trackers.

```
Ctrl + Alt + A   →  drag region  →  (annotate)  →  Enter
                                        ↓
        image saved + absolute path in clipboard → Ctrl + V
```

## Features

- **Auto-save** — the screenshot exists on disk the moment you finish selecting a
  region. No Save dialog, ever.
- **Copy Path** — the signature action. Copies the saved file's absolute path as
  text (plain, quoted, file URI, Markdown, `@` mention, or a custom template).
- **Copy Image** — normal image clipboard copy for chat apps, Paint, browsers.
- **Annotations** — arrow, line, rectangle, ellipse, pen, highlighter, text,
  blur, pixelate, and a sequential step counter (1, 2, 3…), with a full color
  picker, undo/redo, and object editing.
- **Editor** — every capture opens in an editor window with a Recent strip, so
  another shot's path is one click away.
- **Crop** — trim a capture further without leaving the editor.
- **Capture modes** — region, full screen, active window, previous region.
- **Recent captures** — lightweight history with per-item actions.
- **Multi-monitor + mixed DPI** — physical-pixel-accurate cropping across monitors.
- **Local-first** — no accounts, no uploads, no telemetry.

## Performance

Measured on a two-monitor setup (2560×1440 + 1920×1080):

| | |
|---|---|
| Shortcut → selection visible | ~200 ms |
| Idle memory | ~24 MB, one process |
| Idle CPU | 0% (no polling) |

Clipath keeps its WebViews warm while you are capturing and releases them
after three idle minutes, so a burst of screenshots stays fast without a
few hundred megabytes sitting behind a tray icon for the rest of the day.
The trade is real and worth knowing: the first capture after that quiet spell
pays the rebuild, measured at ~2.2 s on a two-monitor setup. Every capture
after it is back to ~200 ms until the next idle release.

## Install

Download [`Clipath-Setup-x64.exe`](https://github.com/qorstack/clipath/releases/latest/download/Clipath-Setup-x64.exe) and run it. It installs into your
own user profile, so Windows never asks for administrator rights.

Windows may show "Windows protected your PC" because the installer is not signed
with a paid certificate — click **More info**, then **Run anyway**.

## Website

[**clipath.qorstack.com**](https://clipath.qorstack.com) — the landing page and the
full usage guide, in English and Thai. It is served straight from `docs/`: a
static, dependency-free site with no build step.

## Deploying the site

`docs/CNAME` already names the domain, so GitHub applies it as soon as Pages is
turned on. Two things have to happen, in this order:

**1. Point the subdomain at GitHub.** At whoever hosts DNS for `qorstack.com`,
add one record:

| Type | Name / Host | Value | TTL |
|---|---|---|---|
| `CNAME` | `clipath` | `qorstack.github.io` | automatic |

The value is the *user* domain, not the repository — no `/clipath` on the end.
A subdomain takes a CNAME; only an apex domain would need A records.

**2. Turn on Pages.** Repository → **Settings** → **Pages**:

- Source: **Deploy from a branch**
- Branch: **main**, folder **/docs** → Save
- Custom domain should already read `clipath.qorstack.com` from the CNAME file.
  Wait for the DNS check to go green — it can take from a few minutes to an hour
  — then tick **Enforce HTTPS**.

**3. Fill in About.** On the repository front page, the gear beside **About**:
set the description and put `https://clipath.qorstack.com` in **Website**, so the
link shows in the sidebar.

Until DNS propagates the site is also live at
`https://qorstack.github.io/clipath/`.

## Development

Prerequisites: Node 20+, pnpm, Rust (stable, MSVC).

```sh
pnpm install
pnpm tauri dev
```

## Tests

```sh
pnpm test                 # frontend: geometry, crop, key handling, settings merge
cd src-tauri && cargo test # Rust: settings migration, filenames, capture, shortcuts
```

## Building

```sh
pnpm tauri build
```

Produces `src-tauri/target/release/Clipath.exe` and an NSIS installer under
`src-tauri/target/release/bundle/nsis/`.

## Stack

- [Tauri 2](https://tauri.app) + Rust (capture, clipboard, tray, shortcuts, filesystem)
- React + TypeScript + Vite + Tailwind CSS 4 (UI)
- Konva / react-konva (annotation canvas)
- xcap (Windows monitor capture), arboard (clipboard)

## License

MIT
