# Regenerates every derived logo in the project from one source file.
#
#   assets/images/clipath-logo.png  ->  app icon, tray icon, in-app logo,
#                                       website logo and favicon, installer art
#
# Run it after changing the source; nothing else needs editing by hand.

Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$logoPath = Join-Path $root "assets\images\clipath-logo.png"
$installerArtPath = Join-Path $root "assets\images\installer-sidebar-art.png"
$installerDir = Join-Path $root "src-tauri\installer"
$iconsDir = Join-Path $root "src-tauri\icons"
$appAssets = Join-Path $root "src\assets"
$siteAssets = Join-Path $root "docs\assets"
foreach ($d in @($installerDir, $iconsDir, $appAssets, $siteAssets)) {
  if (-not (Test-Path $d)) { New-Item -ItemType Directory -Path $d | Out-Null }
}

function Set-Quality($g) {
  $g.SmoothingMode = "AntiAlias"
  $g.InterpolationMode = "HighQualityBicubic"
  $g.PixelOffsetMode = "HighQuality"
  $g.CompositingQuality = "HighQuality"
  # Not ClearType: subpixel rendering lays coloured fringes along every stroke,
  # which read as blur once the text is baked into a bitmap on a dark ground.
  $g.TextRenderingHint = "AntiAliasGridFit"
}

