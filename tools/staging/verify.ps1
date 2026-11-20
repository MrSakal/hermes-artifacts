<#
.SYNOPSIS
  Checks that staging runs exactly commit -Sha of hermes-artifacts, on both halves. Throws on any mismatch.
    1. the installed package is pinned to -Sha (install metadata);
    2. the installed plugin.yaml version equals that commit's plugin/plugin.yaml;
    3. the staging Desktop half (home\desktop-plugins\hermes-artifacts) is byte-identical to that commit's
       plugin/desktop files; if it is missing or stale it is re-published with Hermes' own reconcile,
       into the STAGING folder only;
    4. the running staging gateway loaded that version (its plugin-data load record);
    5. if the staging window is open: the Desktop half it loaded carries that commit's PLUGIN_VERSION
       and its page replaced the built-in Artifacts page.
#>
param([Parameter(Mandatory = $true)][string]$Sha, [int]$CdpPort = 0)

. (Join-Path $PSScriptRoot '_common.ps1')
Assert-StagingIsolated
$Sha = $Sha.Trim().ToLowerInvariant()
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$pkg = Join-Path $StagingHome 'plugins\hermes-artifacts'
$half = Join-Path $StagingHome 'desktop-plugins\hermes-artifacts'
$fail = @()
function G { $ErrorActionPreference = 'Continue'; & git -C $repo @args 2>$null }
function Ok($m) { Write-Host "  OK    $m" }
function Bad($m) { Write-Host "  FAIL  $m"; $script:fail += $m }

# The commit itself, from this checkout (fetched if it is not here yet).
G cat-file -e "$Sha^{commit}"
if ($LASTEXITCODE -ne 0) { G fetch --quiet origin; G cat-file -e "$Sha^{commit}" }
if ($LASTEXITCODE -ne 0) { throw "Commit $Sha is not in $repo even after git fetch origin" }
$yamlAtSha = (G show "${Sha}:plugin/plugin.yaml") -join "`n"
$expected = if ($yamlAtSha -match '(?m)^version:\s*(\S+)') { $Matches[1] } else { throw "No version in ${Sha}:plugin/plugin.yaml" }
$jsAtSha = (G show "${Sha}:plugin/desktop/plugin.js") -join "`n"
$expectedJs = if ($jsAtSha -match "const PLUGIN_VERSION = '([^']+)'") { $Matches[1] } else { throw "No PLUGIN_VERSION in ${Sha}:plugin/desktop/plugin.js" }
Write-Host "[verify] commit $Sha : plugin.yaml $expected, desktop PLUGIN_VERSION $expectedJs"
if ($expectedJs -ne $expected) { Bad "the commit itself disagrees: plugin.yaml $expected vs PLUGIN_VERSION $expectedJs" }

# 1-2. Agent half on disk.
$meta = Get-Content (Join-Path $StagingHome 'plugins\.install-metadata.json') -Raw | ConvertFrom-Json
$rev = $meta.'hermes-artifacts'.revision
if ($rev -eq $Sha) { Ok "installed revision $rev ($($meta.'hermes-artifacts'.source))" } else { Bad "installed revision is $rev, not $Sha" }
if ($meta.'hermes-artifacts'.catalog) { Bad 'installed from the Hermes catalog entry (pinned to an old release), not from the repo' }
$installed = if ((Get-Content (Join-Path $pkg 'plugin.yaml') -Raw) -match '(?m)^version:\s*(\S+)') { $Matches[1] } else { '?' }
if ($installed -eq $expected) { Ok "installed plugin.yaml $installed" } else { Bad "installed plugin.yaml is $installed, commit has $expected" }

