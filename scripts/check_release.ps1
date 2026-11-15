param(
    [string]$Python = 'python',
    [string]$NpmCli
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
if (-not $env:TEST_DATABASE_URL) {
    throw 'Set TEST_DATABASE_URL to a disposable PostgreSQL database with CREATE SCHEMA privileges.'
}

function Invoke-Check {
    param([string]$Command, [string[]]$Arguments)
    & $Command @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Command exited with code $LASTEXITCODE" }
}

Push-Location (Join-Path $repo 'frontend')
try {
    if ($NpmCli) {
        Invoke-Check node @($NpmCli, 'ci')
        Invoke-Check node @($NpmCli, 'run', 'build')
    } else {
        Invoke-Check npm @('ci')
        Invoke-Check npm @('run', 'build')
    }
    Invoke-Check node @('--test', 'test/*.test.mjs')
} finally { Pop-Location }

Push-Location (Join-Path $repo 'backend')
try {
    Invoke-Check $Python @('-m', 'pytest', '-q')
} finally { Pop-Location }

$previousPythonPath = $env:PYTHONPATH
Push-Location (Join-Path $repo 'demo')
try {
    $env:PYTHONPATH = (Get-Location).Path
    Invoke-Check $Python @('-m', 'pytest', '-q')
    Invoke-Check node @('test_browser_flow.mjs')
} finally {
    $env:PYTHONPATH = $previousPythonPath
    Pop-Location
}