# --- square, tightly cropped master ------------------------------------------
# The source is landscape with the mark off-centre and a lot of empty space.
# Everything downstream wants a square whose content fills it, so that is
# established once here rather than fudged at each size.
$src = New-Object System.Drawing.Bitmap([System.Drawing.Image]::FromFile($logoPath))
$minX = $src.Width; $maxX = 0; $minY = $src.Height; $maxY = 0
$data = $src.LockBits(
  (New-Object System.Drawing.Rectangle(0, 0, $src.Width, $src.Height)),
  [System.Drawing.Imaging.ImageLockMode]::ReadOnly,
  [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$stride = $src.Width * 4
$buf = New-Object byte[] ($stride * $src.Height)
[System.Runtime.InteropServices.Marshal]::Copy($data.Scan0, $buf, 0, $buf.Length)
$src.UnlockBits($data)
for ($y = 0; $y -lt $src.Height; $y++) {
  $row = $y * $stride
  for ($x = 0; $x -lt $src.Width; $x++) {
    # Anything with any opacity at all counts as content.
    if ($buf[$row + $x * 4 + 3] -gt 8) {
      if ($x -lt $minX) { $minX = $x }; if ($x -gt $maxX) { $maxX = $x }
      if ($y -lt $minY) { $minY = $y }; if ($y -gt $maxY) { $maxY = $y }
    }
  }
}
$w = $maxX - $minX + 1
$h = $maxY - $minY + 1
$side = [Math]::Max($w, $h)
$master = New-Object System.Drawing.Bitmap($side, $side, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$mg = [System.Drawing.Graphics]::FromImage($master)
Set-Quality $mg
$mg.DrawImage($src,
  (New-Object System.Drawing.Rectangle([int](($side - $w) / 2), [int](($side - $h) / 2), $w, $h)),
  (New-Object System.Drawing.Rectangle($minX, $minY, $w, $h)),
  [System.Drawing.GraphicsUnit]::Pixel)
$mg.Dispose()
$src.Dispose()
Write-Output ("cropped to content: {0}x{1} -> square {2}px" -f $w, $h, $side)

# Halving repeatedly before the final step: a single large downscale averages
# the fine detail away, which is what made earlier icons look soft.
function Get-Scaled([int]$size) {
  $current = New-Object System.Drawing.Bitmap($master)
  while ($current.Width -gt $size * 2) {
    $half = New-Object System.Drawing.Bitmap([int]($current.Width / 2), [int]($current.Height / 2),
      [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $hg = [System.Drawing.Graphics]::FromImage($half)
    Set-Quality $hg
    $hg.DrawImage($current, (New-Object System.Drawing.Rectangle(0, 0, $half.Width, $half.Height)))
    $hg.Dispose(); $current.Dispose(); $current = $half
  }
  $out = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $og = [System.Drawing.Graphics]::FromImage($out)
  Set-Quality $og
  $og.DrawImage($current, (New-Object System.Drawing.Rectangle(0, 0, $size, $size)))
  $og.Dispose(); $current.Dispose()
  return $out
}

function Draw-Logo($g, [int]$x, [int]$y, [int]$size) {
  $scaled = Get-Scaled $size
  $g.DrawImage($scaled, $x, $y)
  $scaled.Dispose()
}

# The installer uses its own portrait, high-resolution source. Keeping the
# source at 910x1698 and scaling only once into NSIS's fixed-size bitmaps avoids
# repeatedly enlarging/downscaling the small application icon.
$installerArt = [System.Drawing.Image]::FromFile($installerArtPath)
function Draw-Installer-Mark($g, [int]$x, [int]$y, [int]$size) {
  # Square crop around the generated mark; the lower half of the source is
  # intentionally empty to leave room for installer copy.
  $srcRect = New-Object System.Drawing.Rectangle(70, 205, 770, 770)
  $dstRect = New-Object System.Drawing.Rectangle($x, $y, $size, $size)
  $g.DrawImage($installerArt, $dstRect, $srcRect, [System.Drawing.GraphicsUnit]::Pixel)
}

# --- ICO -----------------------------------------------------------------------
# Bottom-up 32bpp DIBs at every size. PNG-compressed entries are legal and
# smaller, but only the modern shell reads them — GDI+ sees a corrupt file.
function Write-Ico([string]$path, [int[]]$sizes) {
  $entries = @()
  foreach ($size in $sizes) {
    $tile = Get-Scaled $size
    $rect = New-Object System.Drawing.Rectangle(0, 0, $size, $size)
    $d = $tile.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadOnly,
      [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $rowBytes = $size * 4
    $top = New-Object byte[] ($rowBytes * $size)
    [System.Runtime.InteropServices.Marshal]::Copy($d.Scan0, $top, 0, $top.Length)
    $tile.UnlockBits($d)

    $pixels = New-Object byte[] ($rowBytes * $size)
    for ($y = 0; $y -lt $size; $y++) {
      [Array]::Copy($top, ($size - 1 - $y) * $rowBytes, $pixels, $y * $rowBytes, $rowBytes)
    }
    $maskStride = [int](([Math]::Ceiling($size / 32.0)) * 4)
    $mask = New-Object byte[] ($maskStride * $size)

    $body = New-Object System.IO.MemoryStream
    $bw = New-Object System.IO.BinaryWriter($body)
    $bw.Write([uint32]40); $bw.Write([int32]$size); $bw.Write([int32]($size * 2))
    $bw.Write([uint16]1); $bw.Write([uint16]32); $bw.Write([uint32]0)
    $bw.Write([uint32]($pixels.Length + $mask.Length))
    $bw.Write([int32]0); $bw.Write([int32]0); $bw.Write([uint32]0); $bw.Write([uint32]0)
    $bw.Write($pixels); $bw.Write($mask); $bw.Flush()
    $entries += , @{ Size = $size; Data = $body.ToArray() }
    $bw.Dispose(); $body.Dispose(); $tile.Dispose()
  }
  $out = New-Object System.IO.MemoryStream
  $w2 = New-Object System.IO.BinaryWriter($out)
  $w2.Write([uint16]0); $w2.Write([uint16]1); $w2.Write([uint16]$entries.Count)
  $offset = 6 + 16 * $entries.Count
  foreach ($e in $entries) {
    $dim = if ($e.Size -ge 256) { 0 } else { $e.Size }
    $w2.Write([byte]$dim); $w2.Write([byte]$dim); $w2.Write([byte]0); $w2.Write([byte]0)
    $w2.Write([uint16]1); $w2.Write([uint16]32)
    $w2.Write([uint32]$e.Data.Length); $w2.Write([uint32]$offset)
    $offset += $e.Data.Length
  }
  foreach ($e in $entries) { $w2.Write($e.Data) }
  $w2.Flush()
  [System.IO.File]::WriteAllBytes($path, $out.ToArray())
  $w2.Dispose(); $out.Dispose()
}

# --- application + installer icons ---------------------------------------------
Write-Ico (Join-Path $iconsDir "icon.ico") @(16, 24, 32, 48, 64, 128, 256)
Copy-Item (Join-Path $iconsDir "icon.ico") (Join-Path $installerDir "installer.ico") -Force
foreach ($pair in @(@(32, "32x32.png"), @(64, "64x64.png"), @(128, "128x128.png"),
                    @(256, "128x128@2x.png"), @(512, "icon.png"))) {
  $b = Get-Scaled $pair[0]
  $b.Save((Join-Path $iconsDir $pair[1]), [System.Drawing.Imaging.ImageFormat]::Png)
  $b.Dispose()
}

# --- the copies the app and the website import ---------------------------------
$appLogo = Get-Scaled 512
$appLogo.Save((Join-Path $appAssets "clipath-logo.png"), [System.Drawing.Imaging.ImageFormat]::Png)
$appLogo.Dispose()
$siteLogo = Get-Scaled 256
$siteLogo.Save((Join-Path $siteAssets "clipath-logo.png"), [System.Drawing.Imaging.ImageFormat]::Png)
$siteLogo.Dispose()
Write-Ico (Join-Path $siteAssets "favicon.ico") @(16, 32, 48)
$og = Get-Scaled 180
$og.Save((Join-Path $siteAssets "app-icon.png"), [System.Drawing.Imaging.ImageFormat]::Png)
$og.Dispose()

# --- NSIS wizard art -----------------------------------------------------------
# NSIS will not read PNG: these must be uncompressed 24-bit BMPs at exactly
# 150x57 and 164x314, so they are rendered to size rather than exported by hand
# and silently rejected at install time.
function New-Canvas([int]$w, [int]$h, [string]$from, [string]$to, [float]$angle) {
  $bmp = New-Object System.Drawing.Bitmap($w, $h, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  Set-Quality $g
  $rect = New-Object System.Drawing.Rectangle(0, 0, $w, $h)
  $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush($rect,
    [System.Drawing.ColorTranslator]::FromHtml($from),
    [System.Drawing.ColorTranslator]::FromHtml($to), $angle)
  $g.FillRectangle($brush, $rect); $brush.Dispose()
  return @{ Bitmap = $bmp; Graphics = $g }
}

$white = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
$tagBrush = New-Object System.Drawing.SolidBrush([System.Drawing.ColorTranslator]::FromHtml("#9A9AB0"))

$h1 = New-Canvas 150 57 "#0A1020" "#12203C" 20
$g = $h1.Graphics
Draw-Installer-Mark $g 10 8 41
$font = New-Object System.Drawing.Font("Segoe UI Semibold", 13)
$g.DrawString("Clipath", $font, $white, 56, 16)
$h1.Bitmap.Save((Join-Path $installerDir "header.bmp"), [System.Drawing.Imaging.ImageFormat]::Bmp)
$g.Dispose(); $h1.Bitmap.Dispose()

$s1 = New-Object System.Drawing.Bitmap(164, 314, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
$g = [System.Drawing.Graphics]::FromImage($s1)
Set-Quality $g
$g.DrawImage($installerArt,
  (New-Object System.Drawing.Rectangle(0, 0, 164, 314)),
  (New-Object System.Drawing.Rectangle(12, 0, 886, 1698)),
  [System.Drawing.GraphicsUnit]::Pixel)
$title = New-Object System.Drawing.Font("Segoe UI Semibold", 17)
$sz = $g.MeasureString("Clipath", $title)
$g.DrawString("Clipath", $title, $white, (164 - $sz.Width) / 2, 196)
$tagFont = New-Object System.Drawing.Font("Segoe UI", 8)
$fmt = New-Object System.Drawing.StringFormat
$fmt.Alignment = [System.Drawing.StringAlignment]::Center
$g.DrawString("Every screenshot,`nready to paste", $tagFont, $tagBrush,
  (New-Object System.Drawing.RectangleF(10, 226, 144, 40)), $fmt)
$pen = New-Object System.Drawing.Pen([System.Drawing.ColorTranslator]::FromHtml("#2F80FF"), 2)
$g.DrawLine($pen, 62, 282, 102, 282); $pen.Dispose()
$s1.Save((Join-Path $installerDir "sidebar.bmp"), [System.Drawing.Imaging.ImageFormat]::Bmp)
$g.Dispose(); $s1.Dispose()

$d1 = New-Canvas 660 420 "#060B16" "#132444" 45
$g = $d1.Graphics
Draw-Installer-Mark $g 296 26 68
$dmgTitle = New-Object System.Drawing.Font("Segoe UI Semibold", 15)
$fmtC = New-Object System.Drawing.StringFormat
$fmtC.Alignment = [System.Drawing.StringAlignment]::Center
$g.DrawString("Clipath", $dmgTitle, $white, (New-Object System.Drawing.RectangleF(0, 100, 660, 30)), $fmtC)
$dmgTag = New-Object System.Drawing.Font("Segoe UI", 9.5)
$g.DrawString("Drag Clipath into Applications to install", $dmgTag, $tagBrush,
  (New-Object System.Drawing.RectangleF(0, 130, 660, 24)), $fmtC)
$arrowPen = New-Object System.Drawing.Pen([System.Drawing.ColorTranslator]::FromHtml("#2F80FF"), 3)
$arrowPen.EndCap = [System.Drawing.Drawing2D.LineCap]::ArrowAnchor
$g.DrawLine($arrowPen, 268, 210, 392, 210); $arrowPen.Dispose()
$d1.Bitmap.Save((Join-Path $installerDir "dmg-background.png"), [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $d1.Bitmap.Dispose()

$master.Dispose()
$installerArt.Dispose()
Write-Output "regenerated app icon, tray icon, in-app logo, site logo and favicon, and the installer art"
