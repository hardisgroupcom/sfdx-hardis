<#
.SYNOPSIS
Opens a workbook in Excel and saves a PNG of its grid, as Excel draws it.

.DESCRIPTION
Meant to run on a desktop nobody looks at: start it through
vscode-sfdx-hardis/scripts/hidden-desktop/run-on-hidden-desktop.ps1, and Excel, its child, opens
there too. Nothing here touches a window it did not start: the window is found by the process
id of the Excel this script started, never by its title, no key is sent, nothing is activated.

- /x makes Excel start a process of its own: without it, an Excel already open on the desktop of
  the person working would receive the file.
- A dialog Excel opens on that desktop (recovered files, first start...) is closed with
  WM_CLOSE, like the close button of its title bar would.
- The image keeps the column letters, the row numbers and the cells, and leaves out the title
  bar, the ribbon, the formula bar and the status bar: they are in the display language of Office,
  and the documentation is in English whatever language Office is set to.

.PARAMETER Workbook
The .xlsx file to open.

.PARAMETER Output
The PNG to write.

.PARAMETER Width
Window width in pixels (default 1600).

.PARAMETER Height
Window height in pixels (default 1000).

.PARAMETER Full
Keep the whole window, without cropping it.
#>
param(
  [Parameter(Mandatory = $true)] [string] $Workbook,
  [Parameter(Mandatory = $true)] [string] $Output,
  [int] $Width = 1600,
  [int] $Height = 1000,
  [int] $TimeoutSeconds = 90,
  [switch] $Full,
  # On failure, save an image of every window found on the desktop next to the output
  [switch] $DebugImages
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

Add-Type -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public static class ExcelWindow
{
    private delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int Left, Top, Right, Bottom; }

    [DllImport("user32.dll")]
    private static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetClassName(IntPtr hWnd, StringBuilder name, int maxCount);

    [DllImport("user32.dll")]
    private static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);

    [DllImport("user32.dll")]
    public static extern bool SetWindowPos(IntPtr hWnd, IntPtr after, int x, int y, int cx, int cy, uint flags);

    [DllImport("user32.dll")]
    public static extern bool PrintWindow(IntPtr hWnd, IntPtr hdc, uint flags);

    [DllImport("user32.dll")]
    public static extern bool PostMessage(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr hWnd, int cmdShow);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int maxCount);

    // "class: title" of every visible top-level window of one process, to say what blocks Excel
    public static List<string> Describe(uint processId)
    {
        List<string> found = new List<string>();
        foreach (IntPtr hWnd in Find(processId, null))
        {
            StringBuilder name = new StringBuilder(256);
            GetClassName(hWnd, name, name.Capacity);
            StringBuilder text = new StringBuilder(512);
            GetWindowText(hWnd, text, text.Capacity);
            found.Add(name.ToString() + ": " + text.ToString());
        }
        return found;
    }

    public static uint ProcessOf(IntPtr hWnd)
    {
        uint owner;
        GetWindowThreadProcessId(hWnd, out owner);
        return owner;
    }

    public static string TitleOf(IntPtr hWnd)
    {
        StringBuilder text = new StringBuilder(512);
        GetWindowText(hWnd, text, text.Capacity);
        return text.ToString();
    }

    // Visible top-level windows of one process with the given class ("XLMAIN" for Excel)
    public static List<IntPtr> Find(uint processId, string className)
    {
        List<IntPtr> found = new List<IntPtr>();
        EnumWindows(delegate (IntPtr hWnd, IntPtr lParam)
        {
            uint owner;
            GetWindowThreadProcessId(hWnd, out owner);
            // processId 0: any process. This script runs on a desktop of its own, where every
            // window belongs to a process it started, so "any" is still only ours
            if ((processId == 0 || owner == processId) && IsWindowVisible(hWnd))
            {
                StringBuilder name = new StringBuilder(256);
                GetClassName(hWnd, name, name.Capacity);
                if (string.IsNullOrEmpty(className) || name.ToString() == className)
                {
                    found.Add(hWnd);
                }
            }
            return true;
        }, IntPtr.Zero);
        return found;
    }
}
"@

function Find-ExcelExe {
  $candidates = @(
    "$env:ProgramFiles\Microsoft Office\root\Office16\EXCEL.EXE",
    "${env:ProgramFiles(x86)}\Microsoft Office\root\Office16\EXCEL.EXE",
    "$env:ProgramFiles\Microsoft Office\Office16\EXCEL.EXE"
  )
  foreach ($candidate in $candidates) {
    if ($candidate -and (Test-Path $candidate)) {
      return $candidate
    }
  }
  throw "Excel not found"
}

