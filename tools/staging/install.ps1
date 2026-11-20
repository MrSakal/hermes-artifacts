<#
.SYNOPSIS
  Installs one exact commit of the hermes-artifacts plugin into the staging Hermes home, then restarts the
  staging gateway (and the staging Desktop, if it was running, so it copies the new Desktop half).
.PARAMETER Sha
  Full 40-character commit SHA. It must be pushed to GitHub unless -Local is given.
.PARAMETER Local
  Install from this local checkout (file:// URL) instead of GitHub, so an unpushed commit works too.
.EXAMPLE
  .\install.ps1 -Sha (git rev-parse origin/my-branch)
#>
param(
    [Parameter(Mandatory = $true)][string]$Sha,
    [string]$Repo = 'MrSakal/hermes-artifacts',
    [string]$Subdir = 'plugin',
    [switch]$Local,
    [int]$CdpPort = 0
)

. (Join-Path $PSScriptRoot '_common.ps1')
Assert-StagingIsolated

$Sha = $Sha.Trim().ToLowerInvariant()
if ($Sha -notmatch '^[0-9a-f]{40}$') { throw "-Sha must be a full 40-character commit SHA, got '$Sha'" }

if ($Local) {
    $repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
    $identifier = 'file:///' + ($repoRoot -replace '\\', '/') + "#$Subdir"
} else {
    $identifier = "$Repo/$Subdir"
}
# Never the bare catalog name: the catalog entry `hermes-artifacts` is pinned to an old release.
if ($identifier -notmatch '[/#]') { throw "Refusing a bare catalog name ($identifier); install from the repo." }

# The Desktop copies a plugin's Desktop half when it loads plugins, so a running staging window is restarted.
$desktopWasRunning = (Get-StagingDesktopProcesses).Count -gt 0
if ($desktopWasRunning) {
    if ($CdpPort -eq 0) {
        $f = Join-Path $StagingRun 'cdp-port.txt'
        $CdpPort = if (Test-Path $f) { [int](Get-Content $f -Raw).Trim() } else { $DefaultCdpPort }
    }
    & (Join-Path $PSScriptRoot 'stop.ps1') -DesktopOnly
}

Write-Host "[staging] installing $identifier @ $Sha into $StagingHome ..."
$r = Invoke-StagingHermes -HermesArgs @('plugins', 'install', $identifier, '--ref', $Sha, '--force', '--enable', '--yes-deps') -TimeoutSec 900
Write-Host $r.Out
if ($r.Code -ne 0) {
    Write-Host $r.Err
    throw "plugin install failed with exit code $($r.Code)"
}

$manifest = Join-Path $StagingHome 'plugins\hermes-artifacts\plugin.yaml'
if (-not (Test-Path $manifest)) { throw "Installed, but $manifest is missing" }
$version = ((Select-String -Path $manifest -Pattern '^version:\s*(\S+)').Matches[0].Groups[1].Value)
Set-Content -Path (Join-Path $StagingRun 'installed.txt') -Encoding ascii -Value @(
    "sha=$Sha", "version=$version", "source=$identifier", "installed=$(Get-Date -Format o)")
Write-Host "[staging] installed hermes-artifacts $version ($Sha)"

# Restart the staging backend so the gateway runs the new plugin code (start.ps1 below starts it again).
$old = Stop-StagingGateway
if ($old) { Write-Host "[staging] stopped the staging gateway (pid $old)" }

if ($desktopWasRunning) {
    & (Join-Path $PSScriptRoot 'start.ps1') -CdpPort $CdpPort
} else {
    & (Join-Path $PSScriptRoot 'start.ps1') -BackendOnly
    Write-Host '[staging] Desktop not started; run start.ps1 to open the staging window.'
}

# Both halves must be exactly this commit; throws loudly otherwise.
& (Join-Path $PSScriptRoot 'verify.ps1') -Sha $Sha -CdpPort $CdpPort
