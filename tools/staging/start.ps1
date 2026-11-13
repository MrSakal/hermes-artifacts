<#
.SYNOPSIS
  Starts the staging backend (a Hermes gateway on the staging HERMES_HOME) and a staging Hermes Desktop
  window with a Chrome DevTools Protocol port, beside the user's own Desktop.
.PARAMETER CdpPort
  Loopback remote-debugging port of the staging Desktop (default 9333).
.PARAMETER BackendOnly
  Start only the staging gateway, no Desktop window.
#>
param([int]$CdpPort = 9333, [switch]$BackendOnly)

. (Join-Path $PSScriptRoot '_common.ps1')
Assert-StagingIsolated

# 1. Backend: the staging home's own gateway (started detached; it outlives this script and the Desktop).
Write-Host "[staging] ensuring the staging gateway (HERMES_HOME=$StagingHome) ..."
$r = Invoke-StagingHermes -HermesArgs @('gateway', 'ensure', '--json', '--timeout', '150') -TimeoutSec 300
$verdict = $null
try { $verdict = ($r.Out.Trim() -split "`n" | Select-Object -Last 1) | ConvertFrom-Json } catch { }
if ($r.Code -ne 0) {
    Write-Host $r.Out
    Write-Host $r.Err
    throw "gateway ensure failed with exit code $($r.Code)"
}
$apiOrigin = if ($verdict -and $verdict.endpoint) { $verdict.endpoint.api_origin } elseif ($verdict) { $verdict.api_origin } else { '?' }
Write-Host "[staging] gateway ready: pid $(Get-StagingGatewayPid), API $apiOrigin"
if ($BackendOnly) { return }

# 2. Desktop: the installed Hermes.exe, with its own user data (own single-instance lock), the staging home,
#    the shared code checkout pinned so it never bootstraps or repairs, and a loopback CDP port.
$running = Get-StagingDesktopProcesses
if ($running.Count -gt 0) {
    Write-Host "[staging] a staging Desktop is already running (pids $($running.ProcessId -join ', ')); run stop.ps1 first to restart it."
    return
}
$busy = Get-NetTCPConnection -State Listen -LocalPort $CdpPort -ErrorAction SilentlyContinue
if ($busy) { throw "Port $CdpPort is already in use (pid $($busy[0].OwningProcess)); pass -CdpPort <free port>." }
if (-not (Test-Path $DesktopExe)) { throw "Hermes Desktop not found at $DesktopExe" }

$saved = Use-StagingEnv -Extra @{
    HERMES_DESKTOP_USER_DATA_DIR = $StagingUserData
    HERMES_DESKTOP_HERMES_ROOT = $Checkout
    HERMES_DESKTOP_HERMES = $HermesLauncher
    HERMES_DESKTOP_ISOLATED_BACKEND = '1'
    HERMES_DESKTOP_SKIP_PROTOCOL_REGISTRATION = '1'
    HERMES_DESKTOP_SKIP_QUIT_CONFIRM = '1'
    HERMES_DESKTOP_APP_NAME = $StagingAppName
    HERMES_DESKTOP_REMOTE_URL = ''
    HERMES_DESKTOP_REMOTE_TOKEN = ''
}
try {
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $p = Start-Process -FilePath $DesktopExe -PassThru `
        -ArgumentList @("--user-data-dir=`"$StagingUserData`"", "--remote-debugging-port=$CdpPort", '--remote-debugging-address=127.0.0.1') `
        -RedirectStandardOutput (Join-Path $StagingLogs "desktop-$stamp.out.txt") `
        -RedirectStandardError (Join-Path $StagingLogs "desktop-$stamp.err.txt")
} finally {
    Restore-Env $saved
}
Set-Content -Path (Join-Path $StagingRun 'cdp-port.txt') -Value $CdpPort -Encoding ascii

Write-Host "[staging] Desktop started (pid $($p.Id)); waiting for the debugging port ..."
$version = $null
for ($i = 0; $i -lt 60 -and -not $version; $i++) {
    Start-Sleep -Seconds 1
    try { $version = Invoke-RestMethod -Uri "http://127.0.0.1:$CdpPort/json/version" -TimeoutSec 2 } catch { }
}
if (-not $version) { throw "The staging Desktop did not open port $CdpPort within 60 s; see $StagingLogs\desktop-$stamp.err.txt" }
$pages = @(Invoke-RestMethod -Uri "http://127.0.0.1:$CdpPort/json/list" -TimeoutSec 5 | Where-Object { $_.type -eq 'page' })

Write-Host ''
Write-Host "[staging] READY"
Write-Host "  CDP:        http://127.0.0.1:$CdpPort  ($($version.Browser))"
foreach ($pg in $pages) { Write-Host "  page:       $($pg.title)  $($pg.url)" }
Write-Host "  Tell it apart: it looks like the normal window (the packaged build keeps its own name), but only it"
Write-Host "  answers on port $CdpPort, its session list is the staging one, and its command line carries"
Write-Host "  --user-data-dir=$StagingUserData."
Write-Host "  Logs:       $StagingLogs"