function Get-WindowImage {
  param([IntPtr] $Handle)
  $rect = New-Object ExcelWindow+RECT
  [void][ExcelWindow]::GetWindowRect($Handle, [ref]$rect)
  $w = $rect.Right - $rect.Left
  $h = $rect.Bottom - $rect.Top
  $bitmap = New-Object System.Drawing.Bitmap $w, $h
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $hdc = $graphics.GetHdc()
  # 2 = PW_RENDERFULLCONTENT: asks the window to draw itself, DirectX content included
  $ok = [ExcelWindow]::PrintWindow($Handle, $hdc, 2)
  $graphics.ReleaseHdc($hdc)
  $graphics.Dispose()
  if (-not $ok) {
    $bitmap.Dispose()
    throw "PrintWindow failed"
  }
  return $bitmap
}

function Get-ImageHash {
  param([System.Drawing.Bitmap] $Bitmap)
  $stream = New-Object System.IO.MemoryStream
  $Bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
  $hash = [Convert]::ToBase64String([System.Security.Cryptography.SHA1]::Create().ComputeHash($stream.ToArray()))
  $stream.Dispose()
  return $hash
}

# Share of near-black pixels: a window that did not draw comes back black
function Get-DarkRatio {
  param([System.Drawing.Bitmap] $Bitmap)
  $dark = 0
  $total = 0
  for ($x = 0; $x -lt $Bitmap.Width; $x += 37) {
    for ($y = 0; $y -lt $Bitmap.Height; $y += 37) {
      $pixel = $Bitmap.GetPixel($x, $y)
      if (($pixel.R + $pixel.G + $pixel.B) -lt 30) {
        $dark++
      }
      $total++
    }
  }
  return $dark / [Math]::Max($total, 1)
}

function Test-Grey {
  param($Pixel, [int] $Value, [int] $Tolerance = 4)
  return ([Math]::Abs($Pixel.R - $Value) -le $Tolerance) -and ([Math]::Abs($Pixel.G - $Value) -le $Tolerance) -and ([Math]::Abs($Pixel.B - $Value) -le $Tolerance)
}

<#
Where the grid starts and ends, read in the column of the row numbers (x = 20):
- the row numbers are grey cells (240) separated by lines (231), one row about 24 px high;
- the band of column letters, above, is a grey cell closed by a darker line (198).
The crop keeps from the top border of that band to the last line between two row numbers.
#>
function Get-GridCrop {
  param([System.Drawing.Bitmap] $Bitmap)
  $x = 20
  $headerBottom = -1
  for ($y = 120; $y -lt $Bitmap.Height - 1; $y++) {
    if ((Test-Grey $Bitmap.GetPixel($x, $y) 198 6) -and (Test-Grey $Bitmap.GetPixel($x, $y - 5) 240)) {
      $headerBottom = $y
      break
    }
  }
  if ($headerBottom -lt 0) {
    throw "Grid not found in the Excel window (no column letters band)"
  }
  # Up through the band of column letters (240) to its top border
  $y = $headerBottom - 1
  while ($y -gt 0 -and (Test-Grey $Bitmap.GetPixel($x, $y) 240)) { $y-- }
  $bandTop = $y
  # Down to the last line between two row numbers
  $lastSeparator = -1
  for ($y = $headerBottom + 1; $y -lt $Bitmap.Height; $y++) {
    if (Test-Grey $Bitmap.GetPixel($x, $y) 231 3) {
      $lastSeparator = $y
    }
    elseif (-not (Test-Grey $Bitmap.GetPixel($x, $y) 240 45) -and ($y - [Math]::Max($lastSeparator, $headerBottom)) -gt 30) {
      break
    }
  }
  if ($lastSeparator -lt 0) {
    throw "Grid not found in the Excel window (no row numbers)"
  }
  return @{ Top = $bandTop; Bottom = $lastSeparator + 1 }
}

