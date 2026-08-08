# Generates the NSIS wizard artwork from the app logo.
#
# NSIS will not read PNG: the header and sidebar must be uncompressed 24-bit
# BMPs at exactly 150x57 and 164x314, so they are rendered here rather than
# exported by hand and silently rejected at install time.

Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$logoPath = Join-Path $root "assets\images\clipath-logo.png"
$outDir = Join-Path $root "src-tauri\installer"
if (-not (Test-Path $outDir)) { New-Item -ItemType Directory -Path $outDir | Out-Null }

$logo = [System.Drawing.Image]::FromFile($logoPath)

function New-Canvas([int]$w, [int]$h, [string]$from, [string]$to, [float]$angle) {
  $bmp = New-Object System.Drawing.Bitmap($w, $h, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = "AntiAlias"
  $g.InterpolationMode = "HighQualityBicubic"
  $g.PixelOffsetMode = "HighQuality"
  $g.TextRenderingHint = "ClearTypeGridFit"
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

function Draw-Logo($g, [int]$x, [int]$y, [int]$size) {
  $g.DrawImage($logo, (New-Object System.Drawing.Rectangle($x, $y, $size, $size)))
}

# --- header: shown on every page after the welcome ---------------------------
$h = New-Canvas 150 57 "#12121A" "#1C1C2B" 20
$g = $h.Graphics
Draw-Logo $g 12 13 31
$white = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
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
$tagBrush = New-Object System.Drawing.SolidBrush([System.Drawing.ColorTranslator]::FromHtml("#9A9AB0"))
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

$logo.Dispose()

Write-Output "wrote header.bmp, sidebar.bmp and dmg-background.png to $outDir"
