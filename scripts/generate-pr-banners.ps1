# Generates the Pull Request comment banner images used by sfdx-hardis.
# One image per comment type and status, so a reader identifies a comment while scrolling a Pull Request:
# the left icon and the background color say what the comment is, the right icon says how it went.
# Windows only (uses System.Drawing). Run from the repository root:
#   powershell -ExecutionPolicy Bypass -File scripts/generate-pr-banners.ps1
# Output: docs/assets/images/pr-banner-*.png
Add-Type -AssemblyName System.Drawing

$OutDir = Join-Path (Split-Path $PSScriptRoot -Parent) 'docs/assets/images'
if (-not (Test-Path $OutDir)) { throw "Images folder not found: $OutDir" }

# Official Cloudity logo (transparent PNG), drawn in white on the dark part of the banners
$logo = New-Object System.Drawing.Bitmap (Join-Path $OutDir 'cloudity-logo-text.png')

$W = 1200
$H = 160

function New-Color([string]$hex) {
  return [System.Drawing.ColorTranslator]::FromHtml($hex)
}

function New-RoundPen($color, [single]$width) {
  $pen = New-Object System.Drawing.Pen $color, $width
  $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $pen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
  return $pen
}

function New-Point([double]$x, [double]$y) {
  return New-Object System.Drawing.PointF([single]$x, [single]$y)
}

# --- Status glyphs (drawn inside the status badge) ---

function Draw-Check($g, $pen, [double]$cx, [double]$cy, [double]$r) {
  $g.DrawLines($pen, @(
      (New-Point ($cx - 0.46 * $r) $cy),
      (New-Point ($cx - 0.13 * $r) ($cy + 0.33 * $r)),
      (New-Point ($cx + 0.48 * $r) ($cy - 0.35 * $r))
    ))
}

function Draw-Cross($g, $pen, [double]$cx, [double]$cy, [double]$r) {
  $g.DrawLine($pen, ($cx - 0.37 * $r), ($cy - 0.37 * $r), ($cx + 0.37 * $r), ($cy + 0.37 * $r))
  $g.DrawLine($pen, ($cx + 0.37 * $r), ($cy - 0.37 * $r), ($cx - 0.37 * $r), ($cy + 0.37 * $r))
}

function Draw-Clock($g, $pen, $thinPen, [double]$cx, [double]$cy, [double]$r) {
  $g.DrawEllipse($pen, ($cx - 0.5 * $r), ($cy - 0.5 * $r), $r, $r)
  $g.DrawLine($thinPen, $cx, ($cy - 0.29 * $r), $cx, $cy)
  $g.DrawLine($thinPen, $cx, $cy, ($cx + 0.29 * $r), $cy)
}

# --- Comment type glyphs (drawn inside the white circle on the left) ---

# Validation: a magnifying glass, the deployment is only inspected, not released
function Draw-Magnifier($g, $pen, [double]$cx, [double]$cy, [double]$r) {
  $lensR = 0.40 * $r
  $lx = $cx - 0.09 * $r
  $ly = $cy - 0.11 * $r
  $g.DrawEllipse($pen, ($lx - $lensR), ($ly - $lensR), (2 * $lensR), (2 * $lensR))
  $g.DrawLine($pen, ($lx + 0.75 * $lensR), ($ly + 0.75 * $lensR), ($cx + 0.52 * $r), ($cy + 0.55 * $r))
}

# Deployment: an upload arrow, the metadata is pushed to the org
function Draw-Upload($g, $pen, [double]$cx, [double]$cy, [double]$r) {
  $g.DrawLine($pen, $cx, ($cy - 0.48 * $r), $cx, ($cy + 0.16 * $r))
  $g.DrawLines($pen, @(
      (New-Point ($cx - 0.32 * $r) ($cy - 0.16 * $r)),
      (New-Point $cx ($cy - 0.50 * $r)),
      (New-Point ($cx + 0.32 * $r) ($cy - 0.16 * $r))
    ))
  $g.DrawLine($pen, ($cx - 0.46 * $r), ($cy + 0.50 * $r), ($cx + 0.46 * $r), ($cy + 0.50 * $r))
}

