# Generates the NSIS wizard artwork and the installer icon from the app logo.
#
# NSIS will not read PNG for wizard art: the header and sidebar must be
# uncompressed 24-bit BMPs at exactly 150x57 and 164x314, so they are rendered
# here rather than exported by hand and silently rejected at install time.

Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$logoPath = Join-Path $root "assets\images\clipath-logo.png"
$outDir = Join-Path $root "src-tauri\installer"
if (-not (Test-Path $outDir)) { New-Item -ItemType Directory -Path $outDir | Out-Null }

$logo = [System.Drawing.Image]::FromFile($logoPath)

function Set-Quality($g) {
  $g.SmoothingMode = "AntiAlias"
  $g.InterpolationMode = "HighQualityBicubic"
  $g.PixelOffsetMode = "HighQuality"
  $g.CompositingQuality = "HighQuality"
  # Not ClearType: subpixel rendering lays coloured fringes along every stroke,
  # which read as blur once the text is baked into a bitmap on a dark ground.
  $g.TextRenderingHint = "AntiAliasGridFit"
}

function New-Canvas([int]$w, [int]$h, [string]$from, [string]$to, [float]$angle) {
  $bmp = New-Object System.Drawing.Bitmap($w, $h, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  Set-Quality $g
  $rect = New-Object System.Drawing.Rectangle(0, 0, $w, $h)
  $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    $rect,
    [System.Drawing.ColorTranslator]::FromHtml($from),
    [System.Drawing.ColorTranslator]::FromHtml($to),
    $angle)
  $g.FillRectangle($brush, $rect)
  $brush.Dispose()
  return @{ Bitmap = $bmp; Graphics = $g }
}

