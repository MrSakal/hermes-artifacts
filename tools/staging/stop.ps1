<#
.SYNOPSIS
  Stops only staging processes: the staging Desktop (matched by its staging --user-data-dir) and the staging
  gateway (from the staging home's own gateway.pid). Never touches the user's Desktop or the live gateway.
.PARAMETER DesktopOnly
  Stop the staging Desktop, leave the staging gateway running.
#>
param([switch]$DesktopOnly)

. (Join-Path $PSScriptRoot '_common.ps1')
Assert-StagingIsolated

# 1. Desktop: ask the main process to close, then end whatever staging Hermes.exe is left.
$desk = Get-StagingDesktopProcesses
if ($desk.Count -gt 0) {
    $ids = @($desk.ProcessId)
    $mains = @($desk | Where-Object { $ids -notcontains $_.ParentProcessId })
    foreach ($m in $mains) {
        $gp = Get-Process -Id $m.ProcessId -ErrorAction SilentlyContinue
        if ($gp -and $gp.MainWindowHandle -ne 0) { [void]$gp.CloseMainWindow() }
    }
    for ($i = 0; $i -lt 10 -and (Get-StagingDesktopProcesses).Count -gt 0; $i++) { Start-Sleep -Seconds 1 }
    foreach ($left in (Get-StagingDesktopProcesses)) {
        & taskkill.exe /T /F /PID $left.ProcessId 2>$null | Out-Null
    }
    Write-Host "[staging] Desktop stopped (was pids $($ids -join ', '))"
} else {
    Write-Host '[staging] no staging Desktop running'
}
if ($DesktopOnly) { return }

# 2. Gateway: by the staging home's own gateway.pid (see Stop-StagingGateway for why not the CLI).
$gw = Stop-StagingGateway
if ($gw) {
    Write-Host "[staging] gateway stopped (was pid $gw)"
} else {
    Write-Host '[staging] no staging gateway running'
}

# 3. Leftovers: anything whose command line names the staging root.
$rootRx = [regex]::Escape($StagingRoot)
$left = @(Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match $rootRx -and $_.ProcessId -ne $PID })
if ($left.Count -gt 0) {
    Write-Host '[staging] still running with the staging root on their command line:'
    $left | ForEach-Object { Write-Host "  $($_.ProcessId) $($_.Name)" }
} else {
    Write-Host '[staging] no staging process left'
}
