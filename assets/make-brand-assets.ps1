# Regenerates every derived logo in the project from one source file.
#
#   assets/images/logo.png  ->  app icon, tray icon, installer art, in-app logo,
#                               website logo and favicon, store/mobile icons
#
# Run it after changing the source; nothing else needs editing by hand.
#
# The source mark is white on transparency. That reads well on the app's dark
# surfaces and on the site, but on its own it disappears into File Explorer,
# a light-mode taskbar or any pale background — so everything that is an *icon*
# gets the mark on a brand-blue tile, and only the places whose background is
# known to be dark use the bare mark.

Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$logoPath = Join-Path $root "assets\images\logo.png"
$installerDir = Join-Path $root "src-tauri\installer"
$iconsDir = Join-Path $root "src-tauri\icons"
$appAssets = Join-Path $root "src\assets"
$siteAssets = Join-Path $root "docs\assets"
foreach ($d in @($installerDir, $iconsDir, $appAssets, $siteAssets)) {
  if (-not (Test-Path $d)) { New-Item -ItemType Directory -Path $d | Out-Null }
}

$brand = [System.Drawing.ColorTranslator]::FromHtml("#0A84FF")

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
# The source has the mark off-centre with a lot of empty space. Everything
# downstream wants a square whose content fills it, so that is established once
# here rather than fudged at each size.
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

# The mark inset inside its tile. Below about a fifth the mark crowds the
# corners; much above it and the mark is too small to read at 16px.
$MARK_RATIO = 0.62

function New-RoundedPath([int]$size, [float]$radius) {
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = $radius * 2
  $path.AddArc(0, 0, $d, $d, 180, 90)
  $path.AddArc($size - $d, 0, $d, $d, 270, 90)
  $path.AddArc($size - $d, $size - $d, $d, $d, 0, 90)
  $path.AddArc(0, $size - $d, $d, $d, 90, 90)
  $path.CloseFigure()
  return $path
}

# The mark centred on a brand-blue tile. `-Square` fills the whole bitmap with
# no rounding and no transparency, which is what iOS and apple-touch-icon want:
# both mask the corners themselves and neither accepts an alpha channel.
function Get-Tile([int]$size, [switch]$Square) {
  $tile = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($tile)
  Set-Quality $g
  $fill = New-Object System.Drawing.SolidBrush($brand)
  if ($Square) {
    $g.FillRectangle($fill, (New-Object System.Drawing.Rectangle(0, 0, $size, $size)))
  } else {
    $path = New-RoundedPath $size ([float]($size * 0.22))
    $g.FillPath($fill, $path)
    $path.Dispose()
  }
  $fill.Dispose()
  $mark = Get-Scaled ([int][Math]::Round($size * $MARK_RATIO))
  $g.DrawImage($mark, [int](($size - $mark.Width) / 2), [int](($size - $mark.Height) / 2))
  $mark.Dispose()
  $g.Dispose()
  return $tile
}

