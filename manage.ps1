param([ValidateSet('menu','setup','start','pair','stop','status','doctor','login','groups','resolve','startup-on','startup-off','run','background-remove','uninstall')][string]$Action='menu', [string]$DataDirectory='', [string]$NodeExecutable='')
$ErrorActionPreference='Stop'
if ($PSVersionTable.PSVersion.Major -lt 6) { $env:PSModulePath = "$PSHOME\Modules;${env:ProgramFiles}\WindowsPowerShell\Modules" }
$bridgeRoot=$PSScriptRoot
if ($DataDirectory) { $env:FEISHU_CODEX_HOME=$DataDirectory }
. (Join-Path $bridgeRoot 'src\startup.ps1')
. (Join-Path $bridgeRoot 'src\background.ps1')
. (Join-Path $bridgeRoot 'src\uninstall.ps1')
$bridgeNode=if ($NodeExecutable) { $NodeExecutable } else { Join-Path $bridgeRoot 'runtime\node.exe' }
if (!(Test-Path -LiteralPath $bridgeNode)) { $bridgeNode=(Get-Command node -ErrorAction Stop).Source }
$bridgeCli=Join-Path $bridgeRoot 'src\cli.mjs'
$bridgeData=if ($env:FEISHU_CODEX_HOME) { $env:FEISHU_CODEX_HOME } else { Join-Path $env:USERPROFILE '.feishu-codex-bridge' }
function Invoke-BridgeAction([string]$Selected) {
  switch ($Selected) {
    'startup-on' { Set-BridgeStartup -Enable $true -BridgeRoot $bridgeRoot -DataDirectory $bridgeData; Write-Host '已启用当前用户登录后启动。' }
    'startup-off' { Set-BridgeStartup -Enable $false -BridgeRoot $bridgeRoot -DataDirectory $bridgeData; Write-Host '已移除本程序启动项。' }
    'login' { & $bridgeNode (Join-Path $bridgeRoot 'node_modules\@openai\codex\bin\codex.js') login }
    'setup' { & $bridgeNode $bridgeCli setup }
    'pair' { & $bridgeNode $bridgeCli serve --pair }
    'run' {
      New-Item -ItemType Directory -Force -Path $bridgeData | Out-Null
      $env:FEISHU_BRIDGE_SUPERVISED='1'
      $ErrorActionPreference='Continue'
      & $bridgeNode $bridgeCli serve 1>> (Join-Path $bridgeData 'service.log') 2>> (Join-Path $bridgeData 'service-error.log')
      $serviceExit=$LASTEXITCODE
      if ($serviceExit -eq 42) {
        $ErrorActionPreference='Stop'
        try {
          Uninstall-Bridge -BridgeRoot $bridgeRoot -DataDirectory $bridgeData -NodeExecutable $bridgeNode -FromSupervisor
          [IO.File]::WriteAllText((Join-Path $bridgeData 'plugin-cleanup.json'),'{"state":"cleaned","reason":"plugin_uninstalled"}')
        } catch {
          [IO.File]::WriteAllText((Join-Path $bridgeData 'plugin-cleanup.json'),'{"state":"failed","reason":"cleanup_incomplete"}')
          exit 1
        }
        exit 0
      }
      exit $serviceExit
    }
    'start' {
      if (Test-Path -LiteralPath (Join-Path $bridgeRoot 'plugin.json')) {
        & $bridgeNode (Join-Path $bridgeRoot 'src\plugin-lifecycle.mjs') $bridgeData
        if ($LASTEXITCODE -ne 0) { throw 'Plugin removal detection could not be enrolled. Bridge was not started.' }
      }
      Start-BridgeBackground -BridgeRoot $bridgeRoot -DataDirectory $bridgeData -NodeExecutable $bridgeNode
      Write-Host '已请求独立后台启动。请选择状态，确认飞书和 Codex 均 connected。'
    }
    'uninstall' { Uninstall-Bridge -BridgeRoot $bridgeRoot -DataDirectory $bridgeData -NodeExecutable $bridgeNode }
    'background-remove' { Start-BridgeBackground -BridgeRoot $bridgeRoot -DataDirectory $bridgeData -NodeExecutable $bridgeNode -Remove; Write-Host '已移除后台任务。' }
    default { & $bridgeNode $bridgeCli $Selected }
  }
}
if ($Action -ne 'menu') { Invoke-BridgeAction $Action; exit }
while ($true) {
  Write-Host "`nFeishu Codex Bridge - 开发预览（尚未正式发布）"
  Write-Host '1 配置  2 Codex 登录  3 首次配对（前台）  4 后台启动  5 状态  6 停止  7 诊断  8 群白名单  9 核对未知任务  10 开机启动  11 关闭开机启动  12 移除后台任务  13 卸载桥接服务（保留数据）  0 退出'
  $selection=Read-Host '选择'
  if ($selection -eq '0') { break }
  $actions=@{'1'='setup';'2'='login';'3'='pair';'4'='start';'5'='status';'6'='stop';'7'='doctor';'8'='groups';'9'='resolve';'10'='startup-on';'11'='startup-off';'12'='background-remove';'13'='uninstall'}
  if ($actions.ContainsKey($selection)) { Invoke-BridgeAction $actions[$selection] }
}
