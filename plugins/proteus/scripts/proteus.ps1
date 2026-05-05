param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]] $ProteusArgs
)

$ErrorActionPreference = "Stop"
$pluginDir = Split-Path -Parent $PSScriptRoot
$repoRoot = Split-Path -Parent (Split-Path -Parent $pluginDir)
$cli = Join-Path $repoRoot "dist\cli.js"

if (-not (Test-Path $cli)) {
  Push-Location $repoRoot
  try {
    npm install
    npm run build
  } finally {
    Pop-Location
  }
}

node $cli @ProteusArgs

