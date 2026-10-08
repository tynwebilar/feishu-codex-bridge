$ErrorActionPreference='Stop'
if ($PSVersionTable.PSVersion.Major -lt 6) { $env:PSModulePath="$PSHOME\Modules;${env:ProgramFiles}\WindowsPowerShell\Modules" }
$bridgeRoot=Split-Path -Parent $PSScriptRoot
. (Join-Path $bridgeRoot 'src\startup.ps1')
$testDir=Join-Path ([IO.Path]::GetTempPath()) ('bridge-startup-'+[Guid]::NewGuid().ToString('n'))
New-Item -ItemType Directory -Path $testDir | Out-Null
$link=Join-Path $testDir 'test.lnk'
try {
  Set-BridgeStartup -Enable $true -BridgeRoot $bridgeRoot -DataDirectory $testDir -ShortcutPath $link
  $saved=(New-Object -ComObject WScript.Shell).CreateShortcut($link)
  if ($saved.Description -ne 'FeishuCodexBridge managed startup' -or !$saved.Arguments.Contains('-Action start') -or !$saved.Arguments.Contains($testDir)) { throw '启动项内容不正确' }
  Set-BridgeStartup -Enable $false -BridgeRoot $bridgeRoot -DataDirectory $testDir -ShortcutPath $link
  if (Test-Path -LiteralPath $link) { throw '未移除测试启动项' }
  $saved.Description='Another application'; $saved.Save()
  $rejected=$false
  try { Set-BridgeStartup -Enable $false -BridgeRoot $bridgeRoot -DataDirectory $testDir -ShortcutPath $link } catch { $rejected=$true }
  if (!$rejected -or !(Test-Path -LiteralPath $link)) { throw '没有保护其他应用启动项' }
  Write-Output 'PASS: startup shortcut generation/removal and foreign-item protection; no real startup entry modified.'
} finally {
  if (Test-Path -LiteralPath $link) { Remove-Item -LiteralPath $link }
  Remove-Item -LiteralPath $testDir
}
