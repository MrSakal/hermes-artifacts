# Shared paths and helpers for the staging scripts. Dot-sourced; changes nothing by itself.
# Staging = a separate HERMES_HOME + a separate Hermes Desktop user-data dir, on the same Hermes code checkout.

$ErrorActionPreference = 'Stop'

$StagingRoot = if ($env:HERMES_STAGING_ROOT) { $env:HERMES_STAGING_ROOT } else { 'C:\Sajat\hermes-staging' }
$StagingHome = Join-Path $StagingRoot 'home'
$StagingUserData = Join-Path $StagingRoot 'userdata'
$StagingLogs = Join-Path $StagingRoot 'logs'
$StagingRun = Join-Path $StagingRoot 'run'

$LiveRoot = Join-Path $env:LOCALAPPDATA 'hermes'
$Checkout = Join-Path $LiveRoot 'hermes-agent'
$VenvPython = Join-Path $Checkout 'venv\Scripts\python.exe'
$DesktopExe = Join-Path $Checkout 'apps\desktop\release\win-unpacked\Hermes.exe'
$HermesLauncher = Join-Path $LiveRoot 'bin\hermes.exe'

$DefaultCdpPort = 9333
$StagingAppName = 'Hermes STAGING'

function Assert-StagingIsolated {
    # Refuse to run if the staging home could be the live home (or inside it).
    $live = [IO.Path]::GetFullPath($LiveRoot).TrimEnd('\').ToLowerInvariant()
    foreach ($p in @($StagingRoot, $StagingHome, $StagingUserData)) {
        $full = [IO.Path]::GetFullPath($p).TrimEnd('\').ToLowerInvariant()
        if ($full -eq $live -or $full.StartsWith($live + '\')) {
            throw "Staging path $p is inside the live Hermes home $LiveRoot. Refusing."
        }
    }
    foreach ($p in @($StagingHome, $StagingUserData, $StagingLogs, $StagingRun)) {
        if (-not (Test-Path $p)) { New-Item -ItemType Directory -Force $p | Out-Null }
    }
}

function Use-StagingEnv {
    # Sets the staging environment in this process and returns the previous values, for Restore-Env.
    param([hashtable]$Extra = @{})
    $vars = @{
        HERMES_HOME = $StagingHome
        HERMES_PROBE_TIMEOUT_MS = '90000'
    }
    foreach ($k in $Extra.Keys) { $vars[$k] = $Extra[$k] }
    $saved = @{}
    foreach ($k in $vars.Keys) {
        $saved[$k] = [Environment]::GetEnvironmentVariable($k, 'Process')
        [Environment]::SetEnvironmentVariable($k, [string]$vars[$k], 'Process')
    }
    return $saved
}

function Restore-Env {
    param([hashtable]$Saved)
    foreach ($k in $Saved.Keys) { [Environment]::SetEnvironmentVariable($k, $Saved[$k], 'Process') }
}

function Invoke-StagingHermes {
    # Runs `hermes <args>` against the staging home only. Returns @{Code; Out; Err}.
    param([string[]]$HermesArgs, [int]$TimeoutSec = 600)
    Assert-StagingIsolated
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
    $out = Join-Path $StagingLogs "cli-$stamp.out.txt"
    $err = Join-Path $StagingLogs "cli-$stamp.err.txt"
    $empty = Join-Path $StagingRun 'empty-stdin.txt'
    if (-not (Test-Path $empty)) { Set-Content -Path $empty -Value '' -Encoding ascii }
    $saved = Use-StagingEnv
    try {
        $argList = @('-m', 'hermes_cli.main') + $HermesArgs | ForEach-Object { if ($_ -match '\s') { '"' + $_ + '"' } else { $_ } }
        $p = Start-Process -FilePath $VenvPython -ArgumentList $argList -WorkingDirectory $Checkout `
            -RedirectStandardOutput $out -RedirectStandardError $err -RedirectStandardInput $empty `
            -NoNewWindow -PassThru
        $null = $p.Handle  # PowerShell 5.1: without a cached handle ExitCode reads as null after exit
        if (-not $p.WaitForExit($TimeoutSec * 1000)) {
            & taskkill.exe /T /F /PID $p.Id | Out-Null
            throw "hermes $($HermesArgs -join ' ') timed out after $TimeoutSec s (log: $err)"
        }
        $p.WaitForExit()
        return @{ Code = $p.ExitCode; Out = (Get-Content $out -Raw -ErrorAction SilentlyContinue); Err = (Get-Content $err -Raw -ErrorAction SilentlyContinue) }
    } finally {
        Restore-Env $saved
    }
}

function Get-StagingGatewayPid {
    # The staging gateway's PID from the staging home's own pid file, only if that process is alive.
    $pidFile = Join-Path $StagingHome 'gateway.pid'
    if (-not (Test-Path $pidFile)) { return $null }
    try { $info = Get-Content $pidFile -Raw | ConvertFrom-Json } catch { return $null }
    if (-not $info.pid -or -not $info.hermes_home) { return $null }
    # The pid file must name the staging home itself; the staging and live gateways have identical argv.
    $named = [IO.Path]::GetFullPath([string]$info.hermes_home).TrimEnd('\')
    if ($named -ne [IO.Path]::GetFullPath($StagingHome).TrimEnd('\')) { return $null }
    $id = [int]$info.pid
    $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$id" -ErrorAction SilentlyContinue
    if (-not $proc -or $proc.CommandLine -notmatch 'gateway') { return $null }
    $live = Get-LiveGatewayPid
    if ($live -and $id -eq $live) { throw "Staging gateway.pid names the live gateway ($id). Refusing." }
    return $id
}

function Stop-StagingGateway {
    # Ends the staging gateway by its own pid file (verified above) and its child processes.
    # Deliberately not `hermes gateway stop`/`restart`: both select gateways by process scan, and the
    # staging and live gateways share one command line.
    $id = Get-StagingGatewayPid
    if (-not $id) { return $null }
    & taskkill.exe /T /F /PID $id 2>$null | Out-Null
    for ($i = 0; $i -lt 10 -and (Get-Process -Id $id -ErrorAction SilentlyContinue); $i++) { Start-Sleep -Milliseconds 500 }
    return $id
}

function Get-LiveGatewayPid {
    $pidFile = Join-Path $LiveRoot 'gateway.pid'
    if (-not (Test-Path $pidFile)) { return $null }
    $raw = (Get-Content $pidFile -Raw).Trim()
    if ($raw -match '^\d+$') { return [int]$raw }
    if ($raw -match '"pid"\s*:\s*(\d+)') { return [int]$Matches[1] }
    return $null
}

function Get-StagingDesktopProcesses {
    # Every Hermes.exe whose command line names the staging user-data dir. start.ps1 passes
    # --user-data-dir=<staging> to the main process and Chromium passes it on to every child,
    # so the user's own Desktop (user data in %APPDATA%\Hermes) never matches.
    $ud = [regex]::Escape($StagingUserData)
    return @(Get-CimInstance Win32_Process -Filter "Name='Hermes.exe'" | Where-Object { $_.CommandLine -match $ud })
}