$workbookPath = (Resolve-Path $Workbook).Path
$excel = Find-ExcelExe
$process = Start-Process -FilePath $excel -ArgumentList @("/x", "`"$workbookPath`"") -PassThru
Write-Output "[excel-shot] started Excel pid $($process.Id)"
$workbookName = [System.IO.Path]::GetFileNameWithoutExtension($workbookPath)
# The Excel processes whose windows were seen on this desktop: all started by this script
$seenProcesses = New-Object System.Collections.Generic.HashSet[uint32]
[void]$seenProcesses.Add([uint32]$process.Id)
try {
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  $previous = $null
  $bitmap = $null
  $crop = $null
  $handle = [IntPtr]::Zero
  $sized = @{}
  $lastError = "no Excel window"
  # The Excel started here may hand the file to another Excel process, and shows a first window
  # with no workbook: wait for the window whose title names the workbook, then for its grid to
  # be drawn, and for two captures in a row to agree
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 1500
    $handle = [IntPtr]::Zero
    foreach ($dialogClass in @("NUIDialog", "#32770")) {
      foreach ($dialog in [ExcelWindow]::Find(0, $dialogClass)) {
        Write-Output "[excel-shot] closing a dialog of Excel: $([ExcelWindow]::TitleOf($dialog))"
        # 0x0010 = WM_CLOSE
        [void][ExcelWindow]::PostMessage($dialog, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)
      }
    }
    foreach ($window in [ExcelWindow]::Find(0, "XLMAIN")) {
      [void]$seenProcesses.Add([ExcelWindow]::ProcessOf($window))
      if ([ExcelWindow]::TitleOf($window) -like "*$workbookName*") {
        $handle = $window
      }
    }
    if ($handle -eq [IntPtr]::Zero) {
      $lastError = "no Excel window with $workbookName in its title"
      continue
    }
    if (-not $sized.ContainsKey([string]$handle)) {
      # 1 = SW_SHOWNORMAL (not maximized, so the size below applies); 0x0014 = SWP_NOZORDER | SWP_NOACTIVATE
      [void][ExcelWindow]::ShowWindow($handle, 1)
      [void][ExcelWindow]::SetWindowPos($handle, [IntPtr]::Zero, 0, 0, $Width, $Height, 0x0014)
      $sized[[string]$handle] = $true
      continue
    }
    if ($bitmap) { $bitmap.Dispose() }
    $bitmap = Get-WindowImage -Handle $handle
    if ((Get-DarkRatio -Bitmap $bitmap) -ge 0.5) {
      $lastError = "The capture is mostly black: Excel did not draw its window"
      continue
    }
    if ($Full) {
      $crop = @{ Top = 0; Bottom = $bitmap.Height }
    }
    else {
      try {
        $crop = Get-GridCrop -Bitmap $bitmap
      }
      catch {
        $lastError = $_.Exception.Message
        $crop = $null
        continue
      }
    }
    $hash = Get-ImageHash -Bitmap $bitmap
    if ($hash -eq $previous) {
      break
    }
    $previous = $hash
    $crop = $null
  }
  if ($null -eq $crop) {
    $windowsList = ([ExcelWindow]::Describe(0)) -join " | "
    if ($DebugImages) {
      $index = 0
      foreach ($window in [ExcelWindow]::Find(0, $null)) {
        $debugImage = Get-WindowImage -Handle $window
        $debugImage.Save("$Output.debug-$index.png", [System.Drawing.Imaging.ImageFormat]::Png)
        $debugImage.Dispose()
        $index++
      }
    }
    throw "Excel never showed the workbook: $lastError (windows on this desktop: $windowsList)"
  }
  $outputDir = Split-Path -Parent $Output
  if ($outputDir -and -not (Test-Path $outputDir)) {
    New-Item -ItemType Directory -Force $outputDir | Out-Null
  }
  $area = New-Object System.Drawing.Rectangle 0, $crop.Top, $bitmap.Width, ($crop.Bottom - $crop.Top)
  $cropped = $bitmap.Clone($area, $bitmap.PixelFormat)
  $cropped.Save($Output, [System.Drawing.Imaging.ImageFormat]::Png)
  $cropped.Dispose()
  $bitmap.Dispose()
  Write-Output "[excel-shot] saved $Output"
}
finally {
  # Close without saving: WM_CLOSE to every Excel window of this desktop, then stop the Excel
  # processes this script saw there, by their process id
  foreach ($window in [ExcelWindow]::Find(0, "XLMAIN")) {
    [void]$seenProcesses.Add([ExcelWindow]::ProcessOf($window))
    # 0x0010 = WM_CLOSE
    [void][ExcelWindow]::PostMessage($window, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)
  }
  foreach ($processId in $seenProcesses) {
    $excelProcess = Get-Process -Id $processId -ErrorAction SilentlyContinue
    if ($excelProcess -and $excelProcess.ProcessName -eq "EXCEL") {
      if (-not $excelProcess.WaitForExit(8000)) {
        Stop-Process -Id $processId -Force
      }
    }
  }
}
