param([string]$BridgeRoot='', [string]$DataDirectory='')
$ErrorActionPreference='Stop'
if ($PSVersionTable.PSVersion.Major -lt 6) { $env:PSModulePath="$PSHOME\Modules;${env:ProgramFiles}\WindowsPowerShell\Modules" }
$pluginRoot=Split-Path -Parent $PSScriptRoot
. (Join-Path $pluginRoot 'src\background.ps1')
. (Join-Path $pluginRoot 'src\startup.ps1')
. (Join-Path $pluginRoot 'src\uninstall.ps1')
if (!$DataDirectory) { $DataDirectory=if ($env:FEISHU_CODEX_HOME) { $env:FEISHU_CODEX_HOME } else { Join-Path $env:USERPROFILE '.feishu-codex-bridge' } }
if (!$BridgeRoot) {
  $pointer=Join-Path $env:USERPROFILE '.feishu-codex-bridge-app\current.json'
  if (!(Test-Path -LiteralPath $pointer)) { throw 'No managed installation found. Specify the verified BridgeRoot of your existing installation.' }
  $BridgeRoot=(Get-Content -LiteralPath $pointer -Raw | ConvertFrom-Json).runtimePath
  if (!$BridgeRoot) { throw 'Invalid installation record.' }
}
Uninstall-Bridge -BridgeRoot $BridgeRoot -DataDirectory $DataDirectory
