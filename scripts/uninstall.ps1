# Removes the installed launcher. Your accounts' data (%APPDATA%\Claude Multi Launcher) is kept unless you delete it.
$ErrorActionPreference = 'Stop'
$name = 'Claude Multi Launcher'
$dest = Join-Path $env:LOCALAPPDATA "Programs\$name"
$link = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\$name.lnk"

Get-Process -Name $name -ErrorAction SilentlyContinue |
  Where-Object { $_.Path -and $_.Path.StartsWith($dest, [System.StringComparison]::OrdinalIgnoreCase) } |
  Stop-Process -Force
Start-Sleep -Seconds 1

# Remove a "Start with Windows" entry only if it points at the installed copy.
$run = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$props = (Get-ItemProperty -Path $run).PSObject.Properties | Where-Object { $_.Value -is [string] -and $_.Value -like "*$dest*" }
foreach ($p in $props) { Remove-ItemProperty -Path $run -Name $p.Name; Write-Host "Removed startup entry: $($p.Name)" }

if (Test-Path -LiteralPath $link) { Remove-Item -LiteralPath $link }
if (Test-Path -LiteralPath $dest) { Remove-Item -LiteralPath $dest -Recurse -Force }
Write-Host 'Uninstalled. Account data was left in place.'