# Deployment actions: a checklist, one line per action to run around the deployment
function Draw-Checklist($g, $pen, [double]$cx, [double]$cy, [double]$r) {
  foreach ($i in 0..2) {
    $y = $cy + ($i - 1) * 0.40 * $r
    $g.DrawLines($pen, @(
        (New-Point ($cx - 0.56 * $r) $y),
        (New-Point ($cx - 0.44 * $r) ($y + 0.13 * $r)),
        (New-Point ($cx - 0.22 * $r) ($y - 0.15 * $r))
      ))
    $g.DrawLine($pen, ($cx + 0.02 * $r), $y, ($cx + 0.56 * $r), $y)
  }
}

# Comment type: background gradient, main label and icon.
# Validation (checkOnly deployment) and Deployment must not look alike: different word, different hue.
$Types = @{
  'validation' = @{ label = 'VALIDATION'; from = '#4A044E'; to = '#C026D3'; glyph = 'magnifier' }
  'deployment' = @{ label = 'DEPLOYMENT'; from = '#0A2472'; to = '#1D4ED8'; glyph = 'upload' }
  'actions'    = @{ label = 'DEPLOYMENT ACTIONS'; from = '#0B1020'; to = '#3A4358'; glyph = 'checklist' }
}

# Status: left bar, badge color and glyph
$Statuses = @{
  'success' = @{ color = '#22C55E'; glyph = 'check' }
  'failure' = @{ color = '#EF4444'; glyph = 'cross' }
  'pending' = @{ color = '#F59E0B'; glyph = 'clock' }
}

$Variants = @(
  @{ file = 'pr-banner-validation-success.png'; type = 'validation'; status = 'success'; text = 'Deployment simulation successful' }
  @{ file = 'pr-banner-validation-failure.png'; type = 'validation'; status = 'failure'; text = 'Deployment simulation failed' }
  @{ file = 'pr-banner-validation-pending.png'; type = 'validation'; status = 'pending'; text = 'Deployment simulation in progress' }
  @{ file = 'pr-banner-deployment-success.png'; type = 'deployment'; status = 'success'; text = 'Deployment successful' }
  @{ file = 'pr-banner-deployment-failure.png'; type = 'deployment'; status = 'failure'; text = 'Deployment failed' }
  @{ file = 'pr-banner-deployment-pending.png'; type = 'deployment'; status = 'pending'; text = 'Deployment in progress' }
  @{ file = 'pr-banner-actions-completed.png'; type = 'actions'; status = 'success'; text = 'All actions completed' }
  @{ file = 'pr-banner-actions-pending.png'; type = 'actions'; status = 'pending'; text = 'Manual actions pending' }
  @{ file = 'pr-banner-actions-error.png'; type = 'actions'; status = 'failure'; text = 'Actions in error' }
)