# 3. Desktop half: every file of the commit's plugin/desktop must be in the staging half, byte-identical.
function Test-Half {
    $bad = @()
    $files = @(G ls-tree -r --name-only $Sha -- plugin/desktop)
    foreach ($f in $files) {
        $rel = $f.Substring('plugin/desktop/'.Length)
        $p = Join-Path $half ($rel -replace '/', '\')
        if (-not (Test-Path $p)) { $bad += "$rel missing"; continue }
        $want = (G rev-parse "${Sha}:$f").Trim()
        $have = (G hash-object --path=$f -- $p).Trim()
        if ($want -ne $have) { $bad += "$rel differs" }
    }
    return ,$bad
}
$diff = Test-Half
if ($diff.Count -gt 0) {
    Write-Host "[verify] staging Desktop half is stale ($($diff -join '; ')); re-publishing it with Hermes' reconcile ..."
    $full = [IO.Path]::GetFullPath($half)
    if (-not $full.StartsWith([IO.Path]::GetFullPath($StagingHome) + '\')) { throw "Refusing: $full is outside the staging home" }
    # Reconcile re-copies only when the SOURCE is newer than its marker, so a damaged copy is removed first
    # (staging folder only; guarded above).
    if (Test-Path $half) { Remove-Item -Recurse -Force $half }
    $saved = Use-StagingEnv
    try {
        Push-Location $Checkout
        & $VenvPython -c "import sys; from pathlib import Path; from hermes_cli.desktop_plugin_halves import reconcile_desktop_halves_report as r; print(r(Path(sys.argv[1]), Path(sys.argv[2])))" $StagingHome (Join-Path $StagingHome 'desktop-plugins')
    } finally { Pop-Location; Restore-Env $saved }
    $diff = Test-Half
}
if ($diff.Count -eq 0) { Ok "Desktop half in $half matches the commit" } else { Bad "Desktop half still differs: $($diff -join '; ')" }
$halfJs = Get-Content (Join-Path $half 'plugin.js') -Raw -ErrorAction SilentlyContinue
$halfVer = if ($halfJs -match "const PLUGIN_VERSION = '([^']+)'") { $Matches[1] } else { '?' }
if ($halfVer -eq $expected) { Ok "Desktop half file PLUGIN_VERSION $halfVer" } else { Bad "Desktop half file PLUGIN_VERSION is $halfVer" }

# 4. What the running gateway loaded.
$gw = Get-StagingGatewayPid
if ($gw) {
    $rec = Join-Path $StagingHome "plugin-data\hermes-artifacts\.run\loaded-$gw.json"
    $loaded = if (Test-Path $rec) { (Get-Content $rec -Raw | ConvertFrom-Json).version } else { $null }
    if ($loaded -eq $expected) { Ok "gateway pid $gw loaded $loaded" } else { Bad "gateway pid $gw loaded '$loaded', expected $expected" }
} else {
    Write-Host '  SKIP  no staging gateway running'
}

# 5. What the staging window loaded.
if ((Get-StagingDesktopProcesses).Count -gt 0) {
    if ($CdpPort -eq 0) { $f = Join-Path $StagingRun 'cdp-port.txt'; $CdpPort = if (Test-Path $f) { [int](Get-Content $f -Raw).Trim() } else { $DefaultCdpPort } }
    $node = Get-ChildItem (Join-Path $LiveRoot 'tools') -Directory -Filter 'node-*' | Sort-Object Name -Descending |
        ForEach-Object { Join-Path $_.FullName 'node.exe' } | Where-Object { Test-Path $_ } | Select-Object -First 1
    if (-not $node) { $node = (Get-Command node -ErrorAction SilentlyContinue).Source }
    if (-not $node) { Bad 'no node.exe to read the window with' } else {
        $w = $null
        for ($i = 0; $i -lt 6; $i++) {
            $w = (& $node (Join-Path $PSScriptRoot 'verify-window.mjs') $CdpPort) | ConvertFrom-Json
            if ($w.loadedVersions.Count -gt 0) { break }
            Start-Sleep -Seconds 5
        }
        $vs = @($w.loadedVersions)
        if ($vs.Count -eq 1 -and $vs[0] -eq $expected) { Ok "window loaded Desktop half PLUGIN_VERSION $($vs[0])" }
        elseif ($vs.Count -eq 0) { Bad 'window has not loaded the hermes-artifacts Desktop half (is it switched on in Capabilities > Plugins?)' }
        else { Bad "window loaded PLUGIN_VERSION $($vs -join ', '), expected $expected" }
        if ($w.route -and $w.route.hash -eq '#/hermes-artifacts' -and -not $w.route.builtIn) { Ok 'plugin page replaced the built-in Artifacts page' }
        else { Bad "plugin page did not render (route: $($w.route | ConvertTo-Json -Compress))" }
    }
} else {
    Write-Host '  SKIP  staging window not running'
}

if ($fail.Count -gt 0) { throw "[verify] $($fail.Count) check(s) failed for $Sha" }
Write-Host "[verify] staging runs hermes-artifacts $expected at $Sha"
