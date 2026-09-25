# Installs the packaged launcher for the current Windows user. Nothing outside your profile is touched, no admin needed.
#   npm run package
#   npm run install-app
param([string]$Source = (Join-Path $PSScriptRoot '..\dist\Claude Multi Launcher-win32-x64'))

$ErrorActionPreference = 'Stop'
$name = 'Claude Multi Launcher'
$dest = Join-Path $env:LOCALAPPDATA "Programs\$name"
$exe  = Join-Path $dest "$name.exe"
$link = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\$name.lnk"

if (-not (Test-Path -LiteralPath $Source)) { throw "Nothing to install at $Source. Run 'npm run package' first." }

# Close a running installed copy so its files can be replaced. Only this launcher; never Claude itself.
Get-Process -Name $name -ErrorAction SilentlyContinue |
  Where-Object { $_.Path -and $_.Path.StartsWith($dest, [System.StringComparison]::OrdinalIgnoreCase) } |
  Stop-Process -Force
Start-Sleep -Seconds 1

New-Item -ItemType Directory -Force -Path $dest | Out-Null
robocopy $Source $dest /MIR /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { throw "Copy failed (robocopy exit code $LASTEXITCODE)." }

$sc = (New-Object -ComObject WScript.Shell).CreateShortcut($link)
$sc.TargetPath = $exe
$sc.WorkingDirectory = $dest
$sc.Description = $name
$sc.Save()

Write-Host "Installed to $dest"
Write-Host "Start Menu shortcut: $link"
Write-Host "Turn on 'Start with Windows' inside the app if you want it at sign-in."