foreach ($v in $Variants) {
  $type = $Types[$v.type]
  $status = $Statuses[$v.status]
  $statusColor = New-Color $status.color
  $typeDark = New-Color $type.from
  $dark = [System.Drawing.Color]::FromArgb(255, 5, 6, 12)

  $bmp = New-Object System.Drawing.Bitmap($W, $H)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic

  # Background gradient, diagonal like the Cloudity banner
  $rect = New-Object System.Drawing.Rectangle(0, 0, $W, $H)
  $grad = New-Object System.Drawing.Drawing2D.LinearGradientBrush($rect, $typeDark, (New-Color $type.to), 15.0)
  $g.FillRectangle($grad, $rect)

  # Black circle on the right, echoing the Cloudity brand shapes
  $black = New-Object System.Drawing.SolidBrush $dark
  $g.FillEllipse($black, ($W - 260), (-95), 430, 430)

  # Status bar on the left edge
  $barBrush = New-Object System.Drawing.SolidBrush $statusColor
  $g.FillRectangle($barBrush, 0, 0, 14, $H)

  $white = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::White)
  $faded = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(190, 255, 255, 255))
  $fontLabel = New-Object System.Drawing.Font('Segoe UI', 42, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
  $fontStatus = New-Object System.Drawing.Font('Segoe UI', 27, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
  $fontProduct = New-Object System.Drawing.Font('Segoe UI', 21, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
  $fontSmall = New-Object System.Drawing.Font('Segoe UI', 16, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)

  # Comment type icon: white disc on the left, glyph in the background color
  $typeCx = 96
  $typeCy = $H / 2
  $typeR = 46
  $g.FillEllipse($white, ($typeCx - $typeR), ($typeCy - $typeR), (2 * $typeR), (2 * $typeR))
  $typePen = New-RoundPen $typeDark 7
  if ($type.glyph -eq 'magnifier') { Draw-Magnifier $g $typePen $typeCx $typeCy $typeR }
  elseif ($type.glyph -eq 'upload') { Draw-Upload $g $typePen $typeCx $typeCy $typeR }
  else { Draw-Checklist $g $typePen $typeCx $typeCy $typeR }
  $typePen.Dispose()

  # Texts
  $g.DrawString($type.label, $fontLabel, $white, 176, 26)
  $g.DrawString($v.text, $fontStatus, $barBrush, 178, 82)

  # Status icon, right before the black shape
  $statusCx = 862
  $statusCy = $H / 2
  $statusR = 42
  $g.FillEllipse($barBrush, ($statusCx - $statusR), ($statusCy - $statusR), (2 * $statusR), (2 * $statusR))
  $statusPen = New-RoundPen $dark 8
  $statusThinPen = New-RoundPen $dark 6.5
  if ($status.glyph -eq 'check') { Draw-Check $g $statusPen $statusCx $statusCy $statusR }
  elseif ($status.glyph -eq 'cross') { Draw-Cross $g $statusPen $statusCx $statusCy $statusR }
  else { Draw-Clock $g $statusPen $statusThinPen $statusCx $statusCy $statusR }
  $statusPen.Dispose()
  $statusThinPen.Dispose()

  # "sfdx-hardis by <official Cloudity logo>", stacked on the black shape.
  # The logo is recolored white by a color matrix that keeps its transparency.
  $blockCenterX = $W - 134
  $logoWidth = 140
  $logoHeight = [int]($logoWidth * $logo.Height / $logo.Width)
  $productSize = $g.MeasureString('sfdx-hardis', $fontProduct)
  $g.DrawString('sfdx-hardis', $fontProduct, $white, ($blockCenterX - $productSize.Width / 2), 42)
  # "by" sits on the same line as the logo, both centered as one group
  $bySize = $g.MeasureString('by', $fontSmall)
  $byGap = 6
  $groupWidth = $bySize.Width + $byGap + $logoWidth
  $logoTop = 80
  $g.DrawString('by', $fontSmall, $faded, ($blockCenterX - $groupWidth / 2), ($logoTop + ($logoHeight - $bySize.Height) / 2))
  $logoCenterX = $blockCenterX - $groupWidth / 2 + $bySize.Width + $byGap + $logoWidth / 2
  $toWhite = New-Object System.Drawing.Imaging.ColorMatrix
  $toWhite.Matrix00 = 0; $toWhite.Matrix11 = 0; $toWhite.Matrix22 = 0
  $toWhite.Matrix40 = 1; $toWhite.Matrix41 = 1; $toWhite.Matrix42 = 1
  $imgAttr = New-Object System.Drawing.Imaging.ImageAttributes
  $imgAttr.SetColorMatrix($toWhite)
  $logoRect = New-Object System.Drawing.Rectangle([int]($logoCenterX - $logoWidth / 2), $logoTop, $logoWidth, $logoHeight)
  $g.DrawImage($logo, $logoRect, 0, 0, $logo.Width, $logo.Height, [System.Drawing.GraphicsUnit]::Pixel, $imgAttr)
  $imgAttr.Dispose()

  $path = Join-Path $OutDir $v.file
  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose()
  $bmp.Dispose()
  Write-Output "Generated $path"
}

$logo.Dispose()