# --- ICO ---------------------------------------------------------------------
# Bottom-up 32bpp DIBs at every size. PNG-compressed entries are legal and
# smaller, but only the modern shell reads them — GDI+ sees a corrupt file.
function Write-Ico([string]$path, [int[]]$sizes) {
  $entries = @()
  foreach ($size in $sizes) {
    $tile = Get-Tile $size
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
    $dim = 0
    if ($e.Size -lt 256) { $dim = $e.Size }
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

# --- ICNS --------------------------------------------------------------------
# A flat list of PNGs behind four-character type codes, all lengths big-endian.
# macOS has read PNG-bodied entries since 10.7, so no raw bitmap packing here.
function Write-Icns([string]$path) {
  $types = @(@("ic11", 32), @("ic12", 64), @("ic07", 128), @("ic13", 256),
             @("ic08", 256), @("ic14", 512), @("ic09", 512), @("ic10", 1024))
  $chunks = @()
  foreach ($t in $types) {
    $tile = Get-Tile $t[1]
    $ms = New-Object System.IO.MemoryStream
    $tile.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    $tile.Dispose()
    $chunks += , @{ Type = $t[0]; Data = $ms.ToArray() }
    $ms.Dispose()
  }
  $total = 8
  foreach ($c in $chunks) { $total += 8 + $c.Data.Length }
  $out = New-Object System.IO.MemoryStream
  $bw = New-Object System.IO.BinaryWriter($out)
  function Write-BE($writer, [uint32]$value) {
    $bytes = [System.BitConverter]::GetBytes($value)
    [Array]::Reverse($bytes)
    $writer.Write($bytes)
  }
  $bw.Write([System.Text.Encoding]::ASCII.GetBytes("icns"))
  Write-BE $bw ([uint32]$total)
  foreach ($c in $chunks) {
    $bw.Write([System.Text.Encoding]::ASCII.GetBytes($c.Type))
    Write-BE $bw ([uint32]($c.Data.Length + 8))
    $bw.Write($c.Data)
  }
  $bw.Flush()
  [System.IO.File]::WriteAllBytes($path, $out.ToArray())
  $bw.Dispose(); $out.Dispose()
}

function Save-Tile([string]$path, [int]$size, [switch]$Square) {
  $b = Get-Tile $size -Square:$Square
  $b.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $b.Dispose()
}

# --- application + installer icons -------------------------------------------
Write-Ico (Join-Path $iconsDir "icon.ico") @(16, 24, 32, 48, 64, 128, 256)
Copy-Item (Join-Path $iconsDir "icon.ico") (Join-Path $installerDir "installer.ico") -Force
Write-Icns (Join-Path $iconsDir "icon.icns")
foreach ($pair in @(@(32, "32x32.png"), @(64, "64x64.png"), @(128, "128x128.png"),
                    @(256, "128x128@2x.png"), @(512, "icon.png"))) {
  Save-Tile (Join-Path $iconsDir $pair[1]) $pair[0]
}

# --- Windows Store tiles ------------------------------------------------------
foreach ($pair in @(@(30, "Square30x30Logo.png"), @(44, "Square44x44Logo.png"),
                    @(71, "Square71x71Logo.png"), @(89, "Square89x89Logo.png"),
                    @(107, "Square107x107Logo.png"), @(142, "Square142x142Logo.png"),
                    @(150, "Square150x150Logo.png"), @(284, "Square284x284Logo.png"),
                    @(310, "Square310x310Logo.png"), @(50, "StoreLogo.png"))) {
  Save-Tile (Join-Path $iconsDir $pair[1]) $pair[0]
}

# --- mobile -------------------------------------------------------------------
# Android's adaptive icon draws the foreground over a colour it takes from
# resources, so the foreground layer is the bare mark and the tile colour moves
# into the XML. Everything else is the finished tile.
$android = Join-Path $iconsDir "android"
foreach ($pair in @(@("mdpi", 48, 108), @("hdpi", 49, 162), @("xhdpi", 96, 216),
                    @("xxhdpi", 144, 324), @("xxxhdpi", 192, 432))) {
  $dir = Join-Path $android ("mipmap-" + $pair[0])
  if (-not (Test-Path $dir)) { continue }
  Save-Tile (Join-Path $dir "ic_launcher.png") $pair[1]
  Save-Tile (Join-Path $dir "ic_launcher_round.png") $pair[1]
  # The foreground sits inside a safe zone: Android crops it to whatever shape
  # the launcher uses, and anything past the middle two-thirds can be cut off.
  $fg = New-Object System.Drawing.Bitmap($pair[2], $pair[2], [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($fg)
  Set-Quality $g
  $inner = Get-Scaled ([int][Math]::Round($pair[2] * 0.42))
  $g.DrawImage($inner, [int](($pair[2] - $inner.Width) / 2), [int](($pair[2] - $inner.Height) / 2))
  $inner.Dispose(); $g.Dispose()
  $fg.Save((Join-Path $dir "ic_launcher_foreground.png"), [System.Drawing.Imaging.ImageFormat]::Png)
  $fg.Dispose()
}
$bgXml = Join-Path $android "values\ic_launcher_background.xml"
if (Test-Path $bgXml) {
  $xml = @'
<?xml version="1.0" encoding="utf-8"?>
<resources>
  <color name="ic_launcher_background">#0A84FF</color>
</resources>
'@
  # Written without a BOM: the Android resource parser treats one as content.
  [System.IO.File]::WriteAllText($bgXml, $xml, (New-Object System.Text.UTF8Encoding($false)))
}

# iOS icons must be opaque squares — an alpha channel is rejected at submission
# and the system rounds the corners itself.
$ios = Join-Path $iconsDir "ios"
if (Test-Path $ios) {
  foreach ($f in Get-ChildItem (Join-Path $ios "*.png")) {
    $img = [System.Drawing.Image]::FromFile($f.FullName)
    $size = $img.Width
    $img.Dispose()
    Save-Tile $f.FullName $size -Square
  }
}

# --- the copies the app and the website import -------------------------------
# Bare mark, no tile: both surfaces are dark by construction, and the app
# inverts it in light mode (see `.app-logo` in styles.css).
$appLogo = Get-Scaled 512
$appLogo.Save((Join-Path $appAssets "logo.png"), [System.Drawing.Imaging.ImageFormat]::Png)
$appLogo.Dispose()
$siteLogo = Get-Scaled 256
$siteLogo.Save((Join-Path $siteAssets "logo.png"), [System.Drawing.Imaging.ImageFormat]::Png)
$siteLogo.Dispose()
Write-Ico (Join-Path $siteAssets "favicon.ico") @(16, 32, 48)
Save-Tile (Join-Path $siteAssets "app-icon.png") 180 -Square

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

function Draw-Mark($g, [int]$x, [int]$y, [int]$size) {
  $tile = Get-Tile $size
  $g.DrawImage($tile, $x, $y)
  $tile.Dispose()
}

$white = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
$tagBrush = New-Object System.Drawing.SolidBrush([System.Drawing.ColorTranslator]::FromHtml("#9A9AB0"))

$h1 = New-Canvas 150 57 "#0A1020" "#12203C" 20
$g = $h1.Graphics
Draw-Mark $g 10 8 41
$font = New-Object System.Drawing.Font("Segoe UI Semibold", 13)
$g.DrawString("Clipath", $font, $white, 56, 16)
$h1.Bitmap.Save((Join-Path $installerDir "header.bmp"), [System.Drawing.Imaging.ImageFormat]::Bmp)
$g.Dispose(); $h1.Bitmap.Dispose()

$s1 = New-Canvas 164 314 "#060B16" "#132444" 60
$g = $s1.Graphics
Draw-Mark $g 40 74 84
$title = New-Object System.Drawing.Font("Segoe UI Semibold", 17)
$sz = $g.MeasureString("Clipath", $title)
$g.DrawString("Clipath", $title, $white, (164 - $sz.Width) / 2, 196)
$tagFont = New-Object System.Drawing.Font("Segoe UI", 8)
$fmt = New-Object System.Drawing.StringFormat
$fmt.Alignment = [System.Drawing.StringAlignment]::Center
$g.DrawString("Every screenshot,`nready to paste", $tagFont, $tagBrush,
  (New-Object System.Drawing.RectangleF(10, 226, 144, 40)), $fmt)
$pen = New-Object System.Drawing.Pen($brand, 2)
$g.DrawLine($pen, 62, 282, 102, 282); $pen.Dispose()
$s1.Bitmap.Save((Join-Path $installerDir "sidebar.bmp"), [System.Drawing.Imaging.ImageFormat]::Bmp)
$g.Dispose(); $s1.Bitmap.Dispose()

$d1 = New-Canvas 660 420 "#060B16" "#132444" 45
$g = $d1.Graphics
Draw-Mark $g 296 26 68
$dmgTitle = New-Object System.Drawing.Font("Segoe UI Semibold", 15)
$fmtC = New-Object System.Drawing.StringFormat
$fmtC.Alignment = [System.Drawing.StringAlignment]::Center
$g.DrawString("Clipath", $dmgTitle, $white, (New-Object System.Drawing.RectangleF(0, 100, 660, 30)), $fmtC)
$dmgTag = New-Object System.Drawing.Font("Segoe UI", 9.5)
$g.DrawString("Drag Clipath into Applications to install", $dmgTag, $tagBrush,
  (New-Object System.Drawing.RectangleF(0, 130, 660, 24)), $fmtC)
$arrowPen = New-Object System.Drawing.Pen($brand, 3)
$arrowPen.EndCap = [System.Drawing.Drawing2D.LineCap]::ArrowAnchor
$g.DrawLine($arrowPen, 268, 210, 392, 210); $arrowPen.Dispose()
$d1.Bitmap.Save((Join-Path $installerDir "dmg-background.png"), [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $d1.Bitmap.Dispose()

$master.Dispose()
Write-Output "regenerated app icon, tray icon, store and mobile icons, in-app logo, site logo and favicon, and the installer art"
