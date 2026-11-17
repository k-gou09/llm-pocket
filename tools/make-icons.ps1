# Genere les icones PWA (192, 512, maskable 512) avec System.Drawing.
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$outDir = Join-Path $root 'icons'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

function New-RoundedPath([float]$x, [float]$y, [float]$w, [float]$h, [float]$r) {
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = $r * 2
  $path.AddArc($x, $y, $d, $d, 180, 90)
  $path.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
  $path.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
  $path.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
  $path.CloseFigure()
  return $path
}

function New-Icon([int]$size, [string]$file, [bool]$maskable) {
  $bmp = New-Object System.Drawing.Bitmap($size, $size)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.Clear([System.Drawing.Color]::Transparent)
  $s = $size / 1024.0

  if ($maskable) {
    $g.SetClip((New-Object System.Drawing.RectangleF(0, 0, $size, $size)))
  } else {
    $g.SetClip((New-RoundedPath 0 0 $size $size ($size * 0.22)))
  }

  # Fond degrade
  $rect = New-Object System.Drawing.RectangleF(0, 0, $size, $size)
  $bg = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    $rect,
    [System.Drawing.ColorTranslator]::FromHtml('#0b1016'),
    [System.Drawing.ColorTranslator]::FromHtml('#17222e'),
    90.0
  )
  $g.FillRectangle($bg, $rect)

  # Halo derriere la tete
  $glow = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(30, 110, 231, 183))
  $g.FillEllipse($glow, 172 * $s, 210 * $s, 680 * $s, 560 * $s)

  # Corps / tete
  $headFill = New-Object System.Drawing.SolidBrush([System.Drawing.ColorTranslator]::FromHtml('#23303e'))
  $outline = New-Object System.Drawing.Pen([System.Drawing.ColorTranslator]::FromHtml('#3a4d63'), (14 * $s))
  $headPath = New-RoundedPath (212 * $s) (268 * $s) (600 * $s) (472 * $s) (150 * $s)
  $g.FillPath($headFill, $headPath)
  $g.DrawPath($outline, $headPath)

  # Visiere
  $visorFill = New-Object System.Drawing.SolidBrush([System.Drawing.ColorTranslator]::FromHtml('#0a1118'))
  $visorPath = New-RoundedPath (292 * $s) (344 * $s) (440 * $s) (300 * $s) (104 * $s)
  $g.FillPath($visorFill, $visorPath)

  # Antenne
  $antennaPen = New-Object System.Drawing.Pen([System.Drawing.ColorTranslator]::FromHtml('#3a4d63'), (18 * $s))
  $antennaPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $antennaPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $g.DrawLine($antennaPen, 512 * $s, 268 * $s, 512 * $s, 168 * $s)

  $mint = [System.Drawing.ColorTranslator]::FromHtml('#6ee7b7')
  $mintGlow = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(45, 110, 231, 183))
  $mintBrush = New-Object System.Drawing.SolidBrush($mint)
  $g.FillEllipse($mintGlow, (512 * $s) - (54 * $s), (148 * $s) - (54 * $s), (108 * $s), (108 * $s))
  $g.FillEllipse($mintBrush, (512 * $s) - (30 * $s), (148 * $s) - (30 * $s), (60 * $s), (60 * $s))

  # Yeux + halo
  foreach ($cx in @(428, 596)) {
    $g.FillEllipse($mintGlow, ($cx * $s) - (56 * $s), (478 * $s) - (56 * $s), (112 * $s), (112 * $s))
    $g.FillEllipse($mintBrush, ($cx * $s) - (34 * $s), (478 * $s) - (34 * $s), (68 * $s), (68 * $s))
  }

  # Bouche
  $mouthPath = New-RoundedPath (466 * $s) (556 * $s) (92 * $s) (22 * $s) (11 * $s)
  $g.FillPath($mintBrush, $mouthPath)

  $g.Dispose()
  $bmp.Save($file, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  Write-Host "OK $file"
}

New-Icon 192 (Join-Path $outDir 'icon-192.png') $false
New-Icon 512 (Join-Path $outDir 'icon-512.png') $false
New-Icon 512 (Join-Path $outDir 'icon-maskable-512.png') $true
