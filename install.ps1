param(
  [string]$Profile = "",
  [switch]$NoConfig,
  [string]$Repo = ""
)

$ErrorActionPreference = "Stop"

$root = $PSScriptRoot
$childParams = @{}
if ($Profile -ne "") { $childParams.Profile = $Profile }
if ($NoConfig) { $childParams.NoConfig = $true }

if ($root -and (Test-Path (Join-Path $root "dist\server\index.js"))) {
  & (Join-Path $root "scripts\install.ps1") @childParams
  exit $LASTEXITCODE
}

# Remote one-liner:
#   irm https://raw.githubusercontent.com/<owner>/<repo>/main/install.ps1 | iex
# When piped, $PSScriptRoot is empty. Pass -Repo owner/repository or set
# OPENCODE_SUPERAGENT_REPO, and the script downloads the repository archive.
if ($Repo -eq "") { $Repo = $env:OPENCODE_SUPERAGENT_REPO }
if ($Repo -eq "") {
  Write-Error "请在解压后的仓库目录运行本脚本，或传入 -Repo owner/repository。"
}

$temp = Join-Path $env:TEMP ("opencode-superagent-" + [Guid]::NewGuid().ToString("N"))
$zip = Join-Path $temp "source.zip"
New-Item -ItemType Directory -Force -Path $temp | Out-Null
try {
  Write-Host "正在下载 $Repo ..."
  try {
    Invoke-WebRequest -Uri "https://github.com/$Repo/archive/refs/heads/main.zip" -OutFile $zip
  } catch {
    Invoke-WebRequest -Uri "https://github.com/$Repo/archive/refs/heads/master.zip" -OutFile $zip
  }
  Expand-Archive -Path $zip -DestinationPath $temp -Force
  $source = Get-ChildItem $temp -Directory | Select-Object -First 1
  if (-not $source) { throw "无法解压仓库压缩包。" }

  & (Join-Path $source.FullName "scripts\install.ps1") @childParams
  exit $LASTEXITCODE
} finally {
  Remove-Item $temp -Recurse -Force -ErrorAction SilentlyContinue
}
