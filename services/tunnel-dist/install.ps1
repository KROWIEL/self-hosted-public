# Installs the public-side reverse-tunnel server on a Windows VDS as a
# scheduled task (console binaries are not native services). Run as Administrator.
#
# Usage:
#   .\install.ps1 -Token xxxx -BinUrl https://panel.example/api/tunnels/bin/windows-amd64
#
param(
  [Parameter(Mandatory = $true)][string]$Token,
  [string]$Control = ':7000',
  [string]$Ports = '443',
  [string]$BinUrl = '',
  [string]$InstallDir = "$env:ProgramFiles\selfhosted-tunnel"
)
$ErrorActionPreference = 'Stop'

if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'Run this script as Administrator (needs privileged ports + task install).'
}

New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
$bin = Join-Path $InstallDir 'tunnel-server.exe'

if ($BinUrl) {
  Write-Host ">> downloading $BinUrl"
  Invoke-WebRequest -Uri $BinUrl -OutFile $bin
}
elseif (Test-Path '.\tunnel-server.exe') {
  Copy-Item '.\tunnel-server.exe' $bin -Force
}
else {
  throw 'Set -BinUrl or place .\tunnel-server.exe next to this script.'
}

$taskName = 'selfhosted-tunnel'
$args = "--token $Token --control $Control --ports $Ports"
$action = New-ScheduledTaskAction -Execute $bin -Argument $args
$trigger = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -StartWhenAvailable

Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings | Out-Null
Start-ScheduledTask -TaskName $taskName
Write-Host ">> installed and started scheduled task '$taskName'."
