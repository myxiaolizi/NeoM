Add-Type -AssemblyName System.Windows.Forms, System.Drawing
$ErrorActionPreference = 'Stop'

# Capture the primary screen while NeoM is running, so the packaged renderer can
# be verified visually (not just by process liveness).
$outPath = $args[0]
if (-not $outPath) { $outPath = "$env:TEMP\neom-shot.png" }

Remove-Item Env:\ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
Remove-Item Env:\NODE_EXTRA_CA_CERTS -ErrorAction SilentlyContinue

$exe = 'C:\data\DSH\NeoM\release\win-x64\win-unpacked\NeoM.exe'
$ud = Join-Path $env:TEMP 'neom-shot-ud'
Remove-Item $ud -Recurse -Force -ErrorAction SilentlyContinue
$p = Start-Process -FilePath $exe -ArgumentList "--user-data-dir=$ud" -PassThru
Start-Sleep -Seconds 9

# Bring the window to the foreground.
$sig = @'
using System;
using System.Runtime.InteropServices;
public class Win32 {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
}
'@
if (-not ('Win32' -as [type])) { Add-Type -TypeDefinition $sig }

$wp = Get-Process NeoM -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if ($wp) {
  [Win32]::ShowWindow($wp.MainWindowHandle, 9) | Out-Null   # SW_RESTORE
  [Win32]::SetForegroundWindow($wp.MainWindowHandle) | Out-Null
  Start-Sleep -Seconds 2

  $rect = New-Object Win32+RECT
  [Win32]::GetWindowRect($wp.MainWindowHandle, [ref]$rect) | Out-Null
  $w = $rect.Right - $rect.Left
  $h = $rect.Bottom - $rect.Top
  Write-Output "window: $w x $h at ($($rect.Left),$($rect.Top))"

  $bmp = New-Object System.Drawing.Bitmap($w, $h)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.CopyFromScreen($rect.Left, $rect.Top, 0, 0, $bmp.Size)
  $bmp.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
  Write-Output "saved: $outPath"
} else {
  Write-Output "no window handle found for NeoM"
  $all = Get-Process NeoM -ErrorAction SilentlyContinue
  Write-Output "NeoM processes: $($all.Count)"
}

Get-Process NeoM -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Milliseconds 500
