param(
  [string]$Profile = "",
  [switch]$NoConfig
)

$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$pluginRoot = Split-Path -Parent $scriptDir

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Write-Error "需要 Node.js。请从 https://nodejs.org 安装后重新运行。"
}

$arguments = @("$pluginRoot\scripts\install.mjs")
if ($Profile -ne "") { $arguments += @("--profile", $Profile) }
if ($NoConfig) { $arguments += "--no-config" }

& node @arguments
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
