<#
.SYNOPSIS
  Runs any `hermes` command interactively against the STAGING home only, e.g.
    .\hermes.ps1 model          (pick a provider and log in for staging)
    .\hermes.ps1 plugins list
    .\hermes.ps1 chat -q "hello"
#>
. (Join-Path $PSScriptRoot '_common.ps1')
Assert-StagingIsolated
$saved = Use-StagingEnv
try {
    Push-Location $Checkout
    & $VenvPython -m hermes_cli.main @args
    $code = $LASTEXITCODE
} finally {
    Pop-Location
    Restore-Env $saved
}
exit $code