# Shrinking 623px of thin line art straight down to 31px in one bicubic step
# loses the strokes to averaging. Halving repeatedly until the source is close
# to the target keeps them crisp.
function Get-Scaled([int]$size) {
  $current = New-Object System.Drawing.Bitmap($logo)
  while ($current.Width -gt $size * 2) {
    $half = New-Object System.Drawing.Bitmap([int]($current.Width / 2), [int]($current.Height / 2),
      [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $hg = [System.Drawing.Graphics]::FromImage($half)
    Set-Quality $hg
    $hg.DrawImage($current, (New-Object System.Drawing.Rectangle(0, 0, $half.Width, $half.Height)))
    $hg.Dispose()
    $current.Dispose()
    $current = $half
  }
  $out = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $og = [System.Drawing.Graphics]::FromImage($out)
  Set-Quality $og
  $og.DrawImage($current, (New-Object System.Drawing.Rectangle(0, 0, $size, $size)))
  $og.Dispose()
  $current.Dispose()
  return $out
}

function Draw-Logo($g, [int]$x, [int]$y, [int]$size) {
  $scaled = Get-Scaled $size
  $g.DrawImage($scaled, $x, $y)
  $scaled.Dispose()
}

$white = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
$tagBrush = New-Object System.Drawing.SolidBrush([System.Drawing.ColorTranslator]::FromHtml("#9A9AB0"))

# --- header: shown on every page after the welcome ---------------------------
$h = New-Canvas 150 57 "#12121A" "#1C1C2B" 20
$g = $h.Graphics
Draw-Logo $g 12 13 31
# 150px leaves no room for a tagline beside the mark — the wordmark alone,
# optically centred, reads better than two clipped lines.
$font = New-Object System.Drawing.Font("Segoe UI Semibold", 13)
$g.DrawString("Clipath", $font, $white, 50, 16)
$h.Bitmap.Save((Join-Path $outDir "header.bmp"), [System.Drawing.Imaging.ImageFormat]::Bmp)
$g.Dispose(); $h.Bitmap.Dispose()

# --- sidebar: the welcome and finish pages -----------------------------------
$s = New-Canvas 164 314 "#0D0D14" "#232338" 60
$g = $s.Graphics

# A soft accent glow behind the mark, so the flat panel has some depth.
$glow = New-Object System.Drawing.Drawing2D.GraphicsPath
$glow.AddEllipse(6, 46, 152, 152)
$gb = New-Object System.Drawing.Drawing2D.PathGradientBrush($glow)
$gb.CenterColor = [System.Drawing.Color]::FromArgb(70, 94, 92, 230)
$gb.SurroundColors = @([System.Drawing.Color]::FromArgb(0, 13, 13, 20))
$g.FillPath($gb, $glow)
$gb.Dispose(); $glow.Dispose()

Draw-Logo $g 42 76 80

$title = New-Object System.Drawing.Font("Segoe UI Semibold", 17)
$sz = $g.MeasureString("Clipath", $title)
$g.DrawString("Clipath", $title, $white, (164 - $sz.Width) / 2, 182)

$tagFont = New-Object System.Drawing.Font("Segoe UI", 8)
$fmt = New-Object System.Drawing.StringFormat
$fmt.Alignment = [System.Drawing.StringAlignment]::Center
$g.DrawString("Every screenshot,`nready to paste", $tagFont, $tagBrush,
  (New-Object System.Drawing.RectangleF(10, 212, 144, 40)), $fmt)

# Accent rule at the foot to tie it to the app's own accent colour.
$pen = New-Object System.Drawing.Pen([System.Drawing.ColorTranslator]::FromHtml("#5E5CE6"), 2)
$g.DrawLine($pen, 62, 274, 102, 274)
$pen.Dispose()

$s.Bitmap.Save((Join-Path $outDir "sidebar.bmp"), [System.Drawing.Imaging.ImageFormat]::Bmp)
$g.Dispose(); $s.Bitmap.Dispose()

# --- macOS DMG backdrop ------------------------------------------------------
# The drag-to-Applications window is the whole macOS install experience, so the
# arrow and labels are drawn in rather than left to a bare grey window.
$d = New-Canvas 660 420 "#0D0D14" "#1E1E2E" 45
$g = $d.Graphics
Draw-Logo $g 300 34 60
$dmgTitle = New-Object System.Drawing.Font("Segoe UI Semibold", 15)
$fmtC = New-Object System.Drawing.StringFormat
$fmtC.Alignment = [System.Drawing.StringAlignment]::Center
$g.DrawString("Clipath", $dmgTitle, $white,
  (New-Object System.Drawing.RectangleF(0, 100, 660, 30)), $fmtC)
$dmgTag = New-Object System.Drawing.Font("Segoe UI", 9.5)
$g.DrawString("Drag Clipath into Applications to install", $dmgTag, $tagBrush,
  (New-Object System.Drawing.RectangleF(0, 130, 660, 24)), $fmtC)

# Arrow from the app icon toward the Applications alias.
$arrowPen = New-Object System.Drawing.Pen([System.Drawing.ColorTranslator]::FromHtml("#5E5CE6"), 3)
$arrowPen.EndCap = [System.Drawing.Drawing2D.LineCap]::ArrowAnchor
$g.DrawLine($arrowPen, 268, 210, 392, 210)
$arrowPen.Dispose()

$d.Bitmap.Save((Join-Path $outDir "dmg-background.png"), [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $d.Bitmap.Dispose()

# --- installer icon ----------------------------------------------------------
# The app's own icon is white line art on transparency, which is right for the
# dark title bar it lives on and for the tray. Windows draws the installer's
# icon on its own light title bar, where white on white is invisible — so the
# installer gets the mark on a brand-coloured tile instead.
function New-Tile([int]$size) {
  $bmp = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  Set-Quality $g

  $radius = [Math]::Max(2, [int]($size * 0.22))
  $inset = [Math]::Max(0, [int]($size * 0.02))
  $box = $size - 1 - ($inset * 2)
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d2 = $radius * 2
  $path.AddArc($inset, $inset, $d2, $d2, 180, 90)
  $path.AddArc($inset + $box - $d2, $inset, $d2, $d2, 270, 90)
  $path.AddArc($inset + $box - $d2, $inset + $box - $d2, $d2, $d2, 0, 90)
  $path.AddArc($inset, $inset + $box - $d2, $d2, $d2, 90, 90)
  $path.CloseFigure()

  $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    (New-Object System.Drawing.Rectangle($inset, $inset, $box, $box)),
    [System.Drawing.ColorTranslator]::FromHtml("#6E6BFF"),
    [System.Drawing.ColorTranslator]::FromHtml("#4F46D6"),
    60.0)
  $g.FillPath($brush, $path)
  $brush.Dispose(); $path.Dispose()

  if ($size -ge 40) {
    # The mark is line art, so it needs room to breathe inside the tile.
    $markSize = [int]($size * 0.62)
    $offset = [int](($size - $markSize) / 2)
    $mark = Get-Scaled $markSize
    $g.DrawImage($mark, $offset, $offset)
    $mark.Dispose()
  } else {
    # Below ~40px the dashed rectangle and cursor inside the logo collapse into
    # a smudge. The four corner brackets alone still read as the same mark, and
    # drawn as strokes they stay crisp at the 16px the title bar asks for.
    # The arms must stop well short of each other: run them past about a third
    # of the side and the four brackets close up into a plain square, which is
    # not the mark any more.
    $pad = $size * 0.24
    $arm = $size * 0.15
    $pen = New-Object System.Drawing.Pen([System.Drawing.Color]::White,
      [float]([Math]::Max(1.3, $size * 0.078)))
    $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    $pen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
    $lo = $pad
    $hi = $size - $pad
    foreach ($corner in @(
      @(($lo), ($lo + $arm), ($lo), ($lo), ($lo + $arm), ($lo)),
      @(($hi), ($lo + $arm), ($hi), ($lo), ($hi - $arm), ($lo)),
      @(($lo), ($hi - $arm), ($lo), ($hi), ($lo + $arm), ($hi)),
      @(($hi), ($hi - $arm), ($hi), ($hi), ($hi - $arm), ($hi))
    )) {
      $pts = @(
        (New-Object System.Drawing.PointF([float]$corner[0], [float]$corner[1])),
        (New-Object System.Drawing.PointF([float]$corner[2], [float]$corner[3])),
        (New-Object System.Drawing.PointF([float]$corner[4], [float]$corner[5]))
      )
      $g.DrawLines($pen, $pts)
    }
    $pen.Dispose()
  }

  $g.Dispose()
  return $bmp
}

# ICO container: a directory of bottom-up 32bpp DIBs, each with a (here always
# opaque) AND mask. PNG-compressed entries are legal and smaller, but only the
# modern shell reads them — GDI+ and older tooling see a corrupt icon — so every
# size is written as a DIB.
function Write-Ico([string]$path, [int[]]$sizes) {
  $entries = @()
  foreach ($size in $sizes) {
    $tile = New-Tile $size
    $rect = New-Object System.Drawing.Rectangle(0, 0, $size, $size)
    $data = $tile.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadOnly,
      [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $stride = $size * 4
    $top = New-Object byte[] ($stride * $size)
    [System.Runtime.InteropServices.Marshal]::Copy($data.Scan0, $top, 0, $top.Length)
    $tile.UnlockBits($data)

    $pixels = New-Object byte[] ($stride * $size)
    for ($y = 0; $y -lt $size; $y++) {
      # DIBs are stored bottom-up, so the last source row is written first.
      [Array]::Copy($top, ($size - 1 - $y) * $stride, $pixels, $y * $stride, $stride)
    }
    $maskStride = [int](([Math]::Ceiling($size / 32.0)) * 4)
    $mask = New-Object byte[] ($maskStride * $size)   # all zero: fully opaque

    $body = New-Object System.IO.MemoryStream
    $bw = New-Object System.IO.BinaryWriter($body)
    $bw.Write([uint32]40)            # BITMAPINFOHEADER size
    $bw.Write([int32]$size)
    $bw.Write([int32]($size * 2))    # XOR image plus AND mask
    $bw.Write([uint16]1)             # planes
    $bw.Write([uint16]32)            # bits per pixel
    $bw.Write([uint32]0)             # BI_RGB
    $bw.Write([uint32]($pixels.Length + $mask.Length))
    $bw.Write([int32]0); $bw.Write([int32]0); $bw.Write([uint32]0); $bw.Write([uint32]0)
    $bw.Write($pixels)
    $bw.Write($mask)
    $bw.Flush()
    $entries += , @{ Size = $size; Data = $body.ToArray() }
    $bw.Dispose(); $body.Dispose()
    $tile.Dispose()
  }

  $out = New-Object System.IO.MemoryStream
  $w = New-Object System.IO.BinaryWriter($out)
  $w.Write([uint16]0); $w.Write([uint16]1); $w.Write([uint16]$entries.Count)
  $offset = 6 + 16 * $entries.Count
  foreach ($e in $entries) {
    $dim = if ($e.Size -ge 256) { 0 } else { $e.Size }   # 0 encodes 256
    $w.Write([byte]$dim); $w.Write([byte]$dim)
    $w.Write([byte]0); $w.Write([byte]0)
    $w.Write([uint16]1); $w.Write([uint16]32)
    $w.Write([uint32]$e.Data.Length)
    $w.Write([uint32]$offset)
    $offset += $e.Data.Length
  }
  foreach ($e in $entries) { $w.Write($e.Data) }
  $w.Flush()
  [System.IO.File]::WriteAllBytes($path, $out.ToArray())
  $w.Dispose(); $out.Dispose()
}

Write-Ico (Join-Path $outDir "installer.ico") @(16, 24, 32, 48, 64, 128, 256)

# A PNG of the tile as well, for anywhere a preview is wanted.
$preview = New-Tile 256
$preview.Save((Join-Path $outDir "installer-icon.png"), [System.Drawing.Imaging.ImageFormat]::Png)
$preview.Dispose()

# The site's favicon has the same problem the installer had: a browser tab is
# light, and white line art on it is a blank space. It gets the tile too.
$docsAssets = Join-Path $root "docs\assets"
if (Test-Path $docsAssets) {
  Write-Ico (Join-Path $docsAssets "favicon.ico") @(16, 32, 48)
  $og = New-Tile 180
  $og.Save((Join-Path $docsAssets "app-icon.png"), [System.Drawing.Imaging.ImageFormat]::Png)
  $og.Dispose()
}

$logo.Dispose()

Write-Output "wrote header.bmp, sidebar.bmp, dmg-background.png and installer.ico to $outDir"
