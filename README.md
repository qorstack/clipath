# Clipath

**Capture. Annotate. Paste the path.**

Clipath is a fast, minimal Windows screenshot utility built for developer workflows.
Every capture is **saved automatically** to a folder you choose, and the absolute
file path can be **copied to the clipboard instantly** — ready to paste into
Claude Code, Codex CLI, terminals, IDEs, and issue trackers.

```
Ctrl + Shift + A  →  drag region  →  (annotate)  →  Enter
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

## Development

Prerequisites: Node 20+, pnpm, Rust (stable, MSVC).

```sh
pnpm install
pnpm tauri dev
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
